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

  function retryButton(bar: HTMLElement): HTMLButtonElement | undefined {
    return Array.from(bar.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("desktop_status.retry"),
    );
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
});
