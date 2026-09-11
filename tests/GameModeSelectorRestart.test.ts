import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicGames } from "../src/core/Schemas";

// OPE-255. The component stops its public-lobby socket when a game starts
// (Main.ts calls gameModeSelector.stop()), and `start()` lived ONLY in
// connectedCallback(). Nothing reconnects an element that is never
// disconnected, so an exit that does not reload the page left the lobby
// browser frozen: a stale list that never updates again.
//
// jsdom has no WebSocket worth talking to and this test is about the
// lifecycle, not the wire, so the socket is a spy -- following the same
// pattern as GameModeSelectorGatingWiring.test.ts.
const { socketCalls } = vi.hoisted(() => ({
  socketCalls: { started: 0, stopped: 0 },
}));

vi.mock("../src/client/LobbySocket", () => ({
  PublicLobbySocket: class {
    constructor(_onUpdate: (g: PublicGames) => void) {}
    start(): void {
      socketCalls.started++;
    }
    stop(): void {
      socketCalls.stopped++;
    }
  },
}));

// The suppression tests below need to see whether the prompt actually fired;
// everything else in InGameModal stays real.
vi.mock("../src/client/InGameModal", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/client/InGameModal")>();
  return {
    ...actual,
    // Never resolves: the real flow reloads the page after the alert, which
    // has no business running under jsdom.
    showInGameAlert: vi.fn(() => new Promise<void>(() => {})),
  };
});

import { GameModeSelector } from "../src/client/GameModeSelector";
import { showInGameAlert } from "../src/client/InGameModal";

describe("GameModeSelector lobby-socket lifecycle", () => {
  beforeEach(() => {
    socketCalls.started = 0;
    socketCalls.stopped = 0;
  });

  it("exposes a start() that is the inverse of stop()", () => {
    const selector = new GameModeSelector();

    selector.stop();
    expect(socketCalls.stopped).toBe(1);

    selector.start();
    expect(socketCalls.started).toBe(1);
  });

  // The actual regression: a stopped socket must be able to come back without
  // the element being torn down and recreated, because in this flow it never
  // is -- <game-mode-selector> stays connected the whole time.
  it("reconnects after a stop without any disconnect/reconnect of the element", () => {
    const selector = new GameModeSelector();

    selector.stop();
    selector.start();
    selector.stop();
    selector.start();

    expect(socketCalls.stopped).toBe(2);
    expect(socketCalls.started).toBe(2);
  });
});

// The socket is NOT scoped to the homepage: Main.ts only stops it when a game
// actually starts, so it is still listening while the player waits in a
// lobby. An update/drain prompt firing there would reload the player out of
// a lobby the draining deployment deliberately lets finish — it must be
// deferred until they leave.
describe("GameModeSelector update prompt deferral", () => {
  it("defers the prompt while the player is in a lobby", () => {
    const selector = new GameModeSelector() as any;

    selector.onJoinLobby();
    selector.handleUpdateAvailable();

    expect(selector.updateDeferred).toBe(true);
  });

  it("re-fires the prompt when the player leaves the lobby", () => {
    const selector = new GameModeSelector() as any;
    selector.onJoinLobby();
    selector.handleUpdateAvailable();

    const prompt = vi
      .spyOn(selector, "handleUpdateAvailable")
      .mockImplementation(() => {});
    selector.onLeaveLobby();

    expect(prompt).toHaveBeenCalledTimes(1);
    expect(selector.updateDeferred).toBe(false);
  });
});

// A versioned replay shell (replay.<domain>/<gameId>) is pinned to the
// archived game's build on purpose, but its baked-in serverHost points at a
// live deployment running a newer build — so the lobby socket's commit
// compare fires on every load, and reloading re-serves the same immutable
// shell: the prompt would loop forever.
describe("GameModeSelector update prompt on the replay shell host", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(showInGameAlert).mockClear();
  });

  it("suppresses the prompt on replay.<domain>", () => {
    vi.stubGlobal("location", { hostname: "replay.openfront.io" });
    const selector = new GameModeSelector() as any;

    selector.handleUpdateAvailable();

    expect(showInGameAlert).not.toHaveBeenCalled();
    expect(selector.updateDeferred).toBe(false);
  });

  it("still prompts on ordinary hosts", () => {
    vi.stubGlobal("location", { hostname: "openfront.io" });
    const selector = new GameModeSelector() as any;

    selector.handleUpdateAvailable();

    expect(showInGameAlert).toHaveBeenCalledTimes(1);
  });
});
