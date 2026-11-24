import { GameUpdateType } from "@openfront/engine-api/game/GameUpdates";
import { EventBus } from "@openfront/shared/EventBus";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { capturePagePin, resetPagePinForTests } from "../../src/client/PagePin";

// ClientGameRunner's server-message handling, driven through captured
// callbacks: the lobby-phase onmessage joinLobby installs on the transport,
// the in-game onmessage ClientGameRunner.start installs, and the worker
// update callback. Heavy renderer/audio/worker modules are mocked at import.

const captured = vi.hoisted(() => ({
  lobbyOnConnect: undefined as (() => void) | undefined,
  lobbyOnMessage: undefined as ((msg: unknown) => void) | undefined,
}));

const envMocks = vi.hoisted(() => ({
  resolveGame: vi.fn((): unknown => ({ kind: "own" })),
  // A label naming no commit matches any server (versionMatches), so the
  // versioned-page branch never fires: what most of this file wants. The
  // versioned-page tests set a real sha.
  gitCommit: vi.fn(() => "test-commit"),
  gameVersion: vi.fn((_gameID: string): string | undefined => undefined),
}));

vi.mock("../../src/client/ClientEnv", () => ({
  ClientEnv: {
    gitCommit: envMocks.gitCommit,
    resolveGame: envMocks.resolveGame,
    gameVersion: envMocks.gameVersion,
    gamePath: (gameID: string) => `/w0/game/${gameID}`,
  },
}));
vi.mock("../../src/client/Auth", () => ({
  getPlayToken: async () => "8f1d2c3e-4b5a-4c6d-8e7f-90a1b2c3d4e5",
  getPersistentID: () => "8f1d2c3e-4b5a-4c6d-8e7f-90a1b2c3d4e5",
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
  exitGame: vi.fn(() => {
    window.location.href = "/";
  }),
}));
vi.mock("../../src/client/TerrainMapFileLoader", () => ({
  terrainMapFileLoader: {},
  loadCachedTerrainMap: vi.fn(
    async () =>
      ({
        gameMap: {
          width: () => 10,
          height: () => 10,
          ref: () => 0,
          terrainByte: () => 0,
        },
      }) as never,
  ),
}));
vi.mock("../../src/client/hud/GameRenderer", () => ({
  createRenderer: vi.fn(() => ({
    initialize: vi.fn(),
    dispose: vi.fn(),
    uiState: { attackRatio: 0.5, ghostStructure: null },
    transformHandler: {
      scale: 1,
      offsetX: 0,
      offsetY: 0,
      observeCanvasSize: vi.fn(() => ({ disconnect: vi.fn() })),
      updateCanvasBoundingRect: vi.fn(),
      centerAll: vi.fn(),
      screenToWorldCoordinates: vi.fn(),
    },
  })),
}));
vi.mock("../../src/client/hud/layers/lib/GoldRateTracker", () => ({
  goldRateTracker: { resetAll: vi.fn() },
}));
vi.mock("../../src/client/theme/ThemeProvider", () => ({
  themeProvider: { reset: vi.fn() },
}));
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
}

vi.mock("../../src/client/sound/SoundManager", () => ({
  SoundManager: class {
    playBackgroundMusic() {}
    dispose() {}
  },
}));
vi.mock("../../src/client/sound/AudioMixer", () => ({
  audioMixer: () => ({}),
  initAudioMixer: () => ({}),
}));
vi.mock("../../src/client/InputHandler", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/client/InputHandler")>();
  class MockInputHandler {
    initialize = vi.fn();
    destroy = vi.fn();
  }
  return {
    ...actual,
    InputHandler: MockInputHandler,
  };
});
vi.mock("../../src/client/render/gl", () => ({
  GLUnavailableError: class extends Error {},
  MapRenderer: class {
    glLimited = null;
    getSettings() {
      return {};
    }
    rebuildTerrain() {}
    applyTerrainRects() {}
    uploadTileAndTrailState() {}
    updateStructures() {}
    uploadRailroadState() {}
    updateRelations() {}
    dispose() {}
    setCameraState() {}
    showMoveIndicator() {}
  },
  applyGraphicsOverrides: vi.fn(),
  createRenderSettings: vi.fn(() => ({})),
  deepAssign: vi.fn(),
  preloadAtlasData: vi.fn(async () => {}),
  renderDpr: () => 1,
  showGLGate: vi.fn(),
  trackGLInit: vi.fn(),
}));
vi.mock("../../src/client/WebGLFrameBuilder", () => ({
  WebGLFrameBuilder: class {
    clearCaches() {}
    update() {}
    refreshNames() {}
    refreshPalette() {}
    refreshCosmetics() {}
    setEffectOverride() {}
  },
}));
vi.mock("../../src/client/controllers/MapLayerController", () => ({
  MapLayerController: class {},
}));
vi.mock("../../src/client/view", () => ({
  GameView: class {
    config() {
      return {
        isRandomSpawn: () => false,
        isReplay: () => false,
      };
    }
    isCatchingUp() {
      return false;
    }
    inSpawnPhase() {
      return false;
    }
    myPlayer() {
      return null;
    }
    update() {}
    refreshPlayerColors() {}
    invalidateTeamClanTags() {}
    frameData() {
      return {
        tileState: new Uint8Array(),
        trailState: new Uint8Array(),
        units: new Map(),
        railroadState: new Uint8Array(),
        relationMatrix: new Uint8Array(),
        relationSize: 0,
      };
    }
    terrainByte() {
      return 0;
    }
    x() {
      return 0;
    }
    y() {
      return 0;
    }
    unit() {
      return undefined;
    }
  },
  PlayerView: class {},
}));
vi.mock("../../src/client/WorkerClient", () => ({
  WorkerClient: class {
    async initialize(): Promise<void> {}
    cleanup(): void {}
    start(_cb?: unknown): void {}
    sendTurn(_turn?: unknown): void {}
  },
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
import type { GameHealthIndicators } from "../../src/client/hud/layers/GameHealthIndicators";
import { MouseUpEvent } from "../../src/client/InputHandler";
import { loadCachedTerrainMap } from "../../src/client/TerrainMapFileLoader";
import { SendHashEvent } from "../../src/client/Transport";
import { reloadForUpdate } from "../../src/client/Utils";
import { WorkerClient } from "../../src/client/WorkerClient";

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

const startedRunners: ClientGameRunner[] = [];

// Builds a runner around fully mocked collaborators, starts it, and returns
// the callbacks start() handed to the transport and the worker.
function makeStartedRunner(
  withStartInfo: boolean,
  opts: { isLocal?: boolean; isReplay?: boolean; metrics?: object } = {},
) {
  const eventBus = new EventBus();
  const emitSpy = vi.spyOn(eventBus, "emit");
  const worker = { start: vi.fn(), sendTurn: vi.fn(), cleanup: vi.fn() };
  const transport = {
    updateCallback: vi.fn(),
    rejoinGame: vi.fn(),
    turnComplete: vi.fn(),
    leaveGame: vi.fn(),
    isLocal: opts.isLocal ?? true,
  };
  const renderer = {
    initialize: vi.fn(),
    tick: vi.fn(),
    uiState: { attackRatio: 0.5, ghostStructure: null },
    transformHandler: { screenToWorldCoordinates: vi.fn() },
  };
  const gameView = {
    config: () => ({
      isRandomSpawn: () => false,
      isReplay: () => opts.isReplay ?? false,
    }),
    isCatchingUp: vi.fn(() => false),
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
    null,
    null,
    null,
    (opts.metrics ?? null) as never,
  );
  runner.start();
  startedRunners.push(runner);

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
  startedRunners.splice(0).forEach((runner) => runner.stop());
  vi.useRealTimers();
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
    expect(loadCachedTerrainMap).toHaveBeenCalledWith("world", "medium");
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

  it("cleans up worker and skips DOM/WebGL setup if stopped before worker.initialize() resolves", async () => {
    let resolveWorkerInit: () => void = () => {};
    const workerInitPromise = new Promise<void>((res) => {
      resolveWorkerInit = res;
    });

    const appendChildSpy = vi.spyOn(document.body, "appendChild");
    const insertBeforeSpy = vi.spyOn(document.body, "insertBefore");
    const appendSpy = vi.spyOn(document.body, "append");
    const cleanupSpy = vi.spyOn(WorkerClient.prototype, "cleanup");
    const startSpy = vi.spyOn(ClientGameRunner.prototype, "start");

    const result = joinLobby(new EventBus(), makeLobbyConfig(false));

    vi.spyOn(WorkerClient.prototype, "initialize").mockImplementation(() => {
      // Called after terrain load completed and passed isStopped check;
      // invoke stop() now while createClientGame is still awaiting worker init.
      result.stop();
      return workerInitPromise;
    });

    captured.lobbyOnMessage!({
      type: "start",
      myClientID: "c0000001",
      turns: [],
      gameStartInfo: {
        gameID: "game1234",
        config: { gameMap: "world", gameMapSize: "medium" },
        players: [],
      },
    });

    // Wait until worker.initialize has been invoked (and called result.stop())
    await vi.waitFor(() => {
      expect(WorkerClient.prototype.initialize).toHaveBeenCalled();
    });

    // Now resolve worker.initialize; createClientGame should abort before DOM/WebGL setup
    resolveWorkerInit();
    await result.join;
    await vi.waitFor(() => {
      expect(cleanupSpy).toHaveBeenCalled();
    });

    expect(startSpy).not.toHaveBeenCalled();
    expect(document.getElementById("game-input-overlay")).toBeNull();
    expect(document.getElementById("webgl-debug-canvas")).toBeNull();

    const insertedNodes = [
      ...appendChildSpy.mock.calls.map(([node]) => node),
      ...insertBeforeSpy.mock.calls.map(([node]) => node),
      ...appendSpy.mock.calls.flat(),
    ];
    for (const node of insertedNodes) {
      if (node instanceof Element) {
        expect(node.id).not.toBe("game-input-overlay");
        expect(node.id).not.toBe("webgl-debug-canvas");
      }
      if (node instanceof Element || node instanceof DocumentFragment) {
        expect(
          node.querySelector("#game-input-overlay, #webgl-debug-canvas"),
        ).toBeNull();
      }
    }
  });

  it("skips worker initialization if stopped before terrain load completes", async () => {
    let resolveTerrain: (val: unknown) => void = () => {};
    const terrainPromise = new Promise((res) => {
      resolveTerrain = res;
    });
    vi.mocked(loadCachedTerrainMap).mockReturnValueOnce(
      terrainPromise as never,
    );

    const workerInitSpy = vi.spyOn(WorkerClient.prototype, "initialize");
    const startSpy = vi.spyOn(ClientGameRunner.prototype, "start");

    const result = joinLobby(new EventBus(), makeLobbyConfig(false));

    captured.lobbyOnMessage!({
      type: "start",
      myClientID: "c0000001",
      turns: [],
      gameStartInfo: {
        gameID: "game1234",
        config: { gameMap: "world", gameMapSize: "medium" },
        players: [],
      },
    });

    // Call stop() while terrain load is still pending
    result.stop();

    // Now resolve terrain load
    resolveTerrain({
      gameMap: {
        width: () => 10,
        height: () => 10,
        ref: () => 0,
        terrainByte: () => 0,
      },
    });
    await result.join;
    await terrainPromise;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(workerInitSpy).not.toHaveBeenCalled();
    expect(startSpy).not.toHaveBeenCalled();
  });

  it("cleans up worker when stop() is called on an inactive runner", () => {
    const unstartedWorker = {
      start: vi.fn(),
      sendTurn: vi.fn(),
      cleanup: vi.fn(),
    };
    const unstartedRunner = new ClientGameRunner(
      makeLobbyConfig(true),
      "c0000001",
      new EventBus(),
      { initialize: vi.fn(), tick: vi.fn(), dispose: vi.fn() } as never,
      { initialize: vi.fn(), destroy: vi.fn() } as never,
      { leaveGame: vi.fn(), isLocal: true } as never,
      unstartedWorker as never,
      {
        config: () => ({ isRandomSpawn: () => false, isReplay: () => false }),
        inSpawnPhase: () => false,
      } as never,
      { playBackgroundMusic: vi.fn(), dispose: vi.fn() } as never,
      { goToPlayer: () => false } as never,
      null,
      null,
      null,
      null,
    );
    unstartedRunner.stop();
    expect(unstartedWorker.cleanup).toHaveBeenCalled();
  });

  it("notifies onTurnstileTokenAdmitted at most once across repeated lobby_info and start messages", async () => {
    const onTurnstileTokenAdmitted = vi.fn();
    const config = makeLobbyConfig(false);
    config.turnstileToken = "turnstile-token";
    config.onTurnstileTokenAdmitted = onTurnstileTokenAdmitted;

    const result = joinLobby(new EventBus(), config);
    const lobbyInfoMsg = {
      type: "lobby_info",
      myClientID: "c0000001",
      lobby: {
        gameID: "game1234",
        serverTime: 1_700_000_000_000,
        clients: [],
      },
    };

    captured.lobbyOnMessage!(lobbyInfoMsg);
    expect(onTurnstileTokenAdmitted).toHaveBeenCalledTimes(1);

    captured.lobbyOnMessage!(lobbyInfoMsg);
    expect(onTurnstileTokenAdmitted).toHaveBeenCalledTimes(1);

    captured.lobbyOnMessage!({
      type: "start",
      myClientID: "c0000001",
      turns: [],
      gameStartInfo: {
        gameID: "game1234",
        config: { gameMap: "world", gameMapSize: "medium" },
        players: [],
      },
    });
    result.stop();
    await result.join;

    expect(onTurnstileTokenAdmitted).toHaveBeenCalledTimes(1);
  });

  it("notifies onTurnstileTokenAdmitted on start when turnstileToken is updated from null before admission", async () => {
    const onTurnstileTokenAdmitted = vi.fn();
    const config = makeLobbyConfig(false);
    config.turnstileToken = null;
    config.onTurnstileTokenAdmitted = onTurnstileTokenAdmitted;

    const result = joinLobby(new EventBus(), config);

    // Simulates fallback updating lobbyConfig.turnstileToken prior to admission.
    config.turnstileToken = "fallback-turnstile-token";

    captured.lobbyOnMessage!({
      type: "start",
      myClientID: "c0000001",
      turns: [],
      gameStartInfo: {
        gameID: "game1234",
        config: { gameMap: "world", gameMapSize: "medium" },
        players: [],
      },
    });
    result.stop();
    await result.join;

    expect(onTurnstileTokenAdmitted).toHaveBeenCalledTimes(1);
  });

  it.each([null, ""])(
    "does not notify onTurnstileTokenAdmitted when turnstileToken is %j",
    async (token) => {
      const onTurnstileTokenAdmitted = vi.fn();
      const config = makeLobbyConfig(false);
      config.turnstileToken = token;
      config.onTurnstileTokenAdmitted = onTurnstileTokenAdmitted;

      const result = joinLobby(new EventBus(), config);

      captured.lobbyOnMessage!({
        type: "lobby_info",
        myClientID: "c0000001",
        lobby: {
          gameID: "game1234",
          serverTime: 1_700_000_000_000,
          clients: [],
        },
      });
      captured.lobbyOnMessage!({
        type: "start",
        myClientID: "c0000001",
        turns: [],
        gameStartInfo: {
          gameID: "game1234",
          config: { gameMap: "world", gameMapSize: "medium" },
          players: [],
        },
      });
      result.stop();
      await result.join;

      expect(onTurnstileTokenAdmitted).not.toHaveBeenCalled();
    },
  );
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

    onmessage({ type: "start", turns: [] });
    onmessage({ type: "turn", turn });
    expect(worker.sendTurn).toHaveBeenCalledWith(turn);

    onmessage({ type: "turn", turn: { turnNumber: 5, intents: [] } });
    expect(worker.sendTurn).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith(
      "got wrong turn have turns 1, received turn 5",
    );
  });

  // The (re)join's start message replays every turn so far, so live turns
  // that beat it there are expected to be dropped: debug, not an error.
  it("only logs a wrong turn at debug while a start message is awaited", () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    const { worker, transport, onmessage } = makeStartedRunner(true);
    const onconnect = transport.updateCallback.mock.calls[0][0] as () => void;

    onmessage({ type: "turn", turn: { turnNumber: 3, intents: [] } });
    expect(debug).toHaveBeenCalledWith(
      "got wrong turn have turns 0, received turn 3",
    );

    const turns = [0, 1, 2, 3].map((turnNumber) => ({
      turnNumber,
      intents: [],
    }));
    onmessage({ type: "start", turns });
    expect(worker.sendTurn).toHaveBeenCalledTimes(4);

    onconnect();
    onmessage({ type: "turn", turn: { turnNumber: 6, intents: [] } });
    expect(debug).toHaveBeenCalledWith(
      "got wrong turn have turns 4, received turn 6",
    );
    expect(console.error).not.toHaveBeenCalled();
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

  it("feeds tick execution and wire tick interval to the game metrics", () => {
    const metrics = {
      start: vi.fn(),
      stop: vi.fn(),
      recordTickExecution: vi.fn(),
      recordTickInterval: vi.fn(),
    };
    const { runner, onmessage, workerCallback } = makeStartedRunner(true, {
      isLocal: false,
      metrics,
    });
    expect(metrics.start).toHaveBeenCalledTimes(1);

    const now = vi.spyOn(Date, "now");
    now.mockReturnValue(1000);
    onmessage({ type: "turn", turn: { turnNumber: 0, intents: [] } });
    now.mockReturnValue(1130);
    onmessage({ type: "turn", turn: { turnNumber: 1, intents: [] } });
    // The first turn has nothing to measure against.
    expect(metrics.recordTickInterval.mock.calls).toEqual([[130]]);

    workerCallback({
      tickExecutionDuration: 4.5,
      updates: { [GameUpdateType.Hash]: [] },
    });
    workerCallback({ updates: { [GameUpdateType.Hash]: [] } });
    expect(metrics.recordTickExecution.mock.calls).toEqual([[4.5]]);

    runner.stop();
    expect(metrics.stop).toHaveBeenCalledTimes(1);
  });

  it("does not measure the tick interval of a local game", () => {
    const metrics = {
      start: vi.fn(),
      stop: vi.fn(),
      recordTickExecution: vi.fn(),
      recordTickInterval: vi.fn(),
    };
    const { onmessage } = makeStartedRunner(true, { isLocal: true, metrics });
    onmessage({ type: "turn", turn: { turnNumber: 0, intents: [] } });
    onmessage({ type: "turn", turn: { turnNumber: 1, intents: [] } });
    expect(metrics.recordTickInterval).not.toHaveBeenCalled();
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

describe("ClientGameRunner health diagnostics", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  });

  const indicators = () =>
    document.querySelector<GameHealthIndicators>("game-health-indicators")!;
  const startMessage = { type: "start", turns: [] };
  const turnMessage = { type: "turn", turn: { turnNumber: 0, intents: [] } };

  it("detects a stalled connection without worker updates, then clears on a turn", async () => {
    const { runner, onmessage } = makeStartedRunner(true, { isLocal: false });
    const hud = indicators();
    expect(hud).not.toBeNull();
    vi.advanceTimersByTime(1000);
    expect(hud.status.connectionUnstable).toBe(false);

    onmessage(startMessage);
    vi.advanceTimersByTime(499);
    expect(hud.status.connectionUnstable).toBe(false);
    vi.advanceTimersByTime(1);
    expect(hud.status.connectionUnstable).toBe(true);
    await hud.updateComplete;
    expect(hud.shadowRoot?.querySelectorAll("button")).toHaveLength(1);

    onmessage(turnMessage);
    vi.advanceTimersByTime(250);
    expect(hud.status.connectionUnstable).toBe(false);
    await hud.updateComplete;
    expect(hud.shadowRoot?.querySelectorAll("button")).toHaveLength(0);

    runner.stop();
    expect(indicators()).toBeNull();
    vi.advanceTimersByTime(1000);
    expect(indicators()).toBeNull();
  });

  it.each([
    { isLocal: true, isReplay: false },
    { isLocal: false, isReplay: true },
  ])(
    "suppresses network warnings for $isLocal local / $isReplay replay",
    (opts) => {
      const { onmessage } = makeStartedRunner(true, opts);
      onmessage(startMessage);
      vi.advanceTimersByTime(1000);
      expect(indicators().status.connectionUnstable).toBe(false);
      expect(indicators().status.highLatency).toBe(false);
    },
  );

  it("clears on reconnect and gives the new start a fresh turn deadline", () => {
    const { onmessage, transport } = makeStartedRunner(true, {
      isLocal: false,
    });
    onmessage(startMessage);
    vi.advanceTimersByTime(500);
    expect(indicators().status.connectionUnstable).toBe(true);
    const onconnect = transport.updateCallback.mock.calls[0][0] as () => void;
    onconnect();
    expect(indicators().status.connectionUnstable).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(indicators().status.connectionUnstable).toBe(false);
    onmessage(startMessage);
    vi.advanceTimersByTime(250);
    expect(indicators().status.connectionUnstable).toBe(false);
    vi.advanceTimersByTime(250);
    expect(indicators().status.connectionUnstable).toBe(true);
  });

  it("suppresses a deliberate pause and resets the deadline when play resumes", () => {
    const { onmessage, workerCallback } = makeStartedRunner(true, {
      isLocal: false,
    });
    onmessage(startMessage);
    const pause = (paused: boolean) =>
      workerCallback({
        updates: {
          [GameUpdateType.Hash]: [],
          [GameUpdateType.GamePaused]: [
            { type: GameUpdateType.GamePaused, paused },
          ],
        },
      });
    pause(true);
    vi.advanceTimersByTime(1500);
    expect(indicators().status.connectionUnstable).toBe(false);
    pause(false);
    vi.advanceTimersByTime(250);
    expect(indicators().status.connectionUnstable).toBe(false);
    vi.advanceTimersByTime(250);
    expect(indicators().status.connectionUnstable).toBe(true);
  });

  it("sends measured pong RTT to telemetry and displays a spike against match baseline", () => {
    const metrics = {
      start: vi.fn(),
      stop: vi.fn(),
      recordRoundTrip: vi.fn(),
    };
    const { onmessage } = makeStartedRunner(true, { isLocal: false, metrics });
    onmessage(startMessage);
    const pong = (rtt: number) =>
      onmessage({
        type: "pong",
        sentAt: Math.floor(performance.now()) - rtt,
      });
    for (let sample = 0; sample < 3; sample++) {
      vi.advanceTimersByTime(1000);
      pong(40);
    }
    expect(indicators().status.highLatency).toBe(false);
    vi.advanceTimersByTime(1000);
    pong(200);
    expect(metrics.recordRoundTrip).toHaveBeenLastCalledWith(200);
    expect(indicators().status.highLatency).toBe(true);
    vi.advanceTimersByTime(1000);
    pong(40);
    expect(indicators().status.highLatency).toBe(false);
  });

  it("reports sustained catch-up as performance trouble in a local game", async () => {
    const { onmessage, gameView } = makeStartedRunner(true, { isLocal: true });
    onmessage(startMessage);
    gameView.isCatchingUp.mockReturnValue(true);
    vi.advanceTimersByTime(1000);
    expect(indicators().status.performance).toBe(false);
    vi.advanceTimersByTime(250);
    expect(indicators().status.performance).toBe(true);
    expect(indicators().status.highLatency).toBe(false);
    expect(indicators().status.connectionUnstable).toBe(false);
    await indicators().updateComplete;
    expect(
      indicators().shadowRoot?.querySelector("[data-warning=performance]"),
    ).not.toBeNull();
    gameView.isCatchingUp.mockReturnValue(false);
    vi.advanceTimersByTime(250);
    expect(indicators().status.performance).toBe(false);
  });

  it("hides warnings while backgrounded and starts a fresh deadline on return", () => {
    const hidden = vi.spyOn(document, "hidden", "get");
    const { onmessage } = makeStartedRunner(true, { isLocal: false });
    onmessage(startMessage);
    vi.advanceTimersByTime(500);
    expect(indicators().status.connectionUnstable).toBe(true);
    hidden.mockReturnValue(true);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(indicators().status.connectionUnstable).toBe(false);
    vi.advanceTimersByTime(1000);
    hidden.mockReturnValue(false);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(indicators().status.connectionUnstable).toBe(false);
    vi.advanceTimersByTime(500);
    expect(indicators().status.connectionUnstable).toBe(true);
  });
});

// A version mismatch on a page pinned under /v/<commit>/ (multi-server v2).
// Reloading is the one thing that must not happen there: reloadForUpdate
// strips the pin, landing on `latest`, whose handleUrl sees the same game on
// the same older server and pins the page straight back -- one lap per click.
describe("version_mismatch on a pinned /v/<commit>/ page", () => {
  const realLocation = window.location;

  function stubLocation(pathname: string) {
    Object.defineProperty(window, "location", {
      value: { href: `https://openfront.io${pathname}`, pathname, search: "" },
      writable: true,
      configurable: true,
    });
    // The mismatch handler reads the pin captured at boot, so a restubbed
    // location only counts once the captured value is dropped.
    resetPagePinForTests();
  }

  afterEach(() => {
    Object.defineProperty(window, "location", {
      value: realLocation,
      writable: true,
      configurable: true,
    });
    envMocks.resolveGame.mockReturnValue({ kind: "own" });
    vi.mocked(reloadForUpdate).mockClear();
    resetPagePinForTests();
  });

  it("goes to the game's own host instead of reloading", () => {
    stubLocation("/v/5ccc50a7/game/game1234");
    envMocks.resolveGame.mockReturnValue({
      kind: "cross",
      host: "falk2-a.openfront.io",
      numWorkers: 16,
    });
    joinLobby(new EventBus(), makeLobbyConfig(false));

    captured.lobbyOnMessage!({
      type: "error",
      error: "version_mismatch",
      gitCommit: "server-commit",
    });

    expect(window.location.href).toBe(
      "https://falk2-a.openfront.io/game/game1234",
    );
    expect(reloadForUpdate).not.toHaveBeenCalled();
  });

  it("does not reload when the game is on this page's own server either", async () => {
    // Nothing this page can fetch is the build it needs -- that is what a
    // mismatch on a PINNED page means. Say so and stop.
    stubLocation("/v/5ccc50a7/game/game1234");
    joinLobby(new EventBus(), makeLobbyConfig(false));

    captured.lobbyOnMessage!({
      type: "error",
      error: "version_mismatch",
      gitCommit: "server-commit",
    });

    // The old path reloaded from the alert's .then, so drain the microtask
    // queue before believing the negative -- otherwise this passes either
    // way. The unpinned case below proves the same flush DOES see a reload.
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(reloadForUpdate).not.toHaveBeenCalled();
  });

  it("still reloads an ordinary stale tab that is not pinned", async () => {
    stubLocation("/game/game1234");
    joinLobby(new EventBus(), makeLobbyConfig(false));

    captured.lobbyOnMessage!({
      type: "error",
      error: "version_mismatch",
      gitCommit: "server-commit",
    });

    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(reloadForUpdate).toHaveBeenCalled();
  });

  // The regression this pin exists for. The join flow rewrites the address
  // bar to the version-free SHARE url (Main.updateJoinUrlForShare) before a
  // mismatch can arrive, so a handler reading window.location.pathname live
  // sees an unpinned page and reloads -- onto `latest`, which re-pins to the
  // same older server, forever. The pin is taken at boot and does not move.
  it("stays pinned after the share-URL rewrite drops the prefix", async () => {
    stubLocation("/v/5ccc50a7/game/game1234");
    capturePagePin();

    // What history.replaceState(null, "", "/game/<id>") leaves behind.
    (window.location as unknown as { pathname: string }).pathname =
      "/game/game1234";

    joinLobby(new EventBus(), makeLobbyConfig(false));

    captured.lobbyOnMessage!({
      type: "error",
      error: "version_mismatch",
      gitCommit: "server-commit",
    });

    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(reloadForUpdate).not.toHaveBeenCalled();
  });
});

// The first choice on a web mismatch: this host serves every version under
// `/v/<commit>/`, one same-origin navigation away, where the cross-host
// fallback costs a full shell boot (OPE-471).
describe("version_mismatch takes the versioned page on this host first", () => {
  const OWN = "bfd5563a11111111111111111111111111111111";
  const OLD = "5ccc50a722222222222222222222222222222222";
  const SHORT_OLD = "5ccc50a";
  const realLocation = window.location;

  function stubLocation(pathname: string) {
    Object.defineProperty(window, "location", {
      value: {
        href: `https://openfront.io${pathname}`,
        hostname: "openfront.io",
        pathname,
        search: "",
      },
      writable: true,
      configurable: true,
    });
    resetPagePinForTests();
  }

  function sendMismatch(gitCommit: string | undefined) {
    joinLobby(new EventBus(), makeLobbyConfig(false));
    captured.lobbyOnMessage!({
      type: "error",
      error: "version_mismatch",
      gitCommit,
    });
  }

  beforeEach(() => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    envMocks.gitCommit.mockReturnValue(OWN);
    envMocks.gameVersion.mockReturnValue(undefined);
  });

  afterEach(() => {
    Object.defineProperty(window, "location", {
      value: realLocation,
      writable: true,
      configurable: true,
    });
    envMocks.gitCommit.mockReturnValue("test-commit");
    envMocks.gameVersion.mockReturnValue(undefined);
    envMocks.resolveGame.mockReturnValue({ kind: "own" });
    vi.mocked(reloadForUpdate).mockClear();
    resetPagePinForTests();
  });

  it("goes to the game's version on this host rather than to its host", async () => {
    stubLocation("/game/game1234");
    envMocks.gameVersion.mockReturnValue(OLD);
    envMocks.resolveGame.mockReturnValue({
      kind: "cross",
      host: "falk2-a.openfront.io",
      numWorkers: 16,
    });

    sendMismatch(OLD);

    expect(window.location.href).toBe(`/v/${SHORT_OLD}/game/game1234`);
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(reloadForUpdate).not.toHaveBeenCalled();
  });

  // A legacy id with no letter, or a letter deployed after this page
  // fetched its list; the refusing server names its own build regardless.
  it("uses the refusing server's own commit when the list knows none", () => {
    stubLocation("/game/game1234");
    envMocks.gameVersion.mockReturnValue(undefined);

    sendMismatch(OLD);

    expect(window.location.href).toBe(`/v/${SHORT_OLD}/game/game1234`);
  });

  // The loop guard reads the pin, not the address bar: the join has already
  // rewritten the bar version-free, so the page looks unpinned here.
  it("stays put on a page already pinned to the version the server names", async () => {
    stubLocation(`/v/${SHORT_OLD}/game/game1234`);
    capturePagePin();
    (window.location as unknown as { pathname: string }).pathname =
      "/game/game1234";
    envMocks.gameVersion.mockReturnValue(OLD);

    sendMismatch(OLD);

    expect(window.location.href).toBe(
      `https://openfront.io/v/${SHORT_OLD}/game/game1234`,
    );
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(reloadForUpdate).not.toHaveBeenCalled();
  });

  // The list is stale-while-revalidate and may still name the build the
  // join was attempted on; the server that refused it does not.
  it("prefers the refusing server's commit over a stale list", () => {
    stubLocation("/game/game1234");
    envMocks.gameVersion.mockReturnValue(OWN);

    sendMismatch(OLD);

    expect(window.location.href).toBe(`/v/${SHORT_OLD}/game/game1234`);
  });

  // GIT_COMMIT is legitimately "DEV" or "unknown" on some deployments: no
  // build to ask for, so the older recovery answers instead.
  it("falls back when the server's commit names no build", async () => {
    stubLocation("/game/game1234");
    envMocks.resolveGame.mockReturnValue({
      kind: "cross",
      host: "falk2-a.openfront.io",
      numWorkers: 16,
    });

    sendMismatch("unknown");

    expect(window.location.href).toBe(
      "https://falk2-a.openfront.io/game/game1234",
    );
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(reloadForUpdate).not.toHaveBeenCalled();
  });

  it("still reloads a stale tab when no version can be named", async () => {
    // No build is named, so there is no versioned page to ask for.
    stubLocation("/game/game1234");

    sendMismatch(undefined);

    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(reloadForUpdate).toHaveBeenCalled();
  });
});

describe("ClientGameRunner lifecycle idempotency and cleanup", () => {
  function makeRunner(isLocal = false) {
    const eventBus = new EventBus();
    const worker = { start: vi.fn(), sendTurn: vi.fn(), cleanup: vi.fn() };
    const transport = {
      updateCallback: vi.fn(),
      rejoinGame: vi.fn(),
      turnComplete: vi.fn(),
      leaveGame: vi.fn(),
      reconnect: vi.fn(),
      isLocal,
    };
    const renderer = {
      initialize: vi.fn(),
      tick: vi.fn(),
      uiState: { attackRatio: 0.5, ghostStructure: null },
      transformHandler: {
        screenToWorldCoordinates: vi.fn(() => ({ x: 0, y: 0 })),
      },
    };
    const gameView = {
      config: () => ({
        isRandomSpawn: () => false,
        isReplay: () => false,
      }),
      isCatchingUp: vi.fn(() => false),
      inSpawnPhase: () => false,
      myPlayer: () => null,
      update: vi.fn(),
    };
    const runner = new ClientGameRunner(
      makeLobbyConfig(true),
      "c0000001",
      eventBus,
      renderer as never,
      { initialize: vi.fn(), destroy: vi.fn() } as never,
      transport as never,
      worker as never,
      gameView as never,
      { playBackgroundMusic: vi.fn(), dispose: vi.fn() } as never,
      { goToPlayer: () => false } as never,
    );
    startedRunners.push(runner);
    return { runner, eventBus, worker, transport, renderer };
  }

  it("calling start() twice does not duplicate GameHealthIndicators, eventBus listeners, or worker.start()", () => {
    const { runner, eventBus, worker } = makeRunner(true);
    const onSpy = vi.spyOn(eventBus, "on");

    runner.start();
    expect(worker.start).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll("game-health-indicators")).toHaveLength(1);
    const subscriptionCount = onSpy.mock.calls.length;
    expect(subscriptionCount).toBeGreaterThan(0);

    runner.start();
    expect(worker.start).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll("game-health-indicators")).toHaveLength(1);
    expect(onSpy).toHaveBeenCalledTimes(subscriptionCount);

    runner.stop();
    runner.start();
    expect(worker.start).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll("game-health-indicators")).toHaveLength(0);
    expect(onSpy).toHaveBeenCalledTimes(subscriptionCount);
  });

  it("calling start() after an unstarted stop() is a no-op", () => {
    const { runner, eventBus, worker } = makeRunner(true);
    const onSpy = vi.spyOn(eventBus, "on");

    runner.stop();
    runner.start();

    expect(worker.start).not.toHaveBeenCalled();
    expect(document.querySelectorAll("game-health-indicators")).toHaveLength(0);
    expect(onSpy).not.toHaveBeenCalled();
  });

  it("calling stop() before 20s cancels connectionCheckTimeout and unsubscribes eventBus listeners", () => {
    vi.useFakeTimers();
    const { runner, eventBus, transport, renderer } = makeRunner(false);
    const onSpy = vi.spyOn(eventBus, "on");
    const offSpy = vi.spyOn(eventBus, "off");

    runner.start();
    expect(onSpy.mock.calls.length).toBeGreaterThan(0);
    vi.advanceTimersByTime(10_000);

    runner.stop();
    expect(offSpy).toHaveBeenCalledTimes(onSpy.mock.calls.length);

    eventBus.emit(new MouseUpEvent(10, 10));
    expect(
      renderer.transformHandler.screenToWorldCoordinates,
    ).not.toHaveBeenCalled();

    vi.advanceTimersByTime(30_000);
    expect(transport.reconnect).not.toHaveBeenCalled();
  });
});
