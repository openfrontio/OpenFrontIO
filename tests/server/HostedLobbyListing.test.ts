import EventEmitter from "events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
} from "../../src/core/game/Game";
import {
  HOSTED_LOBBY_AUTO_START_MS,
  MAX_HOSTED_LOBBIES,
} from "../../src/core/Schemas";
import { Client } from "../../src/server/Client";
import { GameManager } from "../../src/server/GameManager";
import {
  GamePhase,
  GameServer,
  hashPersistentID,
} from "../../src/server/GameServer";
import {
  InternalGameInfo,
  InternalPublicGames,
} from "../../src/server/IPCBridgeSchema";
import { MasterLobbyService } from "../../src/server/MasterLobbyService";
import { ServerEnv } from "../../src/server/ServerEnv";
import { WorkerLobbyService } from "../../src/server/WorkerLobbyService";

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

const mockLogger: any = {
  child: vi.fn().mockReturnThis(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const CREATOR = "11111111-1111-4111-8111-111111111111";
const OTHER_CREATOR = "22222222-2222-4222-8222-222222222222";

function makeGame(
  id = "test-game",
  creatorPersistentID: string | undefined = CREATOR,
  config: Record<string, unknown> = {},
) {
  return new GameServer(
    id,
    mockLogger,
    Date.now(),
    { gameType: GameType.Private, ...config } as any,
    creatorPersistentID,
  );
}

describe("GameServer listing", () => {
  it("is unlisted by default and toggles via setListed", () => {
    const game = makeGame();
    expect(game.isListed()).toBe(false);
    game.setListed(true);
    expect(game.isListed()).toBe(true);
    game.setListed(false);
    expect(game.isListed()).toBe(false);
  });

  it("cannot be listed through update_game_config", () => {
    const game = makeGame();
    const result = game.handleIntent(
      { type: "update_game_config", config: { listed: true } } as any,
      {
        clientID: "c1",
        isLobbyCreator: true,
        isAdmin: false,
        isAdminBot: false,
      },
    );
    expect(result.status).toBe(200);
    expect(game.isListed()).toBe(false);
  });

  it("identifies its creator", () => {
    const game = makeGame();
    expect(game.isCreator(CREATOR)).toBe(true);
    expect(game.isCreator(OTHER_CREATOR)).toBe(false);
  });

  it("never matches a creator when created without one", () => {
    const game = new GameServer("no-creator", mockLogger, Date.now(), {
      gameType: GameType.Private,
    } as any);
    expect(game.isCreator(CREATOR)).toBe(false);
    expect(game.hashedCreatorID()).toBeUndefined();
  });

  it("exposes a stable hash of the creator id, not the raw id", () => {
    const game = makeGame();
    const hashed = game.hashedCreatorID();
    expect(hashed).toBe(hashPersistentID(CREATOR));
    expect(hashed).not.toContain(CREATOR);
    expect(hashed).toMatch(/^[0-9a-f]{64}$/);
  });

  it("reports a join whitelist only when non-empty", () => {
    expect(makeGame().hasJoinWhitelist()).toBe(false);
    expect(
      makeGame("g", CREATOR, { allowedPublicIds: [] }).hasJoinWhitelist(),
    ).toBe(false);
    expect(
      makeGame("g", CREATOR, { allowedPublicIds: ["p1"] }).hasJoinWhitelist(),
    ).toBe(true);
  });

  it("delists when a join whitelist is added via config update", () => {
    const game = makeGame();
    game.setListed(true);

    game.updateGameConfig({ allowedPublicIds: [] });
    expect(game.isListed()).toBe(true);

    game.updateGameConfig({ allowedPublicIds: ["p1"] });
    expect(game.isListed()).toBe(false);
  });

  it("exposes the listed flag in gameInfo for private lobbies only", () => {
    const game = makeGame();
    expect(game.gameInfo().listed).toBe(false);
    game.setListed(true);
    expect(game.gameInfo().listed).toBe(true);

    const pub = new GameServer("pub", mockLogger, Date.now(), {
      gameType: GameType.Public,
    } as any);
    expect(pub.gameInfo().listed).toBeUndefined();
  });
});

describe("GameManager.listedLobbies", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("returns only listed private lobbies still in the lobby phase", () => {
    const gm = new GameManager(mockLogger);
    const unlisted = gm.createGame("g-unlisted", undefined, CREATOR)!;
    const listed = gm.createGame("g-listed", undefined, CREATOR)!;
    listed.setListed(true);

    expect(gm.listedLobbies().map((g) => g.id)).toEqual(["g-listed"]);
    expect(gm.publicLobbies()).toEqual([]);
    expect(unlisted.isListed()).toBe(false);
  });

  it("excludes public games even if flagged listed", () => {
    const gm = new GameManager(mockLogger);
    const pub = gm.createGame(
      "g-public",
      { gameType: GameType.Public } as any,
      undefined,
    )!;
    pub.setListed(true);

    expect(gm.listedLobbies()).toEqual([]);
    expect(gm.publicLobbies().map((g) => g.id)).toEqual(["g-public"]);
  });

  it("drops a listed lobby once its game starts", () => {
    const gm = new GameManager(mockLogger);
    const game = gm.createGame("g-started", undefined, CREATOR)!;
    game.setListed(true);
    expect(gm.listedLobbies()).toHaveLength(1);

    (game as any)._hasStarted = true;
    expect(gm.listedLobbies()).toEqual([]);
  });
});

describe("listed lobby auto-start", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("tracks the deadline from when the lobby was listed", () => {
    const game = makeGame();
    expect(game.autoStartAt()).toBeUndefined();

    game.setListed(true);
    const deadline = Date.now() + HOSTED_LOBBY_AUTO_START_MS;
    expect(game.autoStartAt()).toBe(deadline);
    expect(game.gameInfo().autoStartAt).toBe(deadline);

    // A duplicate toggle must not extend the deadline...
    vi.setSystemTime(Date.now() + 60_000);
    game.setListed(true);
    expect(game.autoStartAt()).toBe(deadline);

    // ...unlisting cancels it, and relisting starts a fresh one.
    game.setListed(false);
    expect(game.autoStartAt()).toBeUndefined();
    game.setListed(true);
    expect(game.autoStartAt()).toBe(Date.now() + HOSTED_LOBBY_AUTO_START_MS);
  });

  it("arms the start countdown only once the deadline passes", () => {
    const gm = new GameManager(mockLogger);
    const game = gm.createGame(
      "g-auto-start",
      { startDelay: 30 } as any,
      CREATOR,
    )!;
    game.setListed(true);

    vi.setSystemTime(Date.now() + HOSTED_LOBBY_AUTO_START_MS - 1000);
    gm.tick();
    expect(game.gameInfo().startsAt).toBeUndefined();

    vi.setSystemTime(Date.now() + 2000);
    gm.tick();
    expect(game.gameInfo().startsAt).toBe(Date.now() + 30_000);
    // Still listed while the start countdown runs (the phase change on
    // start delists).
    expect(gm.listedLobbies()).toHaveLength(1);
  });

  it("never auto-starts an unlisted lobby", () => {
    const gm = new GameManager(mockLogger);
    const game = gm.createGame("g-manual", undefined, CREATOR)!;

    vi.setSystemTime(Date.now() + HOSTED_LOBBY_AUTO_START_MS * 2);
    gm.tick();
    expect(game.gameInfo().startsAt).toBeUndefined();
  });
});

function fakeWs() {
  const ws = new EventEmitter() as any;
  ws.readyState = WebSocket.OPEN;
  ws.send = vi.fn();
  ws.close = vi.fn();
  return ws;
}

function makeClient(clientID: string, persistentID: string, ws: any) {
  return new Client(
    clientID,
    persistentID,
    null,
    null,
    undefined,
    "1.2.3.4",
    `user_${clientID}`,
    null,
    ws,
    undefined,
    undefined,
    [],
  );
}

describe("host-left lobby teardown", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("ends, delists and prunes an unstarted lobby when the host leaves", () => {
    const gm = new GameManager(mockLogger);
    const game = gm.createGame("g-host-leaves", undefined, CREATOR)!;
    game.setListed(true);

    const hostWs = fakeWs();
    const guestWs = fakeWs();
    expect(game.joinClient(makeClient("host", CREATOR, hostWs))).toBe("joined");
    expect(game.joinClient(makeClient("guest", OTHER_CREATOR, guestWs))).toBe(
      "joined",
    );
    expect(gm.listedLobbies()).toHaveLength(1);

    hostWs.emit("close");

    // Remaining players are kicked and the ghost leaves the listing...
    expect(guestWs.close).toHaveBeenCalled();
    expect(game.phase()).toBe(GamePhase.Finished);
    expect(gm.listedLobbies()).toEqual([]);

    // ...and the next manager tick prunes the game entirely, freeing the
    // creator's one-listing quota.
    gm.tick();
    expect(gm.game("g-host-leaves")).toBeNull();
  });

  it("tears down even when the host socket was already dead on join", () => {
    const gm = new GameManager(mockLogger);
    const game = gm.createGame("g-dead-socket", undefined, CREATOR)!;
    game.setListed(true);

    const hostWs = fakeWs();
    hostWs.readyState = WebSocket.CLOSED;
    game.joinClient(makeClient("host", CREATOR, hostWs));

    expect(game.phase()).toBe(GamePhase.Finished);
    expect(gm.listedLobbies()).toEqual([]);
  });

  it("rejects joins into an ended lobby before it is pruned", () => {
    const game = makeGame();
    (game as any)._hasEnded = true;
    expect(game.joinClient({} as any)).toBe("rejected");
  });

  it("does not tear down when the host disconnects during prestart", () => {
    // During the lobby -> game transition the host modal closes and sockets
    // churn; a starting game (e.g. listed-lobby auto-start) must survive it.
    const gm = new GameManager(mockLogger);
    const game = gm.createGame("g-prestart", undefined, CREATOR)!;
    game.setListed(true);

    const hostWs = fakeWs();
    game.joinClient(makeClient("host", CREATOR, hostWs));
    (game as any)._hasPrestarted = true;

    hostWs.emit("close");

    expect((game as any)._hasEnded).toBe(false);
    expect(game.phase()).not.toBe(GamePhase.Finished);
  });
});

describe("listed lobby host powers", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  const asHost = {
    clientID: "host",
    isLobbyCreator: true,
    isAdmin: false,
    isAdminBot: false,
  };

  it("reports host cheats only when a cheat is actually granted", () => {
    expect(makeGame().hasHostCheats()).toBe(false);
    expect(makeGame("g", CREATOR, { hostCheats: {} }).hasHostCheats()).toBe(
      false,
    );
    expect(
      makeGame("g", CREATOR, {
        hostCheats: { infiniteGold: false, infiniteTroops: false },
      }).hasHostCheats(),
    ).toBe(false);
    expect(
      makeGame("g", CREATOR, {
        hostCheats: { infiniteGold: true },
      }).hasHostCheats(),
    ).toBe(true);
    expect(
      makeGame("g", CREATOR, {
        hostCheats: { goldMultiplier: 2 },
      }).hasHostCheats(),
    ).toBe(true);
  });

  it("blocks host kicks while listed; admins still can", () => {
    const game = makeGame("g-kick");
    game.joinClient(makeClient("host", CREATOR, fakeWs()));
    game.joinClient(makeClient("guest", OTHER_CREATOR, fakeWs()));
    game.setListed(true);

    const kick = { type: "kick_player", targetClientID: "guest" } as any;
    expect(game.handleIntent(kick, asHost).status).toBe(403);

    // Unlisting restores the host's kick power.
    game.setListed(false);
    expect(game.handleIntent(kick, asHost).status).toBe(200);
  });

  it("lets admins kick in a listed lobby", () => {
    const game = makeGame("g-admin-kick");
    game.joinClient(makeClient("host", CREATOR, fakeWs()));
    game.joinClient(makeClient("guest", OTHER_CREATOR, fakeWs()));
    game.setListed(true);

    const asAdmin = {
      clientID: "admin",
      isLobbyCreator: false,
      isAdmin: true,
      isAdminBot: false,
    };
    expect(
      game.handleIntent(
        { type: "kick_player", targetClientID: "guest" } as any,
        asAdmin,
      ).status,
    ).toBe(200);
  });

  it("rejects enabling host cheats while listed", () => {
    const game = makeGame();
    game.setListed(true);

    const cheats = {
      type: "update_game_config",
      config: { hostCheats: { infiniteGold: true } },
    } as any;
    expect(game.handleIntent(cheats, asHost).status).toBe(409);
    expect(game.hasHostCheats()).toBe(false);

    // A neutral hostCheats block still goes through (the client always
    // sends the field), as do real cheats once the lobby is unlisted.
    expect(
      game.handleIntent(
        { type: "update_game_config", config: { hostCheats: {} } } as any,
        asHost,
      ).status,
    ).toBe(200);
    game.setListed(false);
    expect(game.handleIntent(cheats, asHost).status).toBe(200);
    expect(game.hasHostCheats()).toBe(true);
  });
});

function hostedLobby(
  gameID: string,
  creatorID: string | undefined,
  extra: Partial<InternalGameInfo> = {},
): InternalGameInfo {
  return {
    gameID,
    numClients: 0,
    publicGameType: "hosted",
    creatorID,
    ...extra,
  };
}

describe("MasterLobbyService hosted lobbies", () => {
  function createService() {
    vi.spyOn(ServerEnv, "numWorkers").mockReturnValue(2);
    vi.spyOn(ServerEnv, "workerIndex").mockReturnValue(1);
    vi.spyOn(ServerEnv, "gameCreationRate").mockReturnValue(60_000);
    const playlist = {
      gameConfig: vi.fn().mockResolvedValue({ gameType: GameType.Public }),
    };
    const log = { info: vi.fn(), error: vi.fn() } as any;
    const service = new MasterLobbyService(playlist as any, log);

    const workers = [1, 2].map((id) => {
      const worker = new EventEmitter();
      (worker as any).send = vi.fn();
      service.registerWorker(id, worker as any);
      return worker;
    });
    return { service, workers };
  }

  function sentMessages(worker: EventEmitter): any[] {
    return ((worker as any).send as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => c[0],
    );
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("aggregates hosted lobbies and dedupes by creator across workers", () => {
    const { service, workers } = createService();
    workers[0].emit("message", {
      type: "lobbyList",
      lobbies: [
        hostedLobby("bbb", "creator-a"),
        hostedLobby("ccc", "creator-b"),
      ],
    });
    // Same creator listed a second lobby on another worker before the first
    // broadcast landed; only the stable-sort winner may survive.
    workers[1].emit("message", {
      type: "lobbyList",
      lobbies: [hostedLobby("aaa", "creator-a")],
    });

    (service as any).broadcastLobbies();

    const broadcast = sentMessages(workers[0]).find(
      (m) => m.type === "lobbiesBroadcast",
    );
    expect(broadcast).toBeDefined();
    const hosted = broadcast.publicGames.games.hosted;
    expect(hosted.map((l: InternalGameInfo) => l.gameID)).toEqual([
      "aaa",
      "ccc",
    ]);
  });

  it("delists a dedup loser only after two consecutive losing broadcasts", () => {
    const { service, workers } = createService();
    workers[0].emit("message", {
      type: "lobbyList",
      lobbies: [hostedLobby("bbb", "creator-a")],
    });
    workers[1].emit("message", {
      type: "lobbyList",
      lobbies: [hostedLobby("aaa", "creator-a")],
    });

    (service as any).broadcastLobbies();
    (service as any).broadcastLobbies();

    const broadcasts = sentMessages(workers[0]).filter(
      (m) => m.type === "lobbiesBroadcast",
    );
    // First loss could be a stale worker report; only the second in a row
    // triggers the delist.
    expect(broadcasts[0].delistGameIDs).toBeUndefined();
    expect(broadcasts[1].delistGameIDs).toEqual(["bbb"]);
  });

  it("caps hosted lobbies at MAX_HOSTED_LOBBIES and delists the overflow", () => {
    const { service, workers } = createService();
    const lobbies = Array.from({ length: MAX_HOSTED_LOBBIES + 1 }, (_, i) =>
      hostedLobby(`g${String(i).padStart(2, "0")}`, `creator-${i}`),
    );
    workers[0].emit("message", { type: "lobbyList", lobbies });

    (service as any).broadcastLobbies();
    (service as any).broadcastLobbies();

    const broadcasts = sentMessages(workers[0]).filter(
      (m) => m.type === "lobbiesBroadcast",
    );
    expect(broadcasts[0].publicGames.games.hosted).toHaveLength(
      MAX_HOSTED_LOBBIES,
    );
    // The sort loser (highest gameID) is dropped from the broadcast and,
    // after two consecutive losing cycles, delisted.
    expect(broadcasts[0].delistGameIDs).toBeUndefined();
    expect(broadcasts[1].delistGameIDs).toEqual([`g${MAX_HOSTED_LOBBIES}`]);
  });

  it("does not delist when the duplicate disappears after one broadcast", () => {
    const { service, workers } = createService();
    workers[0].emit("message", {
      type: "lobbyList",
      lobbies: [hostedLobby("bbb", "creator-a")],
    });
    workers[1].emit("message", {
      type: "lobbyList",
      lobbies: [hostedLobby("aaa", "creator-a")],
    });
    (service as any).broadcastLobbies();

    // The losing entry was stale: the next report no longer contains it.
    workers[0].emit("message", { type: "lobbyList", lobbies: [] });
    (service as any).broadcastLobbies();

    for (const msg of sentMessages(workers[0])) {
      if (msg.type === "lobbiesBroadcast") {
        expect(msg.delistGameIDs).toBeUndefined();
      }
    }
  });

  it("never schedules or sets countdowns on hosted lobbies", async () => {
    const { service, workers } = createService();
    workers[0].emit("message", {
      type: "lobbyList",
      lobbies: [hostedLobby("hosted1", "creator-a")],
    });

    await (service as any).maybeScheduleLobby();

    for (const worker of workers) {
      for (const msg of sentMessages(worker)) {
        if (msg.type === "updateLobby") {
          expect(msg.gameID).not.toBe("hosted1");
        }
        if (msg.type === "createGame") {
          expect(msg.publicGameType).not.toBe("hosted");
        }
      }
    }
    // The scheduled types still get their replacement lobbies.
    const created = workers.flatMap((w) =>
      sentMessages(w).filter((m) => m.type === "createGame"),
    );
    expect(created.map((m) => m.publicGameType).sort()).toEqual([
      "ffa",
      "special",
      "team",
    ]);
  });
});

describe("WorkerLobbyService hosted lobbies", () => {
  let service: WorkerLobbyService;
  let gm: any;
  let sendToMaster: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    gm = {
      publicLobbies: vi.fn().mockReturnValue([]),
      listedLobbies: vi.fn().mockReturnValue([]),
      game: vi.fn().mockReturnValue(null),
    };
    const server = new EventEmitter();
    service = new WorkerLobbyService(
      server as any,
      { handleUpgrade: vi.fn() } as any,
      gm,
      mockLogger,
    );
    // Never touch the real process IPC channel: vitest forks use it.
    sendToMaster = vi.fn();
    (service as any).sendToMaster = sendToMaster;
  });

  function emitBroadcast(
    games: InternalPublicGames["games"],
    serverTime = 1000,
    delistGameIDs?: string[],
  ) {
    (service as any).handleMasterMessage({
      type: "lobbiesBroadcast",
      publicGames: { serverTime, games },
      delistGameIDs,
    });
  }

  function connectClient() {
    const ws = {
      send: vi.fn(),
      on: vi.fn(),
      readyState: WebSocket.OPEN,
    };
    (service as any).lobbiesWss.emit("connection", ws);
    return ws;
  }

  function sentPayloads(ws: { send: ReturnType<typeof vi.fn> }): any[] {
    return ws.send.mock.calls.map((c) => JSON.parse(c[0]));
  }

  it("reports listed lobbies to master as hosted, with creatorID and without host-only config", () => {
    const game = makeGame("hosted-g1", CREATOR, {
      allowedPublicIds: ["p1"],
      nameReveals: ["c1"],
      nameRevealPublicIds: ["p2"],
      hostCheats: { infiniteGold: true },
    });
    game.setListed(true);
    gm.listedLobbies.mockReturnValue([game]);

    emitBroadcast({ ffa: [], team: [], special: [], hosted: [] });

    const lobbyList = sendToMaster.mock.calls
      .map((c: any[]) => c[0])
      .find((m: any) => m.type === "lobbyList");
    expect(lobbyList.lobbies).toHaveLength(1);
    const reported = lobbyList.lobbies[0];
    expect(reported.publicGameType).toBe("hosted");
    expect(reported.creatorID).toBe(hashPersistentID(CREATOR));
    expect(reported.gameConfig.allowedPublicIds).toBeUndefined();
    expect(reported.gameConfig.nameReveals).toBeUndefined();
    expect(reported.gameConfig.nameRevealPublicIds).toBeUndefined();
    expect(reported.gameConfig.hostCheats).toBeUndefined();
  });

  it("strips creatorID from broadcasts and primed snapshots sent to clients", () => {
    const ws = connectClient();
    emitBroadcast({
      ffa: [],
      team: [],
      special: [],
      hosted: [hostedLobby("g1", "secret-hash")],
    });

    const full = sentPayloads(ws).find((p) => p.type === "full");
    expect(full.games.hosted[0].gameID).toBe("g1");
    expect(full.games.hosted[0].creatorID).toBeUndefined();

    // A client connecting after the broadcast gets the primed snapshot,
    // which must be sanitized too.
    const lateWs = connectClient();
    const primed = sentPayloads(lateWs)[0];
    expect(primed.type).toBe("full");
    expect(primed.games.hosted[0].creatorID).toBeUndefined();
  });

  it("re-sends a full when a hosted lobby's config changes without a gameID change", () => {
    const ws = connectClient();
    // A schema-valid config: an invalid one would be rejected by the IPC
    // message parse and the broadcast silently dropped.
    const games = (gameMap: GameMapType) => ({
      ffa: [],
      team: [],
      special: [],
      hosted: [
        hostedLobby("g1", "hash", {
          gameConfig: {
            gameMap,
            difficulty: Difficulty.Easy,
            donateGold: false,
            donateTroops: false,
            gameType: GameType.Private,
            gameMode: GameMode.FFA,
            gameMapSize: GameMapSize.Normal,
            nations: "default",
            bots: 0,
            infiniteGold: false,
            infiniteTroops: false,
            instantBuild: false,
            randomSpawn: false,
          } as any,
        }),
      ],
    });

    emitBroadcast(games(GameMapType.World), 1000);
    emitBroadcast(games(GameMapType.World), 2000); // unchanged -> counts delta
    emitBroadcast(games(GameMapType.Europe), 3000); // host changed map -> fresh full

    const types = sentPayloads(ws).map((p) => p.type);
    expect(types).toEqual(["full", "counts", "full"]);
  });

  describe("creatorHasListedLobby", () => {
    it("finds other lobbies by the same creator in the master broadcast", () => {
      emitBroadcast({
        ffa: [],
        team: [],
        special: [],
        hosted: [hostedLobby("g1", "hash-a")],
      });

      expect(service.creatorHasListedLobby("hash-a", "other-game")).toBe(true);
      // The lobby being toggled itself does not count.
      expect(service.creatorHasListedLobby("hash-a", "g1")).toBe(false);
      expect(service.creatorHasListedLobby("hash-b", "other-game")).toBe(false);
    });

    it("also checks this worker's own lobbies, ahead of the broadcast", () => {
      const game = makeGame("local-g1", CREATOR);
      game.setListed(true);
      gm.listedLobbies.mockReturnValue([game]);

      const hash = hashPersistentID(CREATOR);
      expect(service.creatorHasListedLobby(hash, "other-game")).toBe(true);
      expect(service.creatorHasListedLobby(hash, "local-g1")).toBe(false);
    });

    it("ignores stale broadcast entries for own games no longer listed", () => {
      // The lobby was just delisted on this worker, but the master broadcast
      // still contains it for a round-trip or two. Local state wins so the
      // creator can immediately list a new lobby.
      const game = makeGame("stale-g1", CREATOR);
      game.setListed(false);
      gm.game.mockImplementation((id: string) =>
        id === "stale-g1" ? game : null,
      );
      const hash = hashPersistentID(CREATOR);
      emitBroadcast({
        ffa: [],
        team: [],
        special: [],
        hosted: [hostedLobby("stale-g1", hash)],
      });

      expect(service.creatorHasListedLobby(hash, "other-game")).toBe(false);

      game.setListed(true);
      expect(service.creatorHasListedLobby(hash, "other-game")).toBe(true);
    });
  });

  it("counts broadcast lobbies plus local listed ones not yet reported", () => {
    const local = makeGame("local-g1", CREATOR);
    local.setListed(true);
    gm.listedLobbies.mockReturnValue([local]);

    emitBroadcast({
      ffa: [],
      team: [],
      special: [],
      hosted: [hostedLobby("g1", "hash-a"), hostedLobby("g2", "hash-b")],
    });
    expect(service.hostedLobbyCount()).toBe(3);

    // Once the local lobby reaches the broadcast it only counts once.
    emitBroadcast({
      ffa: [],
      team: [],
      special: [],
      hosted: [hostedLobby("g1", "hash-a"), hostedLobby("local-g1", "hash-c")],
    });
    expect(service.hostedLobbyCount()).toBe(2);
  });

  it("clears the listed flag when the master delists a duplicate", () => {
    const game = makeGame("dup-g1", CREATOR);
    game.setListed(true);
    gm.game.mockImplementation((id: string) => (id === "dup-g1" ? game : null));

    emitBroadcast({ ffa: [], team: [], special: [], hosted: [] }, 1000, [
      "dup-g1",
      "not-mine",
    ]);

    expect(game.isListed()).toBe(false);
  });
});
