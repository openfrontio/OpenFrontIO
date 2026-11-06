import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const scripts = () =>
  document.head.querySelectorAll<HTMLScriptElement>(
    'script[src*="youtube.com/iframe_api"]',
  );
const fakeYT = { Player: class {}, PlayerState: { ENDED: 0 } };
const win = window as unknown as {
  YT?: unknown;
  onYouTubeIframeAPIReady?: () => void;
};

describe("loadYouTubeSdk", () => {
  // The loader caches its promise at module level, so each test loads a fresh copy.
  const load = async () => {
    vi.resetModules();
    return import("../../../src/client/YouTubeSdk");
  };

  beforeEach(() => {
    vi.useFakeTimers();
    win.YT = undefined;
    delete win.onYouTubeIframeAPIReady;
  });

  afterEach(() => {
    scripts().forEach((s) => s.remove());
    win.YT = undefined;
    delete win.onYouTubeIframeAPIReady;
    vi.useRealTimers();
  });

  it("resolves when the API says it is ready, and only loads it once", async () => {
    const { loadYouTubeSdk, SDK_READY_TIMEOUT_MS } = await load();
    const first = loadYouTubeSdk();
    expect(loadYouTubeSdk()).toBe(first);
    expect(scripts()).toHaveLength(1);

    win.YT = fakeYT;
    win.onYouTubeIframeAPIReady!();
    await expect(first).resolves.toBe(fakeYT);

    // The timeout was cancelled, and the result stays cached.
    await vi.advanceTimersByTimeAsync(SDK_READY_TIMEOUT_MS * 2);
    expect(loadYouTubeSdk()).toBe(first);
    expect(scripts()).toHaveLength(1);
  });

  it("does not add a script when the API is already on the page", async () => {
    win.YT = fakeYT;
    const { loadYouTubeSdk } = await load();
    await expect(loadYouTubeSdk()).resolves.toBe(fakeYT);
    expect(scripts()).toHaveLength(0);
  });

  it("calls a ready callback that was already on the page", async () => {
    const prev = vi.fn();
    win.onYouTubeIframeAPIReady = prev;
    const { loadYouTubeSdk } = await load();
    const loading = loadYouTubeSdk();
    win.YT = fakeYT;
    win.onYouTubeIframeAPIReady!();
    await loading;
    expect(prev).toHaveBeenCalledOnce();
  });

  it("can try again after the script fails to load", async () => {
    const { loadYouTubeSdk } = await load();
    const failed = loadYouTubeSdk();
    scripts()[0].onerror!(new Event("error"));
    await expect(failed).rejects.toThrow("failed to load");
    expect(scripts()).toHaveLength(0);

    const retry = loadYouTubeSdk();
    expect(retry).not.toBe(failed);
    expect(scripts()).toHaveLength(1);
    win.YT = fakeYT;
    win.onYouTubeIframeAPIReady!();
    await expect(retry).resolves.toBe(fakeYT);
  });

  // The bootstrap loaded but the player script it fetches did not, so nothing ever fires.
  it("gives up on a load that stalls, and clears the bootstrap's state for a retry", async () => {
    const { loadYouTubeSdk, SDK_READY_TIMEOUT_MS } = await load();
    const stalled = loadYouTubeSdk();
    // What the bootstrap leaves behind. Its global `var YT` can't be deleted, which
    // this has to reproduce: a delete would throw before the load gave up.
    Object.defineProperty(window, "YT", {
      value: { loading: 1, loaded: 0 },
      writable: true,
      configurable: false,
    });
    const rejected = expect(stalled).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(SDK_READY_TIMEOUT_MS);
    await rejected;
    expect(win.YT).toBeUndefined();
    expect(scripts()).toHaveLength(0);

    const retry = loadYouTubeSdk();
    expect(retry).not.toBe(stalled);
    expect(scripts()).toHaveLength(1);
    win.YT = fakeYT;
    win.onYouTubeIframeAPIReady!();
    await expect(retry).resolves.toBe(fakeYT);
  });

  it("does not stack ready callbacks across failed attempts", async () => {
    const prev = vi.fn();
    win.onYouTubeIframeAPIReady = prev;
    const { loadYouTubeSdk } = await load();
    const failed = loadYouTubeSdk();
    scripts()[0].onerror!(new Event("error"));
    await expect(failed).rejects.toThrow();
    expect(win.onYouTubeIframeAPIReady).toBe(prev);
  });

  it("can try again if the ready callback fires with no player", async () => {
    const { loadYouTubeSdk } = await load();
    const failed = loadYouTubeSdk();
    win.onYouTubeIframeAPIReady!();
    await expect(failed).rejects.toThrow("missing");
    expect(loadYouTubeSdk()).not.toBe(failed);
  });
});
