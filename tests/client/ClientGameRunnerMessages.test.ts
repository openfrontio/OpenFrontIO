import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "../../src/core/EventBus";
import { GameUpdateType } from "../../src/core/game/GameUpdates";

// ClientGameRunner's server-message handling, driven through captured
// callbacks: the lobby-phase onmessage joinLobby installs on the transport,
// the in-game onmessage ClientGameRunner.start installs, and the worker
// update callback. Heavy renderer/audio/worker modules are mocked at import.

const captured = vi.hoisted(() => ({
  lobbyOnConnect: undefined as (() => void) | undefined,
  lobbyOnMessage: undefined as ((msg: unknown) => void) | undefined,
}));

vi.mock("../../src/client/ClientEnv", () => ({
  ClientEnv: {
    gitCommit: () => "test-commit",
    resolveGame: () => ({ kind: "own" }),
  },
}));
vi.mock("../../src/client/Auth", () => ({
  getPlayToken: async () => "8f1d2c3e-4b5a-4c6d-8e7f-90a1b2c3d4e5",
}));
vi.mock("../../src/client/LocalServer", () => ({
  LocalServer: class {},
}));
vi.mock("../../src/client/InGameModal", () => ({
  showInGameAlert: vi.fn(async () => {}),
  showInGameConfirm: vi.fn(async () => false),
}));
vi.mock("../../src/client/Utils", () => ({
  translateText: (key: string) => key,
  reloadForUpdate: vi.fn(),
  createCanvas: () => document.createElement("canvas"),
  homeHref: () => "/",
}));
vi.mock("../../src/core/game/TerrainMapLoader", () => ({
  loadTerrainMap: vi.fn(async () => ({}) as never),
}));
vi.mock("../../src/client/TerrainMapFileLoader", () => ({
  terrainMapFileLoader: {},
}));
vi.mock("../../src/client/hud/GameRenderer", () => ({
  createRenderer: vi.fn(),
}));
vi.mock("../../src/client/hud/layers/lib/GoldRateTracker", () => ({
  goldRateTracker: { resetAll: vi.fn() },
}));
vi.mock("../../src/client/theme/ThemeProvider", () => ({
  themeProvider: { reset: vi.fn() },
}));
vi.mock("../../src/client/sound/SoundManager", () => ({
  SoundManager: class {},
}));
vi.mock("../../src/client/render/gl", () => ({
  GLUnavailableError: class extends Error {},
  MapRenderer: class {},
  applyGraphicsOverrides: vi.fn(),
  createRenderSettings: vi.fn(() => ({})),
  deepAssign: vi.fn(),
  preloadAtlasData: vi.fn(async () => {}),
  renderDpr: () => 1,
  showGLGate: vi.fn(),
  trackGLInit: vi.fn(),
}));
vi.mock("../../src/client/WebGLFrameBuilder", () => ({
  WebGLFrameBuilder: class {},
}));
vi.mock("../../src/client/controllers/MapLayerController", () => ({
  MapLayerController: class {},
}));
vi.mock("../../src/client/view", () => ({
  GameView: class {},
  PlayerView: class {},
}));
vi.mock("../../src/core/worker/WorkerClient", () => ({
  WorkerClient: class {},
}));
vi.mock("../../src/client/Transport", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/client/Transport")>();
  class MockTransport {
    constructor(..._args: unknown[]) {}
    connect(onconnect: () => void, onmessage: (msg: unknown) => void) {
      captured.lobbyOnConnect = onconnect;
      captured.lobbyOnMessage = onmessage;
    }
    joinGame() {}
    leaveGame() {}
  }
  return { ...actual, Transport: MockTransport };
});

import {
  ClientGameRunner,
  joinLobby,
  LobbyConfig,
} from "../../src/client/ClientGameRunner";
import { SendHashEvent } from "../../src/client/Transport";
import { loadTerrainMap } from "../../src/core/game/TerrainMapLoader";

function makeLobbyConfig(withStartInfo: boolean): LobbyConfig {
  return {
    gameID: "game1234",
    playerName: "tester",
    playerClanTag: null,
    playerRole: null,
    turnstileToken: null,
    cosmetics: {},
    ...(withStartInfo
      ? { gameStartInfo: { gameID: "game1234", config: {} } }
      : {}),
  } as unknown as LobbyConfig;
}

// Builds a runner around fully mocked collaborators, starts it, and returns
// the callbacks start() handed to the transport and the worker.
function makeStartedRunner(withStartInfo: boolean) {
  const eventBus = new EventBus();
  const emitSpy = vi.spyOn(eventBus, "emit");
  const worker = { start: vi.fn(), sendTurn: vi.fn(), cleanup: vi.fn() };
  const transport = {
    updateCallback: vi.fn(),
    rejoinGame: vi.fn(),
    turnComplete: vi.fn(),
    leaveGame: vi.fn(),
    isLocal: true,
  };
  const renderer = {
    initialize: vi.fn(),
    tick: vi.fn(),
    uiState: { attackRatio: 0.5, ghostStructure: null },
    transformHandler: { screenToWorldCoordinates: vi.fn() },
  };
  const gameView = {
    config: () => ({ isRandomSpawn: () => false, isReplay: () => false }),
    inSpawnPhase: () => false,
    myPlayer: () => null,
    update: vi.fn(),
  };
  const soundManager = { playBackgroundMusic: vi.fn(), dispose: vi.fn() };
  const userSettings = { goToPlayer: () => false };

  const runner = new ClientGameRunner(
    makeLobbyConfig(withStartInfo),
    "c0000001",
    eventBus,
    renderer as never,
    { initialize: vi.fn(), destroy: vi.fn() } as never,
    transport as never,
    worker as never,
    gameView as never,
    soundManager as never,
    userSettings as never,
  );
  runner.start();

  const workerCallback = worker.start.mock.calls[0][0] as (gu: unknown) => void;
  const onmessage = transport.updateCallback.mock.calls[0][1] as (
    msg: unknown,
  ) => void;
  return {
    runner,
    worker,
    transport,
    gameView,
    emitSpy,
    workerCallback,
    onmessage,
  };
}

const errorModalText = () =>
  document.querySelector("#error-modal pre")?.textContent ?? "";

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  captured.lobbyOnConnect = undefined;
  captured.lobbyOnMessage = undefined;
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("joinLobby lobby-phase messages", () => {
  it("preloads the terrain and resolves prestart on a prestart message", async () => {
    const result = joinLobby(new EventBus(), makeLobbyConfig(false));

    captured.lobbyOnMessage!({
      type: "prestart",
      gameMap: "world",
      gameMapSize: "medium",
    });

    await expect(result.prestart).resolves.toBeUndefined();
    expect(loadTerrainMap).toHaveBeenCalledWith(
      "world",
      "medium",
      expect.anything(),
      false,
    );
  });

  it("shows the connection-error modal when start carries no gameStartInfo", async () => {
    const result = joinLobby(new EventBus(), makeLobbyConfig(false));

    captured.lobbyOnMessage!({
      type: "start",
      myClientID: "c0000001",
      turns: [],
      gameStartInfo: undefined,
    });

    await expect(result.join).resolves.toBeUndefined();
    await vi.waitFor(() =>
      expect(document.querySelector("#error-modal")).not.toBeNull(),
    );
    expect(errorModalText()).toContain("error_modal.connection_error");
    expect(errorModalText()).toContain("game id: game1234");
    expect(errorModalText()).toContain("Error: missing gameStartInfo");
  });
});

describe("ClientGameRunner in-game messages", () => {
  it("forwards buffered turns to the worker on a start message", () => {
    const { worker, onmessage } = makeStartedRunner(true);
    const turns = [
      { turnNumber: 0, intents: [] },
      { turnNumber: 1, intents: [] },
    ];

    onmessage({ type: "start", turns });

    expect(worker.sendTurn).toHaveBeenCalledTimes(2);
    expect(worker.sendTurn).toHaveBeenNthCalledWith(1, turns[0]);
    expect(worker.sendTurn).toHaveBeenNthCalledWith(2, turns[1]);
  });

  it("shows the desync modal on a desync message", () => {
    const { onmessage } = makeStartedRunner(true);

    onmessage({ type: "desync" });

    expect(errorModalText()).toContain("error_modal.desync_notice");
    expect(errorModalText()).toContain("game id: game1234");
    expect(errorModalText()).toContain("client id: c0000001");
  });

  it("throws on a desync message when gameStartInfo is missing", () => {
    const { onmessage } = makeStartedRunner(false);

    expect(() => onmessage({ type: "desync" })).toThrow(
      "missing gameStartInfo",
    );
  });

  it("forwards a matching turn and rejects a wrong turn number", () => {
    const { worker, onmessage } = makeStartedRunner(true);
    const turn = { turnNumber: 0, intents: [] };

    onmessage({ type: "turn", turn });
    expect(worker.sendTurn).toHaveBeenCalledWith(turn);

    onmessage({ type: "turn", turn: { turnNumber: 5, intents: [] } });
    expect(worker.sendTurn).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith(
      "got wrong turn have turns 1, received turn 5",
    );
  });

  it("processes a worker game update: turnComplete, hash events, render tick", () => {
    const { worker, transport, gameView, emitSpy, workerCallback } =
      makeStartedRunner(true);
    void worker;

    workerCallback({
      updates: { [GameUpdateType.Hash]: [{ tick: 3, hash: 42 }] },
      tickExecutionDuration: 1,
    });

    expect(transport.turnComplete).toHaveBeenCalled();
    expect(emitSpy).toHaveBeenCalledWith(new SendHashEvent(3, 42));
    expect(gameView.update).toHaveBeenCalled();
  });

  it("shows the crash modal and stops on a worker error update", () => {
    const { worker, transport, workerCallback } = makeStartedRunner(true);

    workerCallback({ errMsg: "boom", stack: "trace" });

    expect(errorModalText()).toContain("Error: boom");
    expect(worker.cleanup).toHaveBeenCalled();
    expect(transport.leaveGame).toHaveBeenCalled();
  });

  it("throws on a worker update when gameStartInfo is missing", () => {
    const { workerCallback } = makeStartedRunner(false);

    expect(() => workerCallback({ errMsg: "boom" })).toThrow(
      "missing gameStartInfo",
    );
  });
});
