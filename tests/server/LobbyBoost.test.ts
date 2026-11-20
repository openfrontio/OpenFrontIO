import { GameType } from "@openfront/engine-api/game/GameTypes";
import { boostWouldMoveLobby } from "@openfront/shared/LobbyBoost";
import EventEmitter from "events";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BOOST_HOLD_MS,
  BoostableLobby,
  boostScheduledLobby,
} from "../../src/server/LobbyBoost";
import { LobbyQueuePaymentResult } from "../../src/server/LobbyQueuePayment";
import { WorkerLobbyService } from "../../src/server/WorkerLobbyService";
import {
  makeClient,
  makeGame,
  makeMockWs,
  mockLogger,
} from "../util/GameServerHarness";

vi.mock("../../src/server/Logger", () => ({
  logger: {
    child: () => ({
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    }),
  },
}));

const PLAYER = "11111111-1111-4111-8111-111111111111";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("boostWouldMoveLobby", () => {
  const queue = [
    { gameID: "front", startsAt: 999 },
    { gameID: "paid", paid: true },
    { gameID: "behind-paid" },
    { gameID: "back" },
  ];
  const wouldMove = (gameID: string, q: typeof queue = queue) =>
    boostWouldMoveLobby(q, gameID, (l) => l.paid === true);

  it("moves a lobby that waits behind an unpaid one", () => {
    expect(wouldMove("back")).toBe(true);
  });

  it("doesn't move a lobby that is already next", () => {
    expect(wouldMove("behind-paid")).toBe(false);
    expect(wouldMove("paid")).toBe(false);
    expect(wouldMove("front")).toBe(false);
    expect(wouldMove("only", [{ gameID: "only" }])).toBe(false);
  });

  it("treats a lobby the queue doesn't list yet as being at the back", () => {
    expect(wouldMove("new")).toBe(true);
    expect(wouldMove("new", [])).toBe(false);
    expect(wouldMove("new", [{ gameID: "front", startsAt: 999 }])).toBe(false);
    expect(wouldMove("new", [{ gameID: "paid", paid: true }])).toBe(false);
  });
});

describe("boostScheduledLobby", () => {
  function lobby(over: Partial<BoostableLobby> = {}) {
    const state: { boosted: boolean; pending: boolean; heldFor?: string } = {
      boosted: false,
      pending: false,
    };
    const l: BoostableLobby = {
      hasConnectedClient: (id) => id === PLAYER,
      isScheduledLobby: () => true,
      boostBlockedFor: (id) =>
        state.boosted ||
        state.pending ||
        (state.heldFor !== undefined && state.heldFor !== id),
      boostHeldFor: (id) => !state.pending && state.heldFor === id,
      startsAt: () => undefined,
      wouldMoveUp: () => true,
      reserveBoost: (id) => {
        state.pending = true;
        state.heldFor = id;
      },
      releaseBoost: () => {
        state.pending = false;
        state.heldFor = undefined;
      },
      holdBoostForPayer: () => {
        state.pending = false;
      },
      boost: () => {
        state.boosted = true;
        state.pending = false;
        state.heldFor = undefined;
      },
      ...over,
    };
    return { l, state };
  }

  const paid = () =>
    vi.fn(async (): Promise<LobbyQueuePaymentResult> => ({ type: "success" }));

  it("charges the player and boosts the lobby", async () => {
    const { l, state } = lobby();
    const pay = paid();
    const out = await boostScheduledLobby(l, PLAYER, pay);
    expect(out).toEqual({ status: 200, body: { boosted: true } });
    expect(pay).toHaveBeenCalledOnce();
    expect(state).toEqual({ boosted: true, pending: false });
  });

  it.each<[string, Partial<BoostableLobby>, string, number]>([
    ["someone who isn't in the lobby", {}, "someone-else", 403],
    [
      "a lobby that isn't scheduled",
      { isScheduledLobby: () => false },
      PLAYER,
      409,
    ],
    ["a boosted lobby", { boostBlockedFor: () => true }, PLAYER, 409],
    ["a lobby counting down", { startsAt: () => 123 }, PLAYER, 409],
    ["a lobby that is already next", { wouldMoveUp: () => false }, PLAYER, 409],
  ])("refuses %s without charging", async (_, over, who, status) => {
    const { l, state } = lobby(over);
    const pay = paid();
    const out = await boostScheduledLobby(l, who, pay);
    expect(out.status).toBe(status);
    expect(pay).not.toHaveBeenCalled();
    expect(state.boosted).toBe(false);
  });

  it("lets only one of two simultaneous boosts pay", async () => {
    const { l } = lobby({ hasConnectedClient: () => true });
    const pay = paid();
    const [first, second] = await Promise.all([
      boostScheduledLobby(l, PLAYER, pay),
      boostScheduledLobby(l, "other-player", pay),
    ]);
    expect(first.status).toBe(200);
    expect(second).toEqual({
      status: 409,
      body: { error: "boost_already_boosted" },
    });
    expect(pay).toHaveBeenCalledOnce();
  });

  it("leaves the lobby boostable when the player can't afford it", async () => {
    const { l, state } = lobby({ hasConnectedClient: () => true });
    const out = await boostScheduledLobby(l, PLAYER, async () => ({
      type: "insufficient_balance",
    }));
    expect(out).toEqual({
      status: 402,
      body: { error: "insufficient_balance" },
    });
    expect(state).toEqual({ boosted: false, pending: false });
    expect((await boostScheduledLobby(l, "other-player", paid())).status).toBe(
      200,
    );
  });

  it("frees the lobby when the API refuses the charge", async () => {
    const { l, state } = lobby({ hasConnectedClient: () => true });
    const out = await boostScheduledLobby(l, PLAYER, async () => ({
      type: "error",
      message: "api returned 403",
      refused: true,
    }));
    expect(out.status).toBe(502);
    expect(state).toEqual({ boosted: false, pending: false });
    expect((await boostScheduledLobby(l, "other-player", paid())).status).toBe(
      200,
    );
  });

  it("keeps the lobby for the payer when the charge's outcome is unknown", async () => {
    let next = true;
    const { l, state } = lobby({
      hasConnectedClient: () => true,
      wouldMoveUp: () => next,
    });
    const out = await boostScheduledLobby(l, PLAYER, async () => ({
      type: "error",
      message: "timeout",
    }));
    expect(out).toEqual({
      status: 502,
      body: { error: "boost_payment_failed" },
    });
    expect(state.boosted).toBe(false);

    const other = paid();
    expect((await boostScheduledLobby(l, "other-player", other)).status).toBe(
      409,
    );
    expect(other).not.toHaveBeenCalled();

    // The lobby moved up meanwhile: the payer's retry still replays the
    // charge, since the first one may have gone through.
    next = false;
    const retry = paid();
    expect((await boostScheduledLobby(l, PLAYER, retry)).status).toBe(200);
    expect(retry).toHaveBeenCalledOnce();
    expect(state.boosted).toBe(true);
  });
});

describe("GameServer boosting", () => {
  function publicLobby() {
    return makeGame({
      config: { gameType: GameType.Public },
      publicGameType: "ffa",
    });
  }

  it("knows which accounts are connected", () => {
    const game = publicLobby();
    const client = makeClient();
    expect(game.hasConnectedClient(client.persistentID)).toBe(false);
    game.joinClient(client);
    expect(game.hasConnectedClient(client.persistentID)).toBe(true);
    expect(game.hasConnectedClient("someone-else")).toBe(false);
  });

  it("records the boost once and tells the lobby who paid", () => {
    const game = publicLobby();
    const client = makeClient();
    game.joinClient(client);
    expect(game.boostBlockedFor(client.persistentID)).toBe(false);
    expect(game.gameInfo().boostedBy).toBeUndefined();

    game.reserveBoost(client.persistentID);
    expect(game.boostBlockedFor(client.persistentID)).toBe(true);
    expect(game.boostedAtTime()).toBeUndefined();
    expect(game.gameInfo().boostedBy).toBeUndefined();

    game.boost();
    const at = game.boostedAtTime();
    expect(at).toBeTypeOf("number");
    expect(game.gameInfo().boostedBy).toBe(client.clientID);

    game.boost();
    expect(game.boostedAtTime()).toBe(at);
    expect(game.gameInfo().boostedBy).toBe(client.clientID);
    expect(game.boostBlockedFor(client.persistentID)).toBe(true);
  });

  it("holds an unresolved charge for its payer and frees a refused one", () => {
    const game = publicLobby();
    const client = makeClient();
    game.joinClient(client);

    game.reserveBoost(client.persistentID);
    expect(game.boostHeldFor(client.persistentID)).toBe(false);
    game.holdBoostForPayer();
    expect(game.boostHeldFor(client.persistentID)).toBe(true);
    expect(game.boostHeldFor("someone-else")).toBe(false);
    expect(game.boostBlockedFor(client.persistentID)).toBe(false);
    expect(game.boostBlockedFor("someone-else")).toBe(true);

    game.releaseBoost();
    expect(game.boostBlockedFor("someone-else")).toBe(false);
  });

  it("holds an unresolved charge through a disconnect, for a limited time", async () => {
    vi.useFakeTimers();
    try {
      const game = publicLobby();
      const ws = makeMockWs();
      const client = makeClient({ ws });
      game.joinClient(client);
      game.reserveBoost(client.persistentID);
      game.holdBoostForPayer();

      // Connected, the payer keeps the hold however long they take.
      vi.advanceTimersByTime(BOOST_HOLD_MS * 2);
      expect(game.boostBlockedFor("someone-else")).toBe(true);

      await ws.trigger("close");
      expect(game.boostBlockedFor("someone-else")).toBe(true);
      expect(game.boostHeldFor(client.persistentID)).toBe(true);

      vi.advanceTimersByTime(BOOST_HOLD_MS);
      expect(game.boostBlockedFor("someone-else")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives a payer dropped by the ping prune the same grace", () => {
    vi.useFakeTimers();
    try {
      const game = publicLobby();
      const client = makeClient();
      game.joinClient(client);
      game.reserveBoost(client.persistentID);
      game.holdBoostForPayer();

      // Silent for longer than the hold: the prune drops them, with no
      // close event yet.
      vi.advanceTimersByTime(BOOST_HOLD_MS * 2);
      game.pruneStaleClients();
      expect(game.hasConnectedClient(client.persistentID)).toBe(false);
      expect(game.boostBlockedFor("someone-else")).toBe(true);

      vi.advanceTimersByTime(BOOST_HOLD_MS);
      expect(game.boostBlockedFor("someone-else")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("WorkerLobbyService boosted lobbies", () => {
  function createService(publicLobbies: unknown[]) {
    const gm = {
      publicLobbies: vi.fn().mockReturnValue(publicLobbies),
      listedLobbies: vi.fn().mockReturnValue([]),
      game: vi.fn().mockReturnValue(null),
      activeGames: vi.fn().mockReturnValue(0),
    };
    const service = new WorkerLobbyService(
      new EventEmitter() as any,
      { handleUpgrade: vi.fn() } as any,
      gm as any,
      mockLogger(),
    );
    const sendToMaster = vi.fn();
    (service as any).sendToMaster = sendToMaster;
    return { service, sendToMaster };
  }

  function broadcast(service: WorkerLobbyService, games: any) {
    (service as any).handleMasterMessage({
      type: "lobbiesBroadcast",
      publicGames: { serverTime: 1000, games },
    });
  }

  it("reports a boosted lobby with its boost time as queuedAt", () => {
    const boosted = makeGame({
      config: { gameType: GameType.Public },
      publicGameType: "ffa",
    });
    boosted.boost();
    const plain = makeGame({
      config: { gameType: GameType.Public },
      publicGameType: "ffa",
    });
    const { service, sendToMaster } = createService([boosted, plain]);

    broadcast(service, { ffa: [], team: [], special: [], hosted: [] });

    const list = sendToMaster.mock.calls
      .map((c: any[]) => c[0])
      .find((m: any) => m.type === "lobbyList");
    expect(list.lobbies[0].queuedAt).toBe(boosted.boostedAtTime());
    expect(list.lobbies[0].boosted).toBe(true);
    expect(list.lobbies[1].queuedAt).toBeUndefined();
    expect(list.lobbies[1].boosted).toBeUndefined();
  });

  it("judges a boost against the master's queue order", () => {
    const { service } = createService([]);
    const lobby = (gameID: string, extra = {}) => ({
      gameID,
      numClients: 0,
      publicGameType: "ffa",
      ...extra,
    });
    broadcast(service, {
      ffa: [
        lobby("front", { startsAt: 5000 }),
        lobby("paid", { queuedAt: 100 }),
        lobby("next"),
        lobby("back"),
      ],
    });

    expect(service.boostWouldMove("back", "ffa")).toBe(true);
    expect(service.boostWouldMove("next", "ffa")).toBe(false);
    expect(service.boostWouldMove("paid", "ffa")).toBe(false);
    // Another queue's order says nothing about this lobby, and an empty
    // queue has nothing to move ahead of.
    expect(service.boostWouldMove("next", "team")).toBe(false);
  });

  it("tells browsers a lobby is boosted, without its boost time", () => {
    const { service } = createService([]);
    const sanitized = (service as any).sanitizeGames({
      ffa: [
        {
          gameID: "g",
          numClients: 0,
          publicGameType: "ffa",
          queuedAt: 100,
          boosted: true,
        },
      ],
    });
    expect(sanitized.ffa[0].boosted).toBe(true);
    expect(sanitized.ffa[0].queuedAt).toBeUndefined();
  });
});
