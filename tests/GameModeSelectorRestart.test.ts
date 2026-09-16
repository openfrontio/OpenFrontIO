import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { capturePagePin, resetPagePinForTests } from "../src/client/PagePin";
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

import { ClientEnv } from "../src/client/ClientEnv";
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
    resetPagePinForTests();
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

// A page pinned under /v/<commit>/ sits on a draining build on purpose, so
// the lobby feed's drain signal fires on every load. Prompting would strip
// the pin, reload at latest, and be re-pinned straight back -- the loop the
// pinned-page work exists to prevent (see isOutdated and ClientGameRunner's
// version_mismatch handler for the other two exits).
describe("GameModeSelector update prompt on a pinned /v/<commit>/ page", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(showInGameAlert).mockClear();
    resetPagePinForTests();
  });

  it("suppresses the prompt when the page is pinned to a version", () => {
    vi.stubGlobal("location", {
      hostname: "openfront.io",
      pathname: "/v/5ccc50a7/game/dAbCd12345",
    });
    // isPinnedToAVersion answers from the pin captured at boot (PagePin.ts),
    // so take it against the stubbed location, as Client.initialize() does.
    capturePagePin();
    const selector = new GameModeSelector() as any;

    selector.handleUpdateAvailable();

    expect(showInGameAlert).not.toHaveBeenCalled();
    expect(selector.updateDeferred).toBe(false);
  });

  it("still prompts at a version-free path", () => {
    vi.stubGlobal("location", {
      hostname: "openfront.io",
      pathname: "/game/dAbCd12345",
    });
    capturePagePin();
    const selector = new GameModeSelector() as any;

    selector.handleUpdateAvailable();

    expect(showInGameAlert).toHaveBeenCalledTimes(1);
  });
});

// The feed is closed while the desktop session is gated -- every join it could
// offer would be refused -- and reopened when the session comes back. Main's
// own stop()/start() still wins: a session change must never reopen a feed
// Main closed for a game.
describe("GameModeSelector lobby feed while the desktop session is gated", () => {
  let selector: GameModeSelector & { updateComplete: Promise<unknown> };

  function setSession(detail: { status: string; reason?: string }) {
    document.dispatchEvent(
      new CustomEvent("desktop-session-state", { detail }),
    );
  }

  beforeEach(() => {
    socketCalls.started = 0;
    socketCalls.stopped = 0;
    window.BOOTSTRAP_CONFIG = {
      gameEnv: "dev",
      numWorkers: 1,
      turnstileSiteKey: "",
      jwtAudience: "test",
      instanceId: "test",
      gitCommit: "test",
    };
    ClientEnv.reset();
    selector = document.createElement(
      "game-mode-selector",
    ) as GameModeSelector & { updateComplete: Promise<unknown> };
    document.body.appendChild(selector);
  });

  afterEach(() => {
    document.body.innerHTML = "";
    window.BOOTSTRAP_CONFIG = undefined;
    ClientEnv.reset();
  });

  it("closes the feed when the session drops and reopens it when it returns", () => {
    expect(socketCalls.started).toBe(1);

    setSession({ status: "signed-out", reason: "steam-unavailable" });
    expect(socketCalls.stopped).toBe(1);

    setSession({ status: "signed-in" });
    expect(socketCalls.started).toBe(2);
  });

  it("does not churn the socket on a session change that keeps it gated", () => {
    setSession({ status: "signed-out", reason: "steam-unavailable" });
    setSession({ status: "retrying" });
    setSession({ status: "signed-out", reason: "steam-unavailable" });
    expect(socketCalls.stopped).toBe(1);
    expect(socketCalls.started).toBe(1);
  });

  it("does not reopen a feed Main stopped for a game", () => {
    selector.stop();
    setSession({ status: "signed-out", reason: "steam-unavailable" });
    setSession({ status: "signed-in" });
    expect(socketCalls.started).toBe(1);

    selector.start();
    expect(socketCalls.started).toBe(2);
  });

  it("keeps a start() while gated closed until the session returns", () => {
    setSession({ status: "signed-out", reason: "steam-unavailable" });
    selector.stop();
    selector.start();
    expect(socketCalls.started).toBe(1);

    setSession({ status: "signed-in" });
    expect(socketCalls.started).toBe(2);
  });

  it("shows an offline message in place of the spinner while gated", async () => {
    await selector.updateComplete;
    expect(selector.querySelector(".animate-spin")).not.toBeNull();

    setSession({ status: "signed-out", reason: "steam-unavailable" });
    await selector.updateComplete;
    expect(selector.querySelector(".animate-spin")).toBeNull();
    expect(selector.textContent).toContain("mode_selector.offline_lobbies");

    setSession({ status: "signed-in" });
    await selector.updateComplete;
    expect(selector.querySelector(".animate-spin")).not.toBeNull();
    expect(selector.textContent).not.toContain("mode_selector.offline_lobbies");
  });
});
