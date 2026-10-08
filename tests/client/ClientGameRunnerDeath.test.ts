import { GameUpdateType } from "@openfront/engine-api/game/GameUpdates";
import { GameID, GameStartInfo } from "@openfront/engine-api/Schemas";
import { EventBus } from "@openfront/shared/EventBus";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SendWinnerEvent } from "../../src/client/Transport";

const clearSoloSaveMock = vi.fn();
const saveSoloSnapshotMock = vi.fn();

vi.mock("../../src/client/SinglePlayerSaveManager", () => ({
  clearSoloSave: (...args: any[]) => clearSoloSaveMock(...args),
  saveSoloSnapshot: (...args: any[]) => saveSoloSnapshotMock(...args),
  compressSnapshot: vi.fn(async (raw: Uint8Array) => raw),
}));

vi.mock("../../src/client/Auth", () => ({
  getPlayToken: async () => "token-123",
  getPersistentID: () => "user-123",
}));

vi.mock("../../src/client/LocalServer", () => ({
  LocalServer: class {},
}));

vi.mock("../../src/client/sound/SoundManager", () => ({
  SoundManager: class {
    playBackgroundMusic() {}
    dispose() {}
  },
}));

vi.mock("../../src/client/Utils", () => ({
  translateText: (k: string) => k,
  homeHref: () => "/",
  createCanvas: () => document.createElement("canvas"),
}));

vi.mock("../../src/client/hud/ErrorModal", () => ({
  showErrorModal: vi.fn(),
}));

import { ClientGameRunner } from "../../src/client/ClientGameRunner";

describe("ClientGameRunner death detection and save clearing", () => {
  let eventBus: EventBus;
  let mockTransport: any;
  let mockWorker: any;
  let mockGameView: any;
  let mockRenderer: any;
  let mockInput: any;
  let workerCallback: (gu: any) => void;
  let mockPlayer: any;

  beforeEach(() => {
    clearSoloSaveMock.mockClear();
    saveSoloSnapshotMock.mockClear();
    eventBus = new EventBus();

    mockPlayer = {
      hasSpawned: vi.fn(() => true),
      isAlive: vi.fn(() => true),
    };

    mockGameView = {
      inSpawnPhase: vi.fn(() => false),
      myPlayer: vi.fn(() => mockPlayer),
      playerByClientID: vi.fn(() => mockPlayer),
      update: vi.fn(),
    };

    mockWorker = {
      start: vi.fn((cb) => {
        workerCallback = cb;
      }),
      snapshot: vi.fn(async () => ({
        bytes: new Uint8Array([1, 2, 3]),
        tick: 52,
      })),
    };

    mockTransport = {
      isLocal: true,
      turnComplete: vi.fn(),
      disableLocalSave: vi.fn(),
      updateCallback: vi.fn(),
      rejoinGame: vi.fn(),
    };

    mockRenderer = {
      initialize: vi.fn(),
      tick: vi.fn(),
      uiState: { attackRatio: 0.5 },
    };

    mockInput = {
      initialize: vi.fn(),
    };
  });

  function createRunner(isLocal = true) {
    mockTransport.isLocal = isLocal;
    const lobbyConfig = {
      gameStartInfo: { gameID: "game123" as GameID } as GameStartInfo,
      gameRecord: null,
    };

    return new ClientGameRunner(
      lobbyConfig as any,
      "client1",
      eventBus,
      mockRenderer as any,
      mockInput as any,
      mockTransport,
      mockWorker as any,
      mockGameView as any,
      { playBackgroundMusic: vi.fn(), dispose: vi.fn() } as any,
      {} as any,
    );
  }

  it("clears save and disables transport save when local player dies", () => {
    const runner = createRunner(true);
    runner.start();

    // Alive tick: no save clearing
    workerCallback({
      tick: 1,
      updates: { [GameUpdateType.Hash]: [] },
    });
    expect(clearSoloSaveMock).not.toHaveBeenCalled();
    expect(mockTransport.disableLocalSave).not.toHaveBeenCalled();

    // Player dies
    mockPlayer.isAlive.mockReturnValue(false);

    workerCallback({
      tick: 2,
      updates: { [GameUpdateType.Hash]: [] },
    });

    expect(clearSoloSaveMock).toHaveBeenCalledWith("game123");
    expect(mockTransport.disableLocalSave).toHaveBeenCalledTimes(1);

    // Subsequent tick should not redundantly re-trigger
    workerCallback({
      tick: 3,
      updates: { [GameUpdateType.Hash]: [] },
    });
    expect(clearSoloSaveMock).toHaveBeenCalledTimes(1);
    expect(mockTransport.disableLocalSave).toHaveBeenCalledTimes(1);
  });

  it("does not trigger auto-snapshots after player dies", () => {
    const runner = createRunner(true);
    runner.start();

    // Player dies at tick 49
    mockPlayer.isAlive.mockReturnValue(false);
    workerCallback({
      tick: 49,
      updates: { [GameUpdateType.Hash]: [] },
    });

    expect(mockWorker.snapshot).not.toHaveBeenCalled();

    // Tick 50 (auto-snapshot tick)
    workerCallback({
      tick: 50,
      updates: { [GameUpdateType.Hash]: [] },
    });

    // Should NOT call snapshot because player is dead
    expect(mockWorker.snapshot).not.toHaveBeenCalled();
    expect(saveSoloSnapshotMock).not.toHaveBeenCalled();
  });

  it("clears save and disables transport save on SendWinnerEvent", () => {
    createRunner(true);

    eventBus.emit(new SendWinnerEvent(undefined, {}));
    expect(clearSoloSaveMock).toHaveBeenCalledWith("game123");
    expect(mockTransport.disableLocalSave).toHaveBeenCalledTimes(1);
  });

  it("saves solo snapshot using worker tick on auto-snapshot tick", async () => {
    const runner = createRunner(true);
    runner.start();

    // Tick 50 triggers auto-snapshot
    workerCallback({
      tick: 50,
      updates: { [GameUpdateType.Hash]: [] },
    });

    await vi.waitFor(() => {
      expect(mockWorker.snapshot).toHaveBeenCalledTimes(1);
      expect(saveSoloSnapshotMock).toHaveBeenCalledTimes(1);
    });

    expect(saveSoloSnapshotMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      52,
    );
  });

  it("clears snapshotInFlight when worker.snapshot() hangs and times out", async () => {
    vi.useFakeTimers();
    try {
      mockWorker.snapshot = vi.fn().mockReturnValue(new Promise(() => {}));
      const runner = createRunner(true);
      runner.start();

      // Tick 50 triggers auto-snapshot
      workerCallback({
        tick: 50,
        updates: { [GameUpdateType.Hash]: [] },
      });

      expect(mockWorker.snapshot).toHaveBeenCalledTimes(1);

      // Fast-forward past the 5000ms timeout
      await vi.advanceTimersByTimeAsync(5000);

      // Now mockWorker.snapshot resolves normally for the next attempt
      mockWorker.snapshot = vi.fn().mockResolvedValue({
        bytes: new Uint8Array([1, 2, 3]),
        tick: 105,
      });

      // Tick 100 triggers auto-snapshot again
      workerCallback({
        tick: 100,
        updates: { [GameUpdateType.Hash]: [] },
      });

      await vi.waitFor(() => {
        expect(mockWorker.snapshot).toHaveBeenCalledTimes(1);
        expect(saveSoloSnapshotMock).toHaveBeenCalledWith(
          expect.anything(),
          expect.anything(),
          105,
        );
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears saved snapshot if player dies or winner is declared while saveSoloSnapshot is in flight", async () => {
    let resolveSave!: () => void;
    saveSoloSnapshotMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveSave = resolve;
        }),
    );

    const runner = createRunner(true);
    runner.start();

    // Trigger auto-snapshot at tick 50
    workerCallback({
      tick: 50,
      updates: { [GameUpdateType.Hash]: [] },
    });

    await vi.waitFor(() => {
      expect(saveSoloSnapshotMock).toHaveBeenCalledTimes(1);
    });

    clearSoloSaveMock.mockClear();

    // Player dies while saveSoloSnapshot is still in flight
    (runner as any).playerDied = true;

    // saveSoloSnapshot completes
    resolveSave();

    await vi.waitFor(() => {
      expect(clearSoloSaveMock).toHaveBeenCalledWith("game123");
    });
  });

  it("retains saved snapshot if runner is stopped while saveSoloSnapshot is in flight", async () => {
    let resolveSave!: () => void;
    saveSoloSnapshotMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveSave = resolve;
        }),
    );

    const runner = createRunner(true);
    runner.start();

    // Trigger auto-snapshot at tick 50
    workerCallback({
      tick: 50,
      updates: { [GameUpdateType.Hash]: [] },
    });

    await vi.waitFor(() => {
      expect(saveSoloSnapshotMock).toHaveBeenCalledTimes(1);
    });

    clearSoloSaveMock.mockClear();

    // Runner is stopped (e.g. player quits/navigates away)
    (runner as any).isActive = false;

    // saveSoloSnapshot completes
    resolveSave();

    await new Promise((r) => setTimeout(r, 20));
    expect(clearSoloSaveMock).not.toHaveBeenCalled();
  });
});
