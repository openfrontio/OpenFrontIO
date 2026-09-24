import { beforeEach, describe, expect, it, vi } from "vitest";
import { SendWinnerEvent } from "../../src/client/Transport";
import { EventBus } from "../../src/core/EventBus";
import { GameUpdateType } from "../../src/core/game/GameUpdates";
import { GameID, GameStartInfo } from "../../src/core/Schemas";

const clearSoloSaveMock = vi.fn();
const saveSoloSnapshotMock = vi.fn();

vi.mock("../../src/client/SinglePlayerSaveManager", () => ({
  clearSoloSave: (...args: any[]) => clearSoloSaveMock(...args),
  saveSoloSnapshot: (...args: any[]) => saveSoloSnapshotMock(...args),
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

vi.mock("../../src/client/UserSettings", () => ({
  userSettings: {},
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
      snapshot: vi.fn(async () => new Uint8Array([1, 2, 3])),
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
});
