import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { streamsFeed } from "../../../src/client/StreamsFeed";
import type { LiveStream, StreamsFeed } from "../../../src/core/ApiSchemas";

// Mounting behaviour of the <featured-stream> panel. The point of these tests is the
// request cost: liveness used to be detected in the browser by constructing a real
// autoplaying Twitch.Player for each configured channel and reading its ONLINE/OFFLINE
// events, which cost ~300 Twitch requests on every homepage load even when nobody was
// live and the panel stayed invisible. The API now serves only verified-live
// broadcasts, so an empty list must construct no player at all — and a broadcast that
// reports itself offline must never be re-mounted.
const getStreams = vi.fn<() => Promise<StreamsFeed>>();
vi.mock("../../../src/client/Api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/client/Api")>()),
  getStreams: () => getStreams(),
}));

// Stand-in for the Twitch Embed SDK: records every player constructed and lets a test
// drive the player events the real embed fires.
class FakePlayer {
  static readonly READY = "ready";
  static readonly ONLINE = "online";
  static readonly OFFLINE = "offline";
  static readonly ENDED = "ended";
  static constructed: string[] = [];
  static last: FakePlayer | undefined;
  // Set to make the next construction throw, standing in for a blocked/failed embed.
  // A flag rather than a swapped-in class because FeaturedStream memoizes the resolved
  // SDK in a module-level `sdkPromise`, so the first test's window.Twitch is what every
  // later test in this file actually gets.
  static failNext = false;

  ended = false;
  private handlers = new Map<string, () => void>();

  constructor(_el: HTMLElement, opts: Record<string, unknown>) {
    FakePlayer.constructed.push(String(opts.channel));
    FakePlayer.last = this;
    if (FakePlayer.failNext) {
      FakePlayer.failNext = false;
      throw new Error("embed blocked");
    }
  }
  addEventListener(event: string, cb: () => void) {
    this.handlers.set(event, cb);
  }
  getEnded() {
    return this.ended;
  }
  play() {}
  pause() {}
  setMuted() {}
  destroy() {}
  fire(event: string) {
    this.handlers.get(event)?.();
  }
}

const stream = (
  channel: string,
  startedAt = "2026-08-03T12:00:00Z",
): LiveStream => ({
  platform: "twitch",
  channel,
  displayName: channel,
  viewers: 10,
  url: `https://twitch.tv/${channel}`,
  startedAt,
});

describe("featured-stream panel", () => {
  beforeEach(async () => {
    // shouldAdvanceTime keeps awaited microtask/0ms hops working while still letting a
    // test inspect pending timers and jump the poll interval.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    FakePlayer.constructed = [];
    FakePlayer.last = undefined;
    FakePlayer.failNext = false;
    localStorage.clear();
    (window as unknown as { Twitch: unknown }).Twitch = { Player: FakePlayer };
    // Importing registers the custom element; the SDK loader short-circuits on the
    // window.Twitch set above, so no script tag is ever appended.
    await import("../../../src/client/FeaturedStream");
  });

  afterEach(() => {
    document.body.innerHTML = ""; // disconnect -> the panel unsubscribes
    // streamsFeed is a module singleton: without this its cached feed and in-game flag
    // carry into the next test, which would construct a player before that test's own
    // feed arrives, or leave polling stopped.
    streamsFeed.reset();
    delete (window as unknown as { Twitch?: unknown }).Twitch;
    delete (window as unknown as { adsEnabled?: boolean }).adsEnabled;
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  // verifiedAt is recomputed per call so the feed never ages past the client's freshness
  // window when a test jumps the clock.
  const serve = (...featured: LiveStream[]) =>
    getStreams.mockImplementation(async () => ({
      verifiedAt: new Date().toISOString(),
      featured,
      live: [],
    }));

  const mount = async (...featured: LiveStream[]) => {
    serve(...featured);
    const el = document.createElement("featured-stream") as HTMLElement & {
      updateComplete: Promise<boolean>;
    };
    document.body.appendChild(el);
    await el.updateComplete;
    await vi.waitFor(() => expect(getStreams).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0)); // let the async mount chain settle
    await el.updateComplete;
    return el;
  };

  const card = () => document.querySelector("#featured-stream-card");

  it("constructs no Twitch player when the API reports nobody live", async () => {
    await mount();
    expect(FakePlayer.constructed).toEqual([]);
    expect(card()).toBeNull();
  });

  it("embeds exactly one player for the broadcast the API reports live", async () => {
    await mount(stream("openfrontmasters"), stream("openfront"));
    // One mount, not one per configured channel: the API already did the liveness check.
    expect(FakePlayer.constructed).toEqual(["openfrontmasters"]);
    expect(card()).not.toBeNull();
  });

  it("shows the panel once the player reports it is playing", async () => {
    const el = await mount(stream("openfrontmasters"));
    expect(card()?.className).toContain("opacity-0"); // hidden while the player boots
    FakePlayer.last!.fire(FakePlayer.READY);
    await el.updateComplete;
    expect(card()?.className).toContain("opacity-100");
  });

  it("hides the panel when the served feed was stale and the channel is offline", async () => {
    // Worst case of server-side liveness: the stream ended between the cron tick and
    // this page load. An offline-at-load channel fires READY with getEnded() true.
    const el = await mount(stream("openfrontmasters"));
    FakePlayer.last!.ended = true;
    FakePlayer.last!.fire(FakePlayer.READY);
    await el.updateComplete;
    expect(card()).toBeNull();
  });

  // The regression this whole change exists to prevent. The feed keeps naming the
  // channel for up to ~3 min (2 min cron + 60s edge cache); before the fix, every poll
  // re-booted a full Twitch player — ~125 requests a minute, indefinitely.
  it("never re-mounts a player for a broadcast that reported offline", async () => {
    const el = await mount(stream("openfrontmasters"));
    FakePlayer.last!.ended = true;
    FakePlayer.last!.fire(FakePlayer.READY);
    await el.updateComplete;
    expect(card()).toBeNull();

    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(FakePlayer.constructed).toEqual(["openfrontmasters"]);
    expect(card()).toBeNull();
  });

  // ...but the suppression is per-broadcast, not per-channel, so a genuine restart is
  // embeddable again.
  it("mounts again when the same channel starts a new broadcast", async () => {
    const el = await mount(stream("openfrontmasters"));
    FakePlayer.last!.ended = true;
    FakePlayer.last!.fire(FakePlayer.READY);
    await el.updateComplete;
    expect(FakePlayer.constructed).toEqual(["openfrontmasters"]);

    serve(stream("openfrontmasters", "2026-08-03T18:00:00Z"));
    await vi.advanceTimersByTimeAsync(61_000);
    await el.updateComplete;
    expect(FakePlayer.constructed).toEqual([
      "openfrontmasters",
      "openfrontmasters",
    ]);
  });

  // Regression: the dedupe guard originally checked only "same broadcast", so any mount
  // that failed left `stream` set with no player and every later tick short-circuited to
  // kickPlay() — a permanently blank card for the rest of the broadcast.
  it("retries the mount after a player construction failure", async () => {
    FakePlayer.failNext = true;
    const el = await mount(stream("openfrontmasters"));
    expect(FakePlayer.constructed).toEqual(["openfrontmasters"]); // attempted once
    expect(card()?.className).toContain("opacity-0"); // nothing playing

    await vi.advanceTimersByTimeAsync(61_000);
    await el.updateComplete;
    expect(FakePlayer.constructed).toEqual([
      "openfrontmasters",
      "openfrontmasters",
    ]);
  });

  // Closing must stop everything: no poll left scheduled, no player rebuilt. Minimizing
  // deliberately does not, because Twitch's terms disallow an obscured embed, so the
  // minimized panel stays a visible thumbnail that keeps playing.
  describe("closing", () => {
    const clickByLabel = (el: HTMLElement, label: string) => {
      const btn = el.querySelector(
        `[aria-label="${label}"]`,
      ) as HTMLElement | null;
      expect(btn, `no button labelled ${label}`).not.toBeNull();
      btn!.click();
    };

    const open = async (adFree: boolean) => {
      (window as unknown as { adsEnabled?: boolean }).adsEnabled = !adFree;
      const el = await mount(stream("openfrontmasters"));
      FakePlayer.last!.fire(FakePlayer.READY);
      await el.updateComplete;
      return el;
    };

    // The point of this change: closing no longer requires minimising first, and is no
    // longer reserved for people who have paid.
    it("offers close to an ad-supported user without minimising first", async () => {
      const el = await open(false);
      expect(el.querySelector('[aria-label="common.close"]')).not.toBeNull();
      expect(
        el.querySelector('[aria-label="featured_stream.hide_today"]'),
      ).toBeNull(); // hide-for-today stays ad-free only
    });

    it("offers all three controls to an ad-free user", async () => {
      const el = await open(true);
      expect(
        el.querySelector('[aria-label="featured_stream.minimize"]'),
      ).not.toBeNull();
      expect(el.querySelector('[aria-label="common.close"]')).not.toBeNull();
      expect(
        el.querySelector('[aria-label="featured_stream.hide_today"]'),
      ).not.toBeNull();
    });

    it("removes the panel and stops polling entirely", async () => {
      const el = await open(false);
      clickByLabel(el, "common.close");
      await el.updateComplete;
      expect(card()).toBeNull();
      const before = getStreams.mock.calls.length;
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      expect(getStreams).toHaveBeenCalledTimes(before); // no further requests
      expect(FakePlayer.constructed).toEqual(["openfrontmasters"]); // no new player
    });

    // Positive control: the same 10 minute jump does keep polling while the panel is
    // only waiting for someone to go live, so the assertion above is not vacuous.
    it("(control) keeps polling while nobody is live", async () => {
      await mount();
      const before = getStreams.mock.calls.length;
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      expect(getStreams.mock.calls.length).toBeGreaterThan(before);
    });

    it("does not come back when a game ends", async () => {
      const el = await open(false);
      clickByLabel(el, "common.close");
      await el.updateComplete;
      document.dispatchEvent(new CustomEvent("leave-lobby"));
      await el.updateComplete;
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      expect(card()).toBeNull();
      expect(FakePlayer.constructed).toEqual(["openfrontmasters"]);
    });

    // A plain close is for this visit only, whoever you are.
    it("does not persist an ordinary close, even for an ad-free user", async () => {
      const el = await open(true);
      clickByLabel(el, "common.close");
      await el.updateComplete;
      expect(localStorage.getItem("featured-stream-closed")).toBeNull();
    });

    it("persists hide-for-today and suppresses the panel on the next visit", async () => {
      const el = await open(true);
      clickByLabel(el, "featured_stream.hide_today");
      await el.updateComplete;
      expect(localStorage.getItem("featured-stream-closed")).not.toBeNull();

      // Remount as if the page were reloaded the same day. Built by hand rather than via
      // mount(), which waits for a fetch this path must never make.
      document.body.innerHTML = "";
      streamsFeed.reset();
      getStreams.mockClear();
      const again = document.createElement("featured-stream") as HTMLElement & {
        updateComplete: Promise<boolean>;
      };
      document.body.appendChild(again);
      await again.updateComplete;
      await vi.advanceTimersByTimeAsync(1000);
      await again.updateComplete;
      expect(card()).toBeNull();
      expect(getStreams).not.toHaveBeenCalled(); // never even asks the API
    });

    it("shows again once the stored day is stale", async () => {
      localStorage.setItem("featured-stream-closed", "1999-1-1");
      const el = await mount(stream("openfrontmasters"));
      FakePlayer.last!.fire(FakePlayer.READY);
      await el.updateComplete;
      expect(card()).not.toBeNull();
      expect(localStorage.getItem("featured-stream-closed")).toBeNull(); // pruned
    });
  });

  it("hides the panel when a live stream ends mid-session", async () => {
    const el = await mount(stream("openfrontmasters"));
    FakePlayer.last!.fire(FakePlayer.READY);
    await el.updateComplete;
    expect(card()).not.toBeNull();

    FakePlayer.last!.fire(FakePlayer.ENDED);
    await el.updateComplete;
    expect(card()).toBeNull();
  });

  // Polling must stop while a game is running: a stream coming online must not mount an
  // autoplaying player behind the hidden panel (an obscured embed breaks Twitch's ToS).
  it("stops polling while a game is running", async () => {
    await mount();
    document.dispatchEvent(new CustomEvent("game-starting"));
    const before = getStreams.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(getStreams).toHaveBeenCalledTimes(before);
  });
});
