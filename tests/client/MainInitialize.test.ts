/**
 * First harness that imports src/client/Main.ts for real. Main bootstraps at
 * module scope (`new Client().initialize()`), so the DOM (built from the real
 * index.html body) and every global it dereferences must exist BEFORE the
 * dynamic import in beforeAll. All tests share that one boot: custom elements
 * cannot be re-defined in the file's single jsdom, so a second import of Main
 * (after vi.resetModules) would throw on the first `customElements.define`.
 */
import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  userAuth: vi.fn(async (): Promise<unknown> => false),
  retrySteamSignIn: vi.fn(async (): Promise<unknown> => false),
  reauthAfterCrazyGamesChange: vi.fn(async (): Promise<unknown> => false),
  getDesktopSessionState: vi.fn(() => ({ status: "unknown" })),
  getUserMe: vi.fn(async (): Promise<unknown> => false),
  invalidateUserMe: vi.fn(),
  joinLobby: vi.fn(),
}));

// Auth is imported by half the component tree; keep the real module and only
// take over the four functions Main's auth flow calls.
vi.mock("../../src/client/Auth", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    userAuth: mocks.userAuth,
    retrySteamSignIn: mocks.retrySteamSignIn,
    reauthAfterCrazyGamesChange: mocks.reauthAfterCrazyGamesChange,
    getDesktopSessionState: mocks.getDesktopSessionState,
  };
});

// Same story for Api: <username-input> calls getUserMe from
// connectedCallback, which runs while Main's import is still executing.
vi.mock("../../src/client/Api", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getUserMe: mocks.getUserMe,
    invalidateUserMe: mocks.invalidateUserMe,
  };
});

// Deterministic "version element not found" (Main.ts line 411) regardless of
// whether the Lit nav bars have rendered their version spans yet.
vi.mock("../../src/client/GameVersion", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, renderNavVersion: () => 0 };
});

// Main is the only importer. Stubbing it keeps onUserMe's boot-interrupt tail
// deterministic (no confirm dialogs, no reward popups).
vi.mock("../../src/client/BootInterrupts", () => ({
  bootInterruptsAllowed: () => false,
  CLAIM_PROMPT_KEY: "claim-prompt-store",
  claimPromptDue: () => false,
  claimPromptStringsReady: () => false,
  joinOwnsInFlightFlag: () => true,
  lapseShownAfterDispatch: (
    _resp: unknown,
    _marker: unknown,
    dispatch: () => void,
  ) => {
    dispatch();
    return false;
  },
  nextBootInterrupt: () => null,
  parseClaimPromptStore: () => ({}),
  runBootInterrupt: async () => {},
}));

// Injects a third-party script and polls; nothing under test needs it.
vi.mock("../../src/client/Admiral", () => ({
  loadAdmiral: vi.fn(),
  onAdmiralMeasured: vi.fn(),
}));

// adGatekeeper.start() would install a poll interval and DOM bait.
// HomepagePromos (also in Main's graph) reads canShowAds and nothing else.
vi.mock("../../src/client/AdGatekeeper", () => ({
  adGatekeeper: {
    seed: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    canShowAds: false,
    whenClear: () => () => {},
  },
}));

// Cuts the whole Pixi/WebGL/worker/audio in-game graph out of the import.
// Transport/LocalServer only take the LobbyConfig *type* from this module,
// so a value-only stub is safe.
vi.mock("../../src/client/ClientGameRunner", () => ({
  joinLobby: mocks.joinLobby,
}));

function userMeFixture(): unknown {
  return {
    user: { email: "player@example.com" },
    player: {
      publicId: "public-id-1",
      usernameStatus: "claimed",
      usernameBase: "RyanTheGreat",
      username: "RyanTheGreat",
      usernameClaimExpiresAt: null,
      nextUsernameChangeAt: null,
      rewards: [],
      // SinglePlayerModal's userMeResponse listener dereferences this.
      achievements: { singleplayerMap: [] },
    },
  };
}

describe("Client.initialize() booted from Main.ts module scope", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(async () => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    // ClientEnv.get() throws without the four environment values. Nothing
    // here names a server beyond the worker count, and no instanceId at all:
    // a static page carries none (multi-server v2), and initialize() must
    // boot from one that does not.
    (window as any).BOOTSTRAP_CONFIG = {
      gameEnv: "dev",
      numWorkers: 2,
      turnstileSiteKey: "test-site-key",
      jwtAudience: "localhost",
      gitCommit: "DEV",
    };

    // Without this the Turnstile prefetch polls for 10s and then rejects a
    // stored promise nothing catches.
    (window as any).turnstile = {
      render: () => "widget-1",
      execute: (
        _widgetId: string,
        opts: { callback: (token: string) => void },
      ) => opts.callback("turnstile-test-token"),
      remove: () => {},
    };

    // jsdom has neither FontFace nor document.fonts.
    vi.stubGlobal(
      "FontFace",
      class {
        load() {
          return Promise.resolve(this);
        }
      },
    );
    Object.defineProperty(document, "fonts", {
      value: { add: () => {} },
      configurable: true,
    });
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
        takeRecords() {
          return [];
        }
      },
    );
    // Components in Main's graph fire fetches from connectedCallback; answer
    // them all with a failure they already handle instead of real sockets.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 500,
        statusText: "Server Error",
        headers: new Map<string, string>(),
        json: async () => ({}),
        text: async () => "",
        arrayBuffer: async () => new ArrayBuffer(0),
      })),
    );

    // Real markup, so every unguarded getElementById/querySelector in
    // initialize() (store modal, help modal, turnstile container, ...) finds
    // the element it dereferences. Scripts hold EJS placeholders — drop them.
    const html = fs.readFileSync(
      path.resolve(__dirname, "../../index.html"),
      "utf8",
    );
    const parsed = new DOMParser().parseFromString(html, "text/html");
    parsed.querySelectorAll("script").forEach((s) => s.remove());
    const bodyInner = parsed.body.innerHTML;
    // A guaranteed-first <username-input> so Client.initialize() captures an
    // element we can stub canPlay() on (play-page renders its own copy async,
    // maybe, later — document order keeps ours the querySelector result).
    document.body.innerHTML = `<username-input></username-input>${bodyInner}`;

    // The import runs bootstrap: component registration, element upgrades,
    // then `new Client().initialize()`.
    await import("../../src/client/Main");

    if (document.readyState === "loading") {
      document.dispatchEvent(new Event("DOMContentLoaded", { bubbles: true }));
    }

    // After `await userAuth()` resolves, the remainder of initialize() is
    // synchronous — one flush after the call is observed means the hashchange
    // listener, join-lobby listener and slider wiring are all in place.
    await vi.waitFor(() => expect(mocks.userAuth).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 25));
  }, 20_000);

  it("runs the signed-out boot: onUserMe(false) and the missing-version warn", () => {
    // renderNavVersion() === 0 branch (line 411).
    expect(warnSpy).toHaveBeenCalledWith("Game version element not found");
    // userAuth() === false → onUserMe(false) (line 735), which flips the ad
    // entitlement on for a signed-out web player.
    expect(window.adsEnabled).toBe(true);
  });

  it("routes a hashchange through onHashUpdate", async () => {
    const joinModal = document.querySelector("join-lobby-modal") as unknown as {
      close: () => void;
    };
    const closeSpy = vi.spyOn(joinModal, "close").mockImplementation(() => {});
    window.dispatchEvent(new Event("hashchange"));
    await vi.waitFor(() => expect(closeSpy).toHaveBeenCalled());
    closeSpy.mockRestore();
  });

  it("reads the join-lobby detail and stops at the username gate", async () => {
    const input = document.querySelector("username-input") as unknown as {
      canPlay: () => boolean;
    };
    const canPlay = vi.fn(() => false);
    input.canPlay = canPlay;
    logSpy.mockClear();
    document.dispatchEvent(
      new CustomEvent("join-lobby", {
        detail: { gameID: "AbCd1234" },
        bubbles: true,
      }),
    );
    await vi.waitFor(() => expect(canPlay).toHaveBeenCalled());
    // Early return before the "joining lobby" log — nothing joined.
    expect(logSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("joining lobby"),
    );
    expect(mocks.joinLobby).not.toHaveBeenCalled();
  });

  it("logs the player id when a retry lands a signed-in userMe", async () => {
    mocks.retrySteamSignIn.mockResolvedValueOnce({
      jwt: "jwt",
      claims: {},
    });
    mocks.getUserMe.mockResolvedValueOnce(userMeFixture());
    document.dispatchEvent(new CustomEvent("desktop-session-retry"));
    await vi.waitFor(() =>
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining("Your player ID is public-id-1"),
      ),
    );
  });
});
