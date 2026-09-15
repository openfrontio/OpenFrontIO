import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClientEnv } from "../src/client/ClientEnv";
import "../src/client/components/DesktopStatusBar";
import { barSource } from "../src/client/components/DesktopStatusBar";
import {
  backendUnreachableConfirmed,
  ensureServerList,
  resetServerList,
  retryServerList,
} from "../src/client/ServerList";

// Matches RETRY_BUTTON_COOLDOWN_MS in the component.
const COOLDOWN_MS = 5_000;

describe("barSource", () => {
  it("shows nothing when both states are healthy", () => {
    expect(
      barSource(
        { status: "current", bytes: 0, total: 0 },
        { status: "signed-in" },
        false,
      ),
    ).toBe("none");
  });

  it("shows the update when the session is fine", () => {
    expect(
      barSource(
        { status: "downloading", bytes: 1, total: 2 },
        { status: "signed-in" },
        false,
      ),
    ).toBe("update");
  });

  // Session wins over EVERY update state, downloading and staged included:
  // the update's remedy is a reload, which leads straight back to the same
  // wall -- and a reload re-runs the update flow anyway, so nothing is lost.
  it.each([
    "checking",
    "current",
    "downloading",
    "staged",
    "blocked",
    "failed",
  ] as const)("shows the session over update state %s", (status) => {
    expect(
      barSource(
        { status, bytes: 0, total: 0 },
        {
          status: "signed-out",
          reason: "steam-wedged",
        },
        false,
      ),
    ).toBe("session");
  });

  // OPE-194 pairs with this: an unrecognised error kind now GATES multiplayer,
  // so it must never gate silently. The bar's visibility and its label/action
  // key off `status`, not `error.kind`, so a failure this client cannot
  // classify still surfaces "couldn't download the update" plus Retry -- a
  // visible reason and an action, which is what keeps gating from being
  // punishment without recourse.
  it("surfaces a failure whose error kind is unrecognised", () => {
    expect(
      barSource(
        {
          status: "failed",
          bytes: 0,
          total: 0,
          error: { kind: "quota-exceeded", message: "from a newer shell" },
        },
        { status: "signed-in" },
        false,
      ),
    ).toBe("update");
  });

  it("shows nothing on the web, where neither bridge exists", () => {
    expect(barSource(null, null, false)).toBe("none");
  });

  // OPE-439. Reachability sits between the two: below the session, because a
  // session failure names a more specific remedy, and above the update,
  // because an update failure while the backend is unreachable is a SYMPTOM
  // of it -- "Couldn't download the update -- Retry" points at a button that
  // provably cannot work until the network is back.
  it("shows the offline state over any update state", () => {
    expect(
      barSource({ status: "current", bytes: 0, total: 0 }, null, true),
    ).toBe("reachability");
    expect(
      barSource(
        {
          status: "failed",
          bytes: 0,
          total: 0,
          error: { kind: "network", message: "offline" },
        },
        { status: "signed-in" },
        true,
      ),
    ).toBe("reachability");
  });

  it("still shows the session over the offline state", () => {
    expect(
      barSource(null, { status: "signed-out", reason: "network" }, true),
    ).toBe("session");
  });

  // "needs-account" is the one signed-out reason whose remedy (reopening the
  // gate) is itself a network call, so it is the one exception to "session
  // always outranks reachability" -- see barSource's own comment.
  it("shows the account prompt when the backend is reachable", () => {
    expect(
      barSource(
        null,
        { status: "signed-out", reason: "needs-account" },
        /* backendOutage */ false,
      ),
    ).toBe("session");
  });

  it("yields to the reachability slot while the backend is unreachable", () => {
    expect(
      barSource(
        null,
        { status: "signed-out", reason: "needs-account" },
        /* backendOutage */ true,
      ),
    ).toBe("reachability");
  });

  it("does not change the priority for other signed-out reasons", () => {
    expect(
      barSource(
        null,
        { status: "signed-out", reason: "steam-wedged" },
        /* backendOutage */ true,
      ),
    ).toBe("session");
  });

  // The argument is the CONFIRMED outage, so "unsettled" and "missed once"
  // both arrive here as false and show nothing. There is no neutral state in
  // this bar to hang a "Checking…" on, and inventing one would put a strip
  // across the bottom of a healthy game every time one request timed out.
  it("shows nothing until an outage is confirmed", () => {
    expect(barSource(null, { status: "signed-in" }, false)).toBe("none");
    expect(
      barSource({ status: "current", bytes: 0, total: 0 }, null, false),
    ).toBe("none");
  });
});

/**
 * The rendered offline state and its Retry, driven through the REAL
 * ServerList module rather than a mock of it: the seed (backendReachable())
 * and the announcement ("backend-reachability") are the two halves this
 * feature actually depends on, and a mocked accessor would prove neither.
 */
describe("the rendered offline state", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  function mountBar(): HTMLElement & { updateComplete: Promise<unknown> } {
    const bar = document.createElement("desktop-status-bar") as HTMLElement & {
      updateComplete: Promise<unknown>;
    };
    document.body.appendChild(bar);
    return bar;
  }

  // The button, whichever label it is wearing. `retrying` has `retry` as a
  // prefix, so this matches on the shared stem rather than either key.
  function retryButton(bar: HTMLElement): HTMLButtonElement | undefined {
    return Array.from(bar.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("desktop_status.retry"),
    );
  }

  function buttonLabel(bar: HTMLElement): string {
    return retryButton(bar)!.textContent!.trim();
  }

  beforeEach(() => {
    // The bar renders nothing on the web, so every assertion here needs a
    // shell. No `update` bridge on it: a shell too old to expose one must
    // still show this.
    (window as { openfrontDesktop?: unknown }).openfrontDesktop = {};
    window.BOOTSTRAP_CONFIG = {
      gameEnv: "dev",
      numWorkers: 1,
      turnstileSiteKey: "",
      jwtAudience: "test",
      instanceId: "test",
      gitCommit: "test",
      serverHost: "openfront.io",
    } as unknown as typeof window.BOOTSTRAP_CONFIG;
    ClientEnv.reset();
    resetServerList();
    fetchMock = vi.fn(async () => {
      throw new TypeError("network down");
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    // Fake the clock only so the tests can step past the manual-retry floor
    // and the heartbeat's retry interval; shouldAdvanceTime keeps real time
    // flowing underneath, so vi.waitFor and Lit's microtasks behave normally.
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    document.body.innerHTML = "";
    (window as { openfrontDesktop?: unknown }).openfrontDesktop = undefined;
    window.BOOTSTRAP_CONFIG = undefined;
    ClientEnv.reset();
    resetServerList();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /**
   * Drives enough failed attempts that the outage is confirmed, then steps
   * past the manual-retry floor so a click in the test starts an attempt of
   * its own rather than joining this one.
   */
  async function confirmOutage(): Promise<void> {
    await ensureServerList();
    vi.advanceTimersByTime(2_000);
    await retryServerList();
    expect(backendUnreachableConfirmed()).toBe(true);
    vi.advanceTimersByTime(2_000);
  }

  it("shows nothing while the backend is fine", async () => {
    // The control: the bar must not become a permanent fixture just because
    // this feature exists.
    fetchMock.mockImplementation(
      async () => new Response("{}", { status: 404 }),
    );
    await ensureServerList();
    expect(backendUnreachableConfirmed()).toBe(false);

    const bar = mountBar();
    await bar.updateComplete;
    expect(bar.textContent?.trim()).toBe("");
  });

  it("shows nothing after a single missed attempt", async () => {
    // One timed-out heartbeat is a blip, not an outage. Showing an offline
    // bar for it -- while the cached list is still serving perfectly well --
    // would make the bar appear and vanish on any flaky connection.
    await ensureServerList();
    expect(backendUnreachableConfirmed()).toBe(false);

    const bar = mountBar();
    await bar.updateComplete;
    expect(bar.textContent?.trim()).toBe("");
  });

  it("seeds the offline state from failures that happened before it mounted", async () => {
    await confirmOutage();

    // Mounted AFTER the announcement it would have needed. The accessor is
    // the only path left, exactly as in OPE-396.
    const bar = mountBar();
    await bar.updateComplete;

    expect(bar.textContent).toContain("desktop_status.offline");
    expect(retryButton(bar)).toBeDefined();
  });

  it("picks the offline state up from the announcement when it mounts first", async () => {
    const bar = mountBar();
    await bar.updateComplete;
    expect(bar.textContent?.trim()).toBe("");

    await confirmOutage();
    await bar.updateComplete;

    expect(bar.textContent).toContain("desktop_status.offline");
  });

  it("Retry attempts again immediately, and the bar clears when the API answers", async () => {
    await confirmOutage();
    const bar = mountBar();
    await bar.updateComplete;
    const attemptsSoFar = fetchMock.mock.calls.length;

    // A 404 is an answer: this site has no list, but the backend is up. That
    // is the boundary the bar keys on, so it is the one worth clearing on.
    fetchMock.mockImplementation(
      async () => new Response("{}", { status: 404 }),
    );
    retryButton(bar)!.click();

    // Immediately, without waiting out the heartbeat's retry interval -- the
    // whole point of the button.
    expect(fetchMock).toHaveBeenCalledTimes(attemptsSoFar + 1);
    await vi.waitFor(() => expect(backendUnreachableConfirmed()).toBe(false));
    await bar.updateComplete;
    expect(bar.textContent?.trim()).toBe("");
  });

  it("disables Retry while its own attempt is still out", async () => {
    await confirmOutage();
    const bar = mountBar();
    await bar.updateComplete;

    // A request that never answers, so the in-flight window stays open.
    let release: (r: Response) => void = () => {};
    fetchMock.mockImplementation(
      async () =>
        await new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    const button = retryButton(bar)!;
    button.click();
    await bar.updateComplete;

    // A button that keeps accepting clicks while visibly doing nothing reads
    // as broken, whatever the throttle underneath is doing.
    expect(button.disabled).toBe(true);
    const attempts = fetchMock.mock.calls.length;
    button.click();
    expect(fetchMock).toHaveBeenCalledTimes(attempts);

    release(new Response("{}", { status: 404 }));
    await vi.waitFor(() => expect(backendUnreachableConfirmed()).toBe(false));
  });

  // The press's own attempt fails in milliseconds against a stubbed fetch,
  // so without a cooldown the button would come straight back and a player
  // watching an outage could sit there clicking it -- one real request each.
  it("keeps Retry disabled for the cooldown after a press, then re-enables it", async () => {
    await confirmOutage();
    const bar = mountBar();
    await bar.updateComplete;

    retryButton(bar)!.click();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    // The attempt itself has settled by now; the cooldown is what is still
    // holding the button.
    await bar.updateComplete;
    expect(retryButton(bar)!.disabled).toBe(true);

    vi.advanceTimersByTime(COOLDOWN_MS - 1);
    await bar.updateComplete;
    expect(retryButton(bar)!.disabled).toBe(true);

    vi.advanceTimersByTime(1);
    await bar.updateComplete;
    expect(retryButton(bar)!.disabled).toBe(false);
    expect(buttonLabel(bar)).toBe("desktop_status.retry");
  });

  it("costs one attempt for a rapid double click", async () => {
    await confirmOutage();
    const bar = mountBar();
    await bar.updateComplete;
    const before = fetchMock.mock.calls.length;

    const button = retryButton(bar)!;
    button.click();
    button.click();
    button.click();

    expect(fetchMock).toHaveBeenCalledTimes(before + 1);
  });

  // The automatic half of the same protection: while the heartbeat is
  // already asking, a press could only ever join the attempt that is out, so
  // the button says what is happening instead of offering a no-op.
  it("disables Retry and says so while an automatic attempt is in flight", async () => {
    await confirmOutage();
    const bar = mountBar();
    await bar.updateComplete;
    expect(retryButton(bar)!.disabled).toBe(false);

    // Failing the attempt, not answering it: an answer would clear the
    // outage and take this whole bar away before the assertion.
    let fail: (e: unknown) => void = () => {};
    fetchMock.mockImplementation(
      async () =>
        await new Promise<Response>((_resolve, reject) => {
          fail = reject;
        }),
    );
    // Nobody clicked anything: this is the heartbeat's own beat. Stepping
    // past the backoff first, since two failures are already behind us.
    vi.advanceTimersByTime(60_000);
    const beat = ensureServerList();
    await bar.updateComplete;

    expect(retryButton(bar)!.disabled).toBe(true);
    expect(buttonLabel(bar)).toBe("desktop_status.retrying");
    expect(retryButton(bar)!.title).toBe("desktop_status.retrying");

    // Settling re-enables it: no click happened, so no cooldown is owed.
    fail(new TypeError("network down"));
    await beat;
    await bar.updateComplete;
    expect(retryButton(bar)!.disabled).toBe(false);
    expect(buttonLabel(bar)).toBe("desktop_status.retry");
  });

  it("stays disabled after an attempt settles if the click's cooldown is still running", async () => {
    await confirmOutage();
    const bar = mountBar();
    await bar.updateComplete;

    let fail: (e: unknown) => void = () => {};
    fetchMock.mockImplementation(
      async () =>
        await new Promise<Response>((_resolve, reject) => {
          fail = reject;
        }),
    );
    retryButton(bar)!.click();
    await bar.updateComplete;
    expect(retryButton(bar)!.disabled).toBe(true);

    // The attempt ends well inside the cooldown. Whichever ends LATER is the
    // one that governs, so the button is still held.
    vi.advanceTimersByTime(1_000);
    fail(new TypeError("network down"));
    await vi.waitFor(() =>
      expect(buttonLabel(bar)).toBe("desktop_status.retry"),
    );
    expect(retryButton(bar)!.disabled).toBe(true);

    vi.advanceTimersByTime(COOLDOWN_MS);
    await bar.updateComplete;
    expect(retryButton(bar)!.disabled).toBe(false);
  });
});

/**
 * "needs-account" is diagnosed, not a failure: nothing broke, the player
 * simply has no account yet. Both assertions below exist because the switch
 * in sessionLabel/sessionAction falls through to a "something went wrong"
 * default that would be actively wrong here -- see this suite's own
 * mutation check, which confirms that by deleting each case.
 */
describe("the rendered needs-account session state", () => {
  function mountBar(): HTMLElement & { updateComplete: Promise<unknown> } {
    const bar = document.createElement("desktop-status-bar") as HTMLElement & {
      updateComplete: Promise<unknown>;
    };
    document.body.appendChild(bar);
    return bar;
  }

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("labels the bar with the needs-account key, not the generic fallback", async () => {
    const bar = mountBar();
    document.dispatchEvent(
      new CustomEvent("desktop-session-state", {
        detail: { status: "signed-out", reason: "needs-account" },
      }),
    );
    await bar.updateComplete;

    expect(bar.textContent).toContain("desktop_session.needs_account");
    expect(bar.textContent).not.toContain("desktop_session.generic");
  });

  it("offers Go online rather than the generic Retry", async () => {
    const bar = mountBar();
    document.dispatchEvent(
      new CustomEvent("desktop-session-state", {
        detail: { status: "signed-out", reason: "needs-account" },
      }),
    );
    await bar.updateComplete;

    const button = bar.querySelector("button");
    expect(button?.textContent?.trim()).toBe("desktop_status.go_online");
  });

  // The two above only check the label; this checks the WIRING -- that a
  // click actually reaches the bridge, not just that a button with the right
  // text exists. See desktopLinkGate() in DesktopShell.ts: it reads
  // window.openfrontDesktop.showLinkGate.
  it("invokes showLinkGate when Go online is clicked", async () => {
    const showLinkGate = vi.fn(() => Promise.resolve());
    (window as { openfrontDesktop?: unknown }).openfrontDesktop = {
      showLinkGate,
    };

    const bar = mountBar();
    document.dispatchEvent(
      new CustomEvent("desktop-session-state", {
        detail: { status: "signed-out", reason: "needs-account" },
      }),
    );
    await bar.updateComplete;

    bar.querySelector("button")!.click();

    expect(showLinkGate).toHaveBeenCalledTimes(1);

    (window as { openfrontDesktop?: unknown }).openfrontDesktop = undefined;
  });

  // A rejected showLinkGate() must be caught, not left to become an
  // unhandled rejection -- see the handler's own comment on why it uses
  // `.catch` instead of the bare `void` form used elsewhere in this file.
  it("handles a rejected showLinkGate without an unhandled rejection", async () => {
    const showLinkGate = vi.fn(() => Promise.reject(new Error("no bridge")));
    (window as { openfrontDesktop?: unknown }).openfrontDesktop = {
      showLinkGate,
    };
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const bar = mountBar();
    document.dispatchEvent(
      new CustomEvent("desktop-session-state", {
        detail: { status: "signed-out", reason: "needs-account" },
      }),
    );
    await bar.updateComplete;

    bar.querySelector("button")!.click();

    // Flush the promise's microtask queue so the `.catch` has run before
    // this test ends -- otherwise a missing `.catch` would surface as an
    // unhandled rejection on a LATER test rather than a failure here.
    await Promise.resolve();
    await Promise.resolve();

    expect(showLinkGate).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(
      "desktop-status-bar: showLinkGate failed",
      expect.any(Error),
    );

    errorSpy.mockRestore();
    (window as { openfrontDesktop?: unknown }).openfrontDesktop = undefined;
  });
});
