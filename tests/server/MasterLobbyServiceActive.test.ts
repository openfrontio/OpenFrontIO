import EventEmitter from "events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MasterLobbyService } from "../../src/server/MasterLobbyService";
import { startPolling } from "../../src/server/PollingLoop";
import { ServerEnv } from "../../src/server/ServerEnv";

vi.mock("../../src/server/Logger", () => ({
  logger: {
    child: () => ({
      error: vi.fn(),
      info: vi.fn(),
    }),
  },
}));

// Capture the scheduling loop instead of running it, so a test can invoke a
// single scheduling pass by hand.
vi.mock("../../src/server/PollingLoop", () => ({
  startPolling: vi.fn(),
}));

function createMockWorker(): EventEmitter & { send: ReturnType<typeof vi.fn> } {
  const emitter = new EventEmitter() as EventEmitter & {
    send: ReturnType<typeof vi.fn>;
  };
  emitter.send = vi.fn();
  return emitter;
}

// Every startPolling(task, 1000) call is the lobby scheduler; the 500ms one is
// the broadcast loop.
function schedulerTask(): () => Promise<void> {
  const calls = vi.mocked(startPolling).mock.calls;
  const call = calls.find(([, intervalMs]) => intervalMs === 1000);
  if (call === undefined) throw new Error("scheduler loop was not started");
  return call[0];
}

function createGameMessages(worker: ReturnType<typeof createMockWorker>) {
  return worker.send.mock.calls.filter(([msg]) => msg.type === "createGame");
}

describe("MasterLobbyService active/inactive deployment", () => {
  let worker: ReturnType<typeof createMockWorker>;
  let service: MasterLobbyService;

  beforeEach(() => {
    vi.spyOn(ServerEnv, "numWorkers").mockReturnValue(1);
    const playlist = { gameConfig: vi.fn(async () => ({})) };
    const log = { info: vi.fn(), error: vi.fn() } as any;
    service = new MasterLobbyService(playlist as any, log);
    worker = createMockWorker();
    service.registerWorker(0, worker as any);
    worker.emit("message", { type: "workerReady", workerId: 0 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.mocked(startPolling).mockClear();
  });

  it("schedules public lobbies by default (standalone deployment)", async () => {
    await schedulerTask()();
    expect(createGameMessages(worker).length).toBeGreaterThan(0);
  });

  it("stops scheduling public lobbies once inactive", async () => {
    service.setActive(false);
    await schedulerTask()();
    expect(createGameMessages(worker)).toHaveLength(0);
  });

  it("resumes scheduling when active again", async () => {
    service.setActive(false);
    await schedulerTask()();
    expect(createGameMessages(worker)).toHaveLength(0);

    service.setActive(true);
    await schedulerTask()();
    expect(createGameMessages(worker).length).toBeGreaterThan(0);
  });
});

describe("MasterLobbyService inactive deployment still starts queued lobbies", () => {
  it("assigns a countdown to a lobby that was queued before going inactive", async () => {
    vi.spyOn(ServerEnv, "numWorkers").mockReturnValue(1);
    const playlist = { gameConfig: vi.fn(async () => ({})) };
    const log = { info: vi.fn(), error: vi.fn() } as any;
    const service = new MasterLobbyService(playlist as any, log);
    const worker = createMockWorker();
    service.registerWorker(0, worker as any);
    worker.emit("message", { type: "workerReady", workerId: 0 });

    // Worker reports one queued ffa lobby with no startsAt yet.
    worker.emit("message", {
      type: "lobbyList",
      lobbies: [
        {
          gameID: "QUEUED01",
          publicGameType: "ffa",
          numClients: 0,
          createdAt: 1,
        },
      ],
    });
    service.setActive(false);
    await schedulerTask()();

    const updates = worker.send.mock.calls.filter(
      ([msg]) => msg.type === "updateLobby" && msg.gameID === "QUEUED01",
    );
    expect(updates).toHaveLength(1);
    expect(updates[0][0].startsAt).toBeGreaterThan(0);
    expect(createGameMessages(worker)).toHaveLength(0);
  });
});
