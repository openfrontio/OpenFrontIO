import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClientEnv } from "../src/client/ClientEnv";
import "../src/client/components/DesktopStatusBar";
import { barSource } from "../src/client/components/DesktopStatusBar";
import {
  backendReachable,
  ensureServerList,
  resetServerList,
} from "../src/client/ServerList";

describe("barSource", () => {
  it("shows nothing when both states are healthy", () => {
    expect(
      barSource(
        { status: "current", bytes: 0, total: 0 },
        { status: "signed-in" },
        true,
      ),
    ).toBe("none");
  });

  it("shows the update when the session is fine", () => {
    expect(
      barSource(
        { status: "downloading", bytes: 1, total: 2 },
        { status: "signed-in" },
        true,
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
        true,
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
        true,
      ),
    ).toBe("update");
  });

  it("shows nothing on the web, where neither bridge exists", () => {
    expect(barSource(null, null, null)).toBe("none");
  });

  // OPE-439. Reachability sits between the two: below the session, because a
  // session failure names a more specific remedy, and above the update,
  // because an update failure while the backend is unreachable is a SYMPTOM
  // of it -- "Couldn't download the update -- Retry" points at a button that
  // provably cannot work until the network is back.
  it("shows the offline state over any update state", () => {
    expect(
      barSource({ status: "current", bytes: 0, total: 0 }, null, false),
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
        false,
      ),
    ).toBe("reachability");
  });

  it("still shows the session over the offline state", () => {
    expect(
      barSource(null, { status: "signed-out", reason: "network" }, false),
    ).toBe("session");
  });

  // No neutral state exists in this bar to hang a "Checking…" on, and
  // inventing one would put a permanent strip across the bottom of a healthy
  // game for the sake of its first few hundred milliseconds.
  it("shows nothing while the first attempt has not settled", () => {
    expect(barSource(null, { status: "signed-in" }, null)).toBe("none");
    expect(
      barSource({ status: "current", bytes: 0, total: 0 }, null, null),
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
  });

  afterEach(() => {
    document.body.innerHTML = "";
    (window as { openfrontDesktop?: unknown }).openfrontDesktop = undefined;
    window.BOOTSTRAP_CONFIG = undefined;
    ClientEnv.reset();
    resetServerList();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("shows nothing while the backend is fine", async () => {
    // The control: the bar must not become a permanent fixture just because
    // this feature exists.
    fetchMock.mockImplementation(
      async () => new Response("{}", { status: 404 }),
    );
    await ensureServerList();
    expect(backendReachable()).toBe(true);

    const bar = mountBar();
    await bar.updateComplete;
    expect(bar.textContent?.trim()).toBe("");
  });

  it("seeds the offline state from an attempt that failed before it mounted", async () => {
    await ensureServerList();
    expect(backendReachable()).toBe(false);

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

    await ensureServerList();
    await bar.updateComplete;

    expect(bar.textContent).toContain("desktop_status.offline");
  });

  it("Retry attempts again immediately, and the bar clears when the API answers", async () => {
    await ensureServerList();
    const bar = mountBar();
    await bar.updateComplete;
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // A 404 is an answer: this site has no list, but the backend is up. That
    // is the boundary the bar keys on, so it is the one worth clearing on.
    fetchMock.mockImplementation(
      async () => new Response("{}", { status: 404 }),
    );
    retryButton(bar)!.click();

    // Immediately, without waiting out the heartbeat's retry interval -- the
    // whole point of the button.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.waitFor(() => expect(backendReachable()).toBe(true));
    await bar.updateComplete;
    expect(bar.textContent?.trim()).toBe("");
  });
});
