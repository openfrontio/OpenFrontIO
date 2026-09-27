import EventEmitter from "events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PublicGameType } from "../../src/core/Schemas";
import { InternalGameInfo } from "../../src/server/IPCBridgeSchema";
import { MasterLobbyService } from "../../src/server/MasterLobbyService";
import { startPolling } from "../../src/server/PollingLoop";
import { ServerEnv } from "../../src/server/ServerEnv";

vi.mock("../../src/server/Logger", () => ({
  logger: { child: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }) },
}));
vi.mock("../../src/server/PollingLoop", () => ({ startPolling: vi.fn() }));

// The master's two modes (infra docs/lobby-coordinator.md): coordinated
// while the site's lobby coordinator keeps sending rosters — obey its
// createGame/updateLobby, feed workers its roster, schedule nothing of our
// own — and today's single-server behaviour the moment rosters stop.

function createMockWorker() {
  const emitter = new EventEmitter() as EventEmitter & {
    send: ReturnType<typeof vi.fn>;
  };
  emitter.send = vi.fn();
  return emitter;
}

// Only what the service reads from the client: the mode question and the
// report sink. The socket itself is LobbyCoordinatorClient.test.ts's job.
function fakeCoordinator(coordinated: boolean) {
  return {
    coordinated,
    isCoordinated() {
      return this.coordinated;
    },
    report: vi.fn(),
  };
}

function loop(intervalMs: number): () => Promise<void> {
  const call = vi
    .mocked(startPolling)
    .mock.calls.find(([, ms]) => ms === intervalMs);
  if (call === undefined) throw new Error(`no ${intervalMs}ms loop`);
  return call[0];
}
const scheduler = () => loop(1000);
const broadcaster = () => loop(500);

function sent(worker: ReturnType<typeof createMockWorker>, type: string) {
  return worker.send.mock.calls
    .filter(([msg]) => msg.type === type)
    .map(([msg]) => msg);
}

function lobby(
  gameID: string,
  publicGameType: PublicGameType = "ffa",
  extra: Partial<InternalGameInfo> = {},
): InternalGameInfo {
  return { gameID, publicGameType, numClients: 0, createdAt: 1, ...extra };
}

describe("MasterLobbyService with a lobby coordinator", () => {
  let worker: ReturnType<typeof createMockWorker>;
  let service: MasterLobbyService;
  let coordinator: ReturnType<typeof fakeCoordinator>;
  let playlist: { gameConfig: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.stubEnv("DOMAIN", "localhost");
    vi.spyOn(ServerEnv, "numWorkers").mockReturnValue(1);
    playlist = { gameConfig: vi.fn(async () => ({})) };
    const log = { info: vi.fn(), error: vi.fn(), warn: vi.fn() } as any;
    service = new MasterLobbyService(playlist as any, log);
    coordinator = fakeCoordinator(true);
    service.attachCoordinator(coordinator as any);
    worker = createMockWorker();
    service.registerWorker(0, worker as any);
    worker.emit("message", { type: "workerReady", workerId: 0 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.mocked(startPolling).mockClear();
  });

  it("offers every worker report to the coordinator", () => {
    worker.emit("message", {
      type: "lobbyList",
      lobbies: [lobby("OWN1"), { gameID: 7 }],
      liveGames: 3,
    });
    expect(coordinator.report).toHaveBeenCalledTimes(1);
    const [lobbies, liveGames] = coordinator.report.mock.calls[0];
    expect(lobbies.map((l: any) => l.gameID)).toEqual(["OWN1"]);
    expect(liveGames).toBe(3);
  });

  it("schedules nothing of its own while coordinated", async () => {
    worker.emit("message", {
      type: "lobbyList",
      lobbies: [lobby("OWN1")],
    });
    await scheduler()();
    expect(sent(worker, "createGame")).toHaveLength(0);
    expect(sent(worker, "updateLobby")).toHaveLength(0);
  });

  it("feeds workers the coordinator's roster instead of its own lobbies", async () => {
    worker.emit("message", {
      type: "lobbyList",
      lobbies: [lobby("OWN1")],
    });
    service.coordinatorHandlers().onRoster({
      serverTime: 99,
      games: {
        ffa: [lobby("bFOREIGN1", "ffa", { startsAt: 5 }), lobby("OWN1")],
        team: [],
        special: [],
        hosted: [],
      },
      delistGameIDs: [],
    });
    service.setActive(false);
    await broadcaster()();
    const [b] = sent(worker, "lobbiesBroadcast");
    expect(b.publicGames.games.ffa.map((l: any) => l.gameID)).toEqual([
      "bFOREIGN1",
      "OWN1",
    ]);
    // The active flag is still this deployment's own.
    expect(b.active).toBe(false);
    expect(b.delistGameIDs).toBeUndefined();
  });

  it("forwards the coordinator's delists once", async () => {
    service.coordinatorHandlers().onRoster({
      serverTime: 1,
      games: { ffa: [], team: [], special: [], hosted: [] },
      delistGameIDs: ["LOSER1"],
    });
    await broadcaster()();
    await broadcaster()();
    const broadcasts = sent(worker, "lobbiesBroadcast");
    expect(broadcasts[0].delistGameIDs).toEqual(["LOSER1"]);
    expect(broadcasts[1].delistGameIDs).toBeUndefined();
  });

  it("creates a lobby on createGame using its own playlist and id", async () => {
    service.coordinatorHandlers().onCreateGame({
      type: "createGame",
      publicGameType: "team",
      recentMaps: [],
    });
    await vi.waitFor(() => expect(sent(worker, "createGame")).toHaveLength(1));
    const [msg] = sent(worker, "createGame");
    expect(msg.publicGameType).toBe("team");
    expect(msg.gameID.startsWith("a")).toBe(true);
    expect(playlist.gameConfig).toHaveBeenCalledWith("team");
  });

  it("refuses createGame while inactive", async () => {
    service.setActive(false);
    service.coordinatorHandlers().onCreateGame({
      type: "createGame",
      publicGameType: "ffa",
      recentMaps: [],
    });
    await Promise.resolve();
    expect(sent(worker, "createGame")).toHaveLength(0);
    expect(playlist.gameConfig).not.toHaveBeenCalled();
  });

  it("forwards updateLobby for its own lobby only", () => {
    worker.emit("message", {
      type: "lobbyList",
      lobbies: [lobby("OWN1")],
    });
    const handlers = service.coordinatorHandlers();
    handlers.onUpdateLobby({
      type: "updateLobby",
      gameID: "OWN1",
      startsAt: 1234,
    });
    handlers.onUpdateLobby({
      type: "updateLobby",
      gameID: "bFOREIGN1",
      startsAt: 1234,
    });
    expect(sent(worker, "updateLobby")).toEqual([
      { type: "updateLobby", gameID: "OWN1", startsAt: 1234 },
    ]);
  });

  it("falls back to single-server scheduling when rosters stop, and returns", async () => {
    service.coordinatorHandlers().onRoster({
      serverTime: 1,
      games: {
        ffa: [lobby("bFOREIGN1", "ffa", { startsAt: 5 })],
        team: [],
        special: [],
        hosted: [],
      },
      delistGameIDs: [],
    });
    worker.emit("message", { type: "lobbyList", lobbies: [lobby("OWN1")] });

    coordinator.coordinated = false;
    await scheduler()();
    // Local: countdown for own front lobby, and creates to fill the queue.
    expect(sent(worker, "updateLobby")).toHaveLength(1);
    expect(sent(worker, "createGame")).toHaveLength(3);
    await broadcaster()();
    const [b] = sent(worker, "lobbiesBroadcast");
    // Foreign lobbies are dropped from the feed: the coordinator that
    // vouched for them is gone.
    expect(b.publicGames.games.ffa.map((l: any) => l.gameID)).toEqual(["OWN1"]);

    coordinator.coordinated = true;
    worker.send.mockClear();
    await scheduler()();
    expect(sent(worker, "createGame")).toHaveLength(0);
    await broadcaster()();
    expect(
      sent(worker, "lobbiesBroadcast")[0].publicGames.games.ffa.map(
        (l: any) => l.gameID,
      ),
    ).toEqual(["bFOREIGN1"]);
  });

  it("stays local until the first roster even with the client attached", async () => {
    const fresh = fakeCoordinator(false);
    const log = { info: vi.fn(), error: vi.fn(), warn: vi.fn() } as any;
    const s = new MasterLobbyService(playlist as any, log);
    s.attachCoordinator(fresh as any);
    const w = createMockWorker();
    s.registerWorker(0, w as any);
    vi.mocked(startPolling).mockClear();
    w.emit("message", { type: "workerReady", workerId: 0 });
    await scheduler()();
    expect(sent(w, "createGame").length).toBeGreaterThan(0);
  });
});
