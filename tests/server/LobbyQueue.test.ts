import EventEmitter from "events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { GameType } from "../../src/core/game/Game";
import { LOBBY_QUEUE_CUTOFF_MS } from "../../src/core/Schemas";
import { GameServer } from "../../src/server/GameServer";
import { InternalGameInfo } from "../../src/server/IPCBridgeSchema";
import {
  LobbyQueuePaymentResult,
  QueueableLobby,
  queueListedLobby,
} from "../../src/server/LobbyQueuePayment";
import { MasterLobbyService } from "../../src/server/MasterLobbyService";
import { ServerEnv } from "../../src/server/ServerEnv";
import { WorkerLobbyService } from "../../src/server/WorkerLobbyService";
import { mockLogger as harnessLogger } from "../util/GameServerHarness";
import { decodeSentLobbyMessage, testGameConfig } from "../util/Wire";

vi.mock("../../src/server/Logger", () => ({
  logger: {
    child: () => ({
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    }),
  },
}));

vi.mock("../../src/server/PollingLoop", () => ({
  startPolling: vi.fn(),
}));

const mockLogger = harnessLogger();
const CREATOR = "11111111-1111-4111-8111-111111111111";

function makeGame(id = "queue-g1") {
  return new GameServer({
    id,
    log: mockLogger,
    createdAt: Date.now(),
    gameConfig: testGameConfig({ gameType: GameType.Private }),
    creatorPersistentID: CREATOR,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("queueListedLobby", () => {
  function lobby(over: Partial<QueueableLobby> = {}) {
    const state = { queued: false };
    const l: QueueableLobby = {
      isCreator: (id) => id === CREATOR,
      isPublic: () => false,
      isListed: () => true,
      isQueued: () => state.queued,
      inLobby: () => true,
      startsAt: () => undefined,
      autoStartAt: () => Date.now() + 60_000,
      queueForPublic: () => {
        state.queued = true;
      },
      ...over,
    };
    return { l, state };
  }

  const paid = () =>
    vi.fn(async (): Promise<LobbyQueuePaymentResult> => ({ type: "success" }));

  it("charges the host and queues the lobby", async () => {
    const { l, state } = lobby();
    const pay = paid();
    const out = await queueListedLobby(l, CREATOR, pay);
    expect(out).toEqual({ status: 200, body: { queued: true } });
    expect(pay).toHaveBeenCalledOnce();
    expect(state.queued).toBe(true);
  });

  it.each<[string, Partial<QueueableLobby>, string, number]>([
    ["a non-creator", {}, "someone-else", 403],
    ["an unlisted lobby", { isListed: () => false }, CREATOR, 409],
    ["a public game", { isPublic: () => true }, CREATOR, 409],
    ["a started game", { inLobby: () => false }, CREATOR, 409],
    ["a lobby counting down", { startsAt: () => 123 }, CREATOR, 409],
    [
      "a lobby about to auto-start",
      { autoStartAt: () => Date.now() + LOBBY_QUEUE_CUTOFF_MS - 1000 },
      CREATOR,
      409,
    ],
  ])("refuses %s without charging", async (_, over, who, status) => {
    const { l, state } = lobby(over);
    const pay = paid();
    const out = await queueListedLobby(l, who, pay);
    expect(out.status).toBe(status);
    expect(pay).not.toHaveBeenCalled();
    expect(state.queued).toBe(false);
  });

  it("does not charge again for an already queued lobby", async () => {
    const { l } = lobby({ isQueued: () => true });
    const pay = paid();
    const out = await queueListedLobby(l, CREATOR, pay);
    expect(out.status).toBe(200);
    expect(pay).not.toHaveBeenCalled();
  });

  it.each<[LobbyQueuePaymentResult, number, string]>([
    [{ type: "insufficient_balance" }, 402, "insufficient_balance"],
    [{ type: "error", message: "boom" }, 502, "queue_payment_failed"],
  ])(
    "leaves the lobby unqueued when payment fails",
    async (result, status, error) => {
      const { l, state } = lobby();
      const out = await queueListedLobby(l, CREATOR, async () => result);
      expect(out).toEqual({ status, body: { error } });
      expect(state.queued).toBe(false);
    },
  );
});

describe("GameServer queueing", () => {
  it("only queues a listed lobby, and drops the listing deadline", () => {
    const game = makeGame();
    game.queueForPublic();
    expect(game.isQueued()).toBe(false);

    game.setListed(true);
    expect(game.autoStartAt()).toBeDefined();
    game.queueForPublic();
    expect(game.isQueued()).toBe(true);
    expect(game.queuedAt()).toBeTypeOf("number");
    expect(game.autoStartAt()).toBeUndefined();
    expect(game.gameInfo().queued).toBe(true);
  });

  it("never auto-starts a queued lobby on the listing deadline", () => {
    vi.useFakeTimers();
    try {
      const game = makeGame();
      game.setListed(true, { autoStartMs: 60_000 });
      game.queueForPublic();
      vi.advanceTimersByTime(10 * 60_000);
      game.maybeAutoStartListed();
      expect(game.gameInfo().startsAt).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("starts on the queue's countdown like any public lobby", () => {
    const game = makeGame();
    game.setListed(true);
    game.queueForPublic();
    game.setStartsAt(Date.now() + 120_000);
    expect(game.gameInfo().startsAt).toBeTypeOf("number");
  });
});

describe("WorkerLobbyService queued lobbies", () => {
  function createService(listed: GameServer[]) {
    const gm = {
      publicLobbies: vi.fn().mockReturnValue([]),
      listedLobbies: vi.fn().mockReturnValue(listed),
      game: vi.fn().mockReturnValue(null),
      activeGames: vi.fn().mockReturnValue(0),
    };
    const service = new WorkerLobbyService(
      new EventEmitter() as any,
      { handleUpgrade: vi.fn() } as any,
      gm as any,
      mockLogger,
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

  it("reports a queued lobby as special with its queuedAt", () => {
    const game = makeGame();
    game.setListed(true);
    game.queueForPublic();
    const { service, sendToMaster } = createService([game]);

    broadcast(service, { ffa: [], team: [], special: [], hosted: [] });

    const list = sendToMaster.mock.calls
      .map((c: any[]) => c[0])
      .find((m: any) => m.type === "lobbyList");
    expect(list.lobbies).toHaveLength(1);
    expect(list.lobbies[0].publicGameType).toBe("special");
    expect(list.lobbies[0].queuedAt).toBe(game.queuedAt());
    expect(list.lobbies[0].autoStartAt).toBeUndefined();
    expect(list.lobbies[0].custom).toBe(true);
  });

  it("marks listed lobbies custom, but not featured events", () => {
    const listed = makeGame("listed-g1");
    listed.setListed(true);
    const featured = makeGame("featured-g1");
    featured.setListed(true);
    featured.setFeatured({ label: "Weekly Cup" });
    const { service, sendToMaster } = createService([listed, featured]);

    broadcast(service, { ffa: [], team: [], special: [], hosted: [] });

    const list = sendToMaster.mock.calls
      .map((c: any[]) => c[0])
      .find((m: any) => m.type === "lobbyList");
    const custom = Object.fromEntries(
      list.lobbies.map((l: any) => [l.gameID, l.custom]),
    );
    expect(custom).toEqual({ "listed-g1": true, "featured-g1": undefined });
  });

  it("counts a queued lobby on another worker as the creator's listing", () => {
    const { service } = createService([]);
    broadcast(service, {
      ffa: [],
      team: [],
      special: [
        {
          gameID: "paid1",
          numClients: 1,
          publicGameType: "special",
          creatorID: "creator-a",
          queuedAt: 5,
        },
      ],
      hosted: [],
    });
    expect(service.creatorHasListedLobby("creator-a", "other")).toBe(true);
    expect(service.creatorHasListedLobby("creator-b", "other")).toBe(false);
  });

  it("doesn't count a queued lobby against the hosted cap", () => {
    const game = makeGame();
    game.setListed(true);
    game.queueForPublic();
    const { service } = createService([game]);
    expect(service.hostedLobbyCount()).toBe(0);
  });

  it("strips queuedAt but keeps the custom flag for browsers", () => {
    const { service } = createService([]);
    const ws = { send: vi.fn(), on: vi.fn(), readyState: WebSocket.OPEN };
    (service as any).lobbiesWss.emit("connection", ws);

    broadcast(service, {
      ffa: [],
      team: [],
      special: [
        {
          gameID: "paid1",
          numClients: 1,
          publicGameType: "special",
          queuedAt: 5,
          custom: true,
        },
      ],
      hosted: [],
    });

    const full = ws.send.mock.calls
      .map((c): any => decodeSentLobbyMessage(c[0]))
      .find((p) => p.type === "full");
    expect(full.games.special[0].gameID).toBe("paid1");
    expect(full.games.special[0].queuedAt).toBeUndefined();
    expect(full.games.special[0].custom).toBe(true);
  });
});

describe("MasterLobbyService paid queue order", () => {
  function createService() {
    vi.stubEnv("DOMAIN", "localhost");
    vi.spyOn(ServerEnv, "numWorkers").mockReturnValue(1);
    vi.spyOn(ServerEnv, "workerIndex").mockReturnValue(1);
    vi.spyOn(ServerEnv, "gameCreationRate").mockReturnValue(120_000);
    const playlist = {
      gameConfig: vi.fn().mockResolvedValue({ gameType: GameType.Public }),
    };
    const log = { info: vi.fn(), error: vi.fn() } as any;
    const service = new MasterLobbyService(playlist as any, log);
    const worker = new EventEmitter();
    (worker as any).send = vi.fn();
    service.registerWorker(1, worker as any);
    return { service, worker };
  }

  const special = (
    gameID: string,
    extra: Partial<InternalGameInfo> = {},
  ): InternalGameInfo => ({
    gameID,
    numClients: 0,
    publicGameType: "special",
    ...extra,
  });

  it("puts paid lobbies right behind the counting-down one, in payment order", () => {
    const { service, worker } = createService();
    worker.emit("message", {
      type: "lobbyList",
      lobbies: [
        special("old", { createdAt: 1 }),
        special("paid-late", { createdAt: 50, queuedAt: 200 }),
        special("front", { createdAt: 2, startsAt: 999_999 }),
        special("paid-early", { createdAt: 60, queuedAt: 100 }),
        special("new", { createdAt: 3 }),
      ],
    });

    const order = (service as any)
      .getAllLobbies()
      .games.special.map((l: InternalGameInfo) => l.gameID);
    expect(order).toEqual(["front", "paid-early", "paid-late", "old", "new"]);
  });

  it("drops the creator's hosted lobby, not their queued one", () => {
    const { service, worker } = createService();
    worker.emit("message", {
      type: "lobbyList",
      lobbies: [
        special("paid", { creatorID: "creator-a", queuedAt: 100 }),
        {
          gameID: "second",
          numClients: 0,
          publicGameType: "hosted",
          creatorID: "creator-a",
        },
      ],
    });

    const { games, losers } = (service as any).getAllLobbies();
    expect(games.special.map((l: InternalGameInfo) => l.gameID)).toEqual([
      "paid",
    ]);
    expect(games.hosted).toEqual([]);
    expect(losers).toEqual(["second"]);
  });

  it("gives the next countdown to a paid lobby over older ones", async () => {
    const { service, worker } = createService();
    worker.emit("message", {
      type: "lobbyList",
      lobbies: [
        special("old", { createdAt: 1 }),
        special("paid", { createdAt: 50, queuedAt: 100 }),
      ],
    });

    await (service as any).maybeScheduleLobby();

    const updates = (
      (worker as any).send as ReturnType<typeof vi.fn>
    ).mock.calls
      .map((c) => c[0])
      .filter((m: any) => m.type === "updateLobby");
    expect(updates.map((m: any) => m.gameID)).toEqual(["paid"]);
  });
});
