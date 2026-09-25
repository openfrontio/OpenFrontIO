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
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { capturePagePin } from "../../src/client/PagePin";
import { SendKickPlayerIntentEvent } from "../../src/client/Transport";
import { translateText } from "../../src/client/Utils";
import { EventBus } from "../../src/core/EventBus";

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
  steamGrantStringsReady: () => false,
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

// The viewer pulls in the WebGL renderer. A bare element is enough to see
// that Main opened it, and for which game.
vi.mock("../../src/client/replay/ReplayViewer", () => {
  class ReplayViewer extends HTMLElement {
    gameID = "";
  }
  customElements.define("replay-viewer", ReplayViewer);
  return { ReplayViewer };
});

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

    localStorage.setItem(
      "achievements.pushed",
      JSON.stringify({ playerId: "p1", names: ["win_ffa"] }),
    );

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

  it("clears the stale achievements.pushed record", () => {
    expect(localStorage.getItem("achievements.pushed")).toBeNull();
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

  it("forwards a kick-player DOM event to the game event bus", () => {
    const emitSpy = vi.spyOn(EventBus.prototype, "emit");
    document.dispatchEvent(
      new CustomEvent("kick-player", {
        detail: { target: "c0000002" },
        bubbles: true,
      }),
    );
    expect(
      emitSpy.mock.calls.some(
        ([e]) =>
          e instanceof SendKickPlayerIntentEvent && e.target === "c0000002",
      ),
    ).toBe(true);
    emitSpy.mockRestore();
  });

  // Multi-server v2, and the two halves of the rule in one test. The in-game
  // `?live` entry is this tab's OWN URL, so on a page pinned under
  // /v/<commit>/ it carries that prefix: an F5 must reload the bundle this
  // page is running, not hand a mid-game player `latest`. The share rewrite
  // is the opposite -- it is what people copy out of the address bar, so it
  // stays version-free and the recipient is routed by the game's own server.
  //
  // Driven end-to-end through the real join path: the share rewrite
  // (updateJoinUrlForShare) runs before userAuth(), the `?live` entry when
  // the join handle resolves.
  it("pins the in-game URL but not the share URL on a /v/<commit>/ page", async () => {
    const realLocation = window.location;
    Object.defineProperty(window, "location", {
      value: {
        href: "http://localhost:3000/v/5ccc50a7/",
        origin: "http://localhost:3000",
        host: "localhost:3000",
        hostname: "localhost",
        pathname: "/v/5ccc50a7/",
        search: "",
        hash: "",
      },
      writable: true,
      configurable: true,
    });
    // Client.initialize() takes the pin as its very first act (PagePin.ts),
    // and this suite boots Main once in beforeAll, before the stub above.
    // Re-taking it here is what a genuinely pinned document would have done
    // -- and it is the whole point: from here on the answer no longer moves
    // when the share rewrite takes the prefix out of the address bar.
    capturePagePin();
    const replaceSpy = vi
      .spyOn(history, "replaceState")
      .mockImplementation(() => {});
    const pushSpy = vi.spyOn(history, "pushState").mockImplementation(() => {});
    let resolveJoin: () => void = () => {};
    mocks.joinLobby.mockReturnValueOnce({
      // Never resolves: the prestart branch is a different story, and this
      // test is about the two URL writes.
      prestart: new Promise<void>(() => {}),
      join: new Promise<void>((resolve) => {
        resolveJoin = resolve;
      }),
      stop: () => true,
    });
    const input = document.querySelector("username-input") as unknown as {
      canPlay: () => boolean;
    };
    input.canPlay = () => true;

    try {
      document.dispatchEvent(
        new CustomEvent("join-lobby", {
          detail: { gameID: "dAbCd12345", source: "private" },
          bubbles: true,
        }),
      );

      // The share-URL rewrite is deliberately NOT pinned: it is the URL
      // people copy out of the address bar, and a recipient must be routed
      // to the game's own version when they open it, not to this page's.
      await vi.waitFor(() => expect(replaceSpy).toHaveBeenCalled());
      const calls = replaceSpy.mock.calls;
      const rewritten = calls[calls.length - 1][2] as string;
      // Shape-matched rather than just "not pinned", so this cannot pass by
      // catching some other replaceState.
      expect(rewritten).toMatch(
        /^(\/streamer-mode|\/(w\d+\/)?game\/dAbCd12345)$/,
      );

      // And the in-game entry once the join lands.
      await vi.waitFor(() => expect(mocks.joinLobby).toHaveBeenCalled());
      resolveJoin();
      await vi.waitFor(() =>
        expect(
          pushSpy.mock.calls.some((c) =>
            (c[2] as string)?.startsWith("/v/5ccc50a7/"),
          ),
        ).toBe(true),
      );
    } finally {
      replaceSpy.mockRestore();
      pushSpy.mockRestore();
      Object.defineProperty(window, "location", {
        value: realLocation,
        writable: true,
        configurable: true,
      });
    }
  }, 15_000);

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

  /**
   * OPE-439. The entry-point components dim their own buttons, but every join
   * -- matchmaking's, a deep link, the host/join modals -- funnels through
   * handleJoinLobby without passing one, so the funnel gate is the only thing
   * that covers them. This is a WEB boot (no openfrontDesktop), which is
   * precisely what the pre-existing desktop gate could not cover.
   *
   * Driven through the real ServerList module: the reachability the funnel
   * reads has to be the one the heartbeat actually produces.
   */
  describe("the join funnel lets joins through while the server-list API is unreachable", () => {
    let ServerList: typeof import("../../src/client/ServerList");
    let messages: string[];
    let onMessage: EventListener;

    /**
     * Replaces the fetch stub and drives the module to the state named.
     *
     * An outage takes TWO unanswered attempts to confirm, and only the
     * confirmed signal gates -- so reaching the state under test means making
     * both, which the manual retry does without waiting out the heartbeat's
     * retry interval.
     */
    async function settleReachability(reachable: boolean): Promise<void> {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          if (!reachable) throw new TypeError("network down");
          return {
            ok: false,
            status: 404,
            statusText: "Not Found",
            headers: new Map<string, string>(),
            json: async () => ({}),
            text: async () => "",
            arrayBuffer: async () => new ArrayBuffer(0),
          };
        }),
      );
      ServerList.resetServerList();
      await ServerList.ensureServerList();
      if (!reachable) await ServerList.retryServerList();
      expect(ServerList.backendUnreachableConfirmed()).toBe(!reachable);
    }

    beforeAll(async () => {
      ServerList = await import("../../src/client/ServerList");
      // The pinned-page test above joins once and leaves the call on the
      // mock; every join-count claim below counts from zero.
      mocks.joinLobby.mockClear();
      // Test 3 above left the username gate closed; every join below has to
      // get past it to reach the gate under test.
      const input = document.querySelector("username-input") as unknown as {
        canPlay: () => boolean;
      };
      input.canPlay = () => true;
      messages = [];
      onMessage = (e: Event) => {
        messages.push((e as CustomEvent).detail?.message);
      };
      window.addEventListener("show-message", onMessage);
    });

    afterAll(() => {
      window.removeEventListener("show-message", onMessage);
      ServerList.resetServerList();
    });

    /**
     * The matchmaking modal's close() is the teardown its Back button uses:
     * it shuts the queue socket and clears the watchdog. The funnel reaches
     * for it only when it refuses a matchmade join, so it is also the
     * sharpest witness that an outage does NOT refuse -- if the funnel had
     * gated here, a queued player would have been dropped out of the queue.
     *
     * Spied rather than driven for real: opening the modal for real would
     * open a queue WebSocket, and the claim under test is only whether any
     * join reaches close().
     */
    function spyOnMatchmakingModal(): {
      close: ReturnType<typeof vi.spyOn>;
      restore: () => void;
    } {
      const modal = document.querySelector("matchmaking-modal") as unknown as {
        isOpen: () => boolean;
        close: () => void;
      };
      expect(modal).not.toBeNull();
      const isOpen = vi.spyOn(modal, "isOpen").mockReturnValue(true);
      const close = vi.spyOn(modal, "close").mockImplementation(() => {});
      return {
        close,
        restore: () => {
          close.mockRestore();
          isOpen.mockRestore();
        },
      };
    }

    /** The shape handleJoinLobby expects back; neither promise settles. */
    function stubJoinLobbyReturn(): void {
      mocks.joinLobby.mockReturnValue({
        prestart: new Promise(() => {}),
        join: new Promise(() => {}),
        stop: vi.fn(),
      });
    }

    // OPE-439. A confirmed outage means the SERVER-LIST API has missed two
    // heartbeats -- it says nothing about the game server this join is
    // headed for, which the dispatching source has already reached. The
    // sharpest case is this one: a player mid-game reloads during a
    // list-API blip, JoinLobbyModal.checkActiveLobby reads `exists` from the
    // game's own server, and refusing here would close the join modal,
    // leave the lobby and reset the URL -- ejecting them from a game that
    // was confirmed live moments earlier.
    it("joins a private game the source already confirmed, outage and all", async () => {
      await settleReachability(false);
      logSpy.mockClear();
      messages.length = 0;
      mocks.joinLobby.mockClear();
      stubJoinLobbyReturn();
      const matchmaking = spyOnMatchmakingModal();

      try {
        document.dispatchEvent(
          new CustomEvent("join-lobby", {
            detail: { gameID: "AbCd1234", source: "private" },
            bubbles: true,
          }),
        );

        // The far edge of the funnel, not the "joining lobby" log: that log
        // is written BEFORE handleJoinLobby awaits userAuth, the username
        // seed and the cosmetics refs, so a regression in that tail would
        // leave a log assertion passing over a join that never happened.
        await vi.waitFor(() =>
          expect(mocks.joinLobby).toHaveBeenCalledTimes(1),
        );
        // ...and with the lobby that was dispatched, not some other one.
        expect(mocks.joinLobby.mock.calls[0][1].gameID).toBe("AbCd1234");
        // No toast either: the funnel refuses nothing, so it has nothing to
        // report. The dimmed buttons and the status bar still carry the
        // outage, and a refused BUTTON press still says why -- that half is
        // covered in ReachabilityGating.
        expect(messages).not.toContain(
          translateText("common.backend_unreachable"),
        );
        // And nothing tore down the queue behind a player's back.
        expect(matchmaking.close).not.toHaveBeenCalled();
      } finally {
        matchmaking.restore();
      }
    });

    it("does not cancel a live matchmaking queue during an outage", async () => {
      // The same claim on the source that owns that modal: a matchmade join
      // arriving during an outage is joined, not refused, so the queue
      // teardown never runs.
      await settleReachability(false);
      messages.length = 0;
      mocks.joinLobby.mockClear();
      stubJoinLobbyReturn();
      const matchmaking = spyOnMatchmakingModal();

      try {
        document.dispatchEvent(
          new CustomEvent("join-lobby", {
            detail: { gameID: "AbCd1234", source: "matchmaking" },
            bubbles: true,
          }),
        );

        await vi.waitFor(() =>
          expect(mocks.joinLobby).toHaveBeenCalledTimes(1),
        );
        expect(matchmaking.close).not.toHaveBeenCalled();
        expect(messages).not.toContain(
          translateText("common.backend_unreachable"),
        );
      } finally {
        matchmaking.restore();
      }
    });

    it("lets the same join through once the backend answers", async () => {
      // The control. Without it a join refused for any unrelated reason --
      // the username gate, a listener that never ran -- would make the cases
      // above vacuous, since they too assert a join that goes through.
      await settleReachability(true);
      logSpy.mockClear();
      messages.length = 0;
      mocks.joinLobby.mockClear();
      stubJoinLobbyReturn();

      document.dispatchEvent(
        new CustomEvent("join-lobby", {
          detail: { gameID: "AbCd1234", source: "matchmaking" },
          bubbles: true,
        }),
      );

      // The far edge of the funnel, not the "joining lobby" log: that log is
      // written BEFORE handleJoinLobby awaits userAuth, the username seed and
      // the cosmetics refs, so a regression anywhere in that tail would leave
      // the log assertion passing over a join that never happened. joinLobby
      // is the call that actually starts one.
      await vi.waitFor(() => expect(mocks.joinLobby).toHaveBeenCalledTimes(1));
      // ...and with the lobby that was dispatched, not some other one.
      expect(mocks.joinLobby.mock.calls[0][1].gameID).toBe("AbCd1234");
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining("joining lobby"),
      );
      expect(messages).not.toContain(
        translateText("common.backend_unreachable"),
      );
    });
  });

  // Last: the viewer replaces the menu, and any later hash change would
  // then leave the page.
  it("opens the replay viewer when the hash changes to one, though closing the join modal resets the URL", async () => {
    const joinModal = document.querySelector("join-lobby-modal") as unknown as {
      close: () => void;
    };
    // What JoinLobbyModal.onClose does when there's no lobby to keep.
    const closeSpy = vi
      .spyOn(joinModal, "close")
      .mockImplementation(() => history.replaceState(null, "", "/"));
    window.location.hash = "#replay-viewer=dqKzit4cWu";
    window.dispatchEvent(new Event("hashchange"));
    await vi.waitFor(() =>
      expect(
        (document.querySelector("replay-viewer") as { gameID?: string } | null)
          ?.gameID,
      ).toBe("dqKzit4cWu"),
    );
    closeSpy.mockRestore();
  });

  it("preserves the replay hash when popstate and hashchange are dispatched and closing the join modal resets the URL", async () => {
    const joinModal = document.querySelector("join-lobby-modal") as unknown as {
      close: () => void;
    };
    const closeSpy = vi
      .spyOn(joinModal, "close")
      .mockImplementation(() => history.replaceState(null, "", "/"));
    window.location.hash = "#replay-viewer=dqKzit4cWu";
    window.dispatchEvent(new Event("popstate"));
    window.dispatchEvent(new Event("hashchange"));
    await vi.waitFor(() =>
      expect(window.location.hash).toBe("#replay-viewer=dqKzit4cWu"),
    );
    closeSpy.mockRestore();
  });

  it("replaces the URL and clears the replay hash when joining a singleplayer lobby", async () => {
    history.replaceState(null, "", "/#replay-viewer=dqKzit4cWu");
    expect(window.location.hash).toBe("#replay-viewer=dqKzit4cWu");

    const replaceSpy = vi.spyOn(history, "replaceState");

    document.dispatchEvent(
      new CustomEvent("join-lobby", {
        detail: {
          gameID: "sp_game_clear_hash",
          source: "singleplayer",
        },
        bubbles: true,
      }),
    );

    await vi.waitFor(() => {
      const calls = replaceSpy.mock.calls;
      const targetCall = calls.find(
        (call) =>
          typeof call[2] === "string" && call[2].includes("sp_game_clear_hash"),
      );
      expect(targetCall).toBeDefined();
      expect(targetCall![2]).not.toContain("#");
    });

    replaceSpy.mockRestore();
  });
});
