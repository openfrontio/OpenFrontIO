import { GameType } from "@openfront/engine-api/game/GameTypes";
import { boostWouldMoveLobby } from "@openfront/shared/LobbyBoost";
import EventEmitter from "events";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BoostableLobby,
  boostScheduledLobby,
} from "../../src/server/LobbyBoost";
import { LobbyQueuePaymentResult } from "../../src/server/LobbyQueuePayment";
import { WorkerLobbyService } from "../../src/server/WorkerLobbyService";
import { makeClient, makeGame, mockLogger } from "../util/GameServerHarness";

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
  });
});

describe("boostScheduledLobby", () => {
  function lobby(over: Partial<BoostableLobby> = {}) {
    const state = { boosted: false, pending: false };
    const l: BoostableLobby = {
      hasConnectedClient: (id) => id === PLAYER,
      isScheduledLobby: () => true,
      isBoosted: () => state.boosted || state.pending,
      startsAt: () => undefined,
      wouldMoveUp: () => true,
      setBoostPending: (pending) => {
        state.pending = pending;
      },
      boost: () => {
        state.boosted = true;
        state.pending = false;
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
    ["a boosted lobby", { isBoosted: () => true }, PLAYER, 409],
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

  it.each<[LobbyQueuePaymentResult, number, string]>([
    [{ type: "insufficient_balance" }, 402, "insufficient_balance"],
    [{ type: "error", message: "boom" }, 502, "boost_payment_failed"],
  ])(
    "leaves the lobby boostable when payment fails",
    async (result, status, error) => {
      const { l, state } = lobby();
      const out = await boostScheduledLobby(l, PLAYER, async () => result);
      expect(out).toEqual({ status, body: { error } });
      expect(state).toEqual({ boosted: false, pending: false });
    },
  );
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
    expect(game.isBoosted()).toBe(false);
    expect(game.gameInfo().boostedBy).toBeUndefined();

    game.setBoostPending(true);
    expect(game.isBoosted()).toBe(true);
    expect(game.boostedAtTime()).toBeUndefined();

    game.boost(client.persistentID);
    const at = game.boostedAtTime();
    expect(at).toBeTypeOf("number");
    expect(game.gameInfo().boostedBy).toBe(client.clientID);

    game.boost("someone-else");
    expect(game.boostedAtTime()).toBe(at);
    expect(game.gameInfo().boostedBy).toBe(client.clientID);
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
    boosted.boost("anyone");
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
    // Another queue's order says nothing about this lobby.
    expect(service.boostWouldMove("next", "team")).toBe(true);
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
