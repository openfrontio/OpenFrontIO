import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { capturePagePin, resetPagePinForTests } from "../../src/client/PagePin";
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
import { reloadForUpdate } from "../../src/client/Utils";
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
function makeStartedRunner(
  withStartInfo: boolean,
  opts: { isLocal?: boolean; metrics?: object } = {},
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
    null,
    null,
    null,
    (opts.metrics ?? null) as never,
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
