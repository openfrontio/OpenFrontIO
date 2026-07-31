import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FeaturedStreamConfig } from "../../../src/core/ApiSchemas";

// Mounting behaviour of the <featured-stream> panel. The point of these tests is the
// request cost: liveness used to be detected in the browser by constructing a real
// autoplaying Twitch.Player for each configured channel and reading its ONLINE/OFFLINE
// events, which cost ~300 Twitch requests on every homepage load even when nobody was
// live and the panel stayed invisible. The API now serves only live channels, so an empty
// list must construct no player at all.
const getFeaturedStream = vi.fn<() => Promise<FeaturedStreamConfig>>();
vi.mock("../../../src/client/Api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/client/Api")>()),
  getFeaturedStream: () => getFeaturedStream(),
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

  ended = false;
  private handlers = new Map<string, () => void>();

  constructor(_el: HTMLElement, opts: Record<string, unknown>) {
    FakePlayer.constructed.push(String(opts.channel));
    FakePlayer.last = this;
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

const cfg = (
  enabled: boolean,
  channels: string[] = [],
): FeaturedStreamConfig => ({ enabled, channels });

describe("featured-stream panel", () => {
  beforeEach(async () => {
    // shouldAdvanceTime keeps awaited microtask/0ms hops working while still letting a test
    // inspect pending timers and jump the poll interval.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    FakePlayer.constructed = [];
    FakePlayer.last = undefined;
    localStorage.clear();
    (window as unknown as { Twitch: unknown }).Twitch = { Player: FakePlayer };
    // Importing registers the custom element; the SDK loader short-circuits on the
    // window.Twitch set above, so no script tag is ever appended.
    await import("../../../src/client/FeaturedStream");
  });

  afterEach(() => {
    document.body.innerHTML = "";
    delete (window as unknown as { Twitch?: unknown }).Twitch;
    delete (window as unknown as { adsEnabled?: boolean }).adsEnabled;
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  const mount = async (config: FeaturedStreamConfig) => {
    getFeaturedStream.mockResolvedValue(config);
    const el = document.createElement("featured-stream") as HTMLElement & {
      updateComplete: Promise<boolean>;
    };
    document.body.appendChild(el);
    await el.updateComplete;
    await vi.waitFor(() => expect(getFeaturedStream).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0)); // let the async mount chain settle
    await el.updateComplete;
    return el;
  };

  const card = () => document.querySelector("#featured-stream-card");

  it("constructs no Twitch player when the API reports nobody live", async () => {
    await mount(cfg(true, []));
    expect(FakePlayer.constructed).toEqual([]);
    expect(card()).toBeNull();
  });

  it("constructs no Twitch player when the feature is off", async () => {
    await mount(cfg(false, ["openfrontmasters"]));
    expect(FakePlayer.constructed).toEqual([]);
    expect(card()).toBeNull();
  });

  it("embeds exactly one player for the channel the API reports live", async () => {
    await mount(cfg(true, ["openfrontmasters", "openfront"]));
    // One mount, not one per configured channel: the API already did the liveness check.
    expect(FakePlayer.constructed).toEqual(["openfrontmasters"]);
    expect(card()).not.toBeNull();
  });

  it("shows the panel once the player reports it is playing", async () => {
    const el = await mount(cfg(true, ["openfrontmasters"]));
    expect(card()?.className).toContain("opacity-0"); // hidden while the player boots
    FakePlayer.last!.fire(FakePlayer.READY);
    await el.updateComplete;
    expect(card()?.className).toContain("opacity-100");
  });

  it("hides the panel when the served config was stale and the channel is offline", async () => {
    // Worst case of server-side liveness: the stream ended between the cron tick and this
    // page load. An offline-at-load channel fires READY with getEnded() already true.
    const el = await mount(cfg(true, ["openfrontmasters"]));
    FakePlayer.last!.ended = true;
    FakePlayer.last!.fire(FakePlayer.READY);
    await el.updateComplete;
    expect(card()).toBeNull();
  });

  // Closing must stop everything: no poll left scheduled, no player rebuilt. Minimizing
  // deliberately does not, because Twitch's terms disallow an obscured embed, so the
  // minimized panel stays a visible thumbnail that keeps playing.
  describe("after the user closes the panel", () => {
    const clickByLabel = (el: HTMLElement, label: string) => {
      const btn = el.querySelector(
        `[aria-label="${label}"]`,
      ) as HTMLElement | null;
      expect(btn, `no button labelled ${label}`).not.toBeNull();
      btn!.click();
    };

    const openThenClose = async () => {
      // The x only exists for ad-free users, and only once minimized.
      (window as unknown as { adsEnabled?: boolean }).adsEnabled = false;
      const el = await mount(cfg(true, ["openfrontmasters"]));
      FakePlayer.last!.fire(FakePlayer.READY);
      await el.updateComplete;
      clickByLabel(el, "featured_stream.minimize");
      await el.updateComplete;
      clickByLabel(el, "common.close");
      await el.updateComplete;
      return el;
    };

    it("removes the panel and stops polling entirely", async () => {
      await openThenClose();
      expect(card()).toBeNull();
      const before = getFeaturedStream.mock.calls.length;
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      expect(getFeaturedStream).toHaveBeenCalledTimes(before); // no further requests
      expect(FakePlayer.constructed).toEqual(["openfrontmasters"]); // no new player
    });

    // Positive control: the same 10 minute jump does keep polling while the panel is only
    // waiting for someone to go live, so the assertion above is not vacuous.
    it("(control) keeps polling while nobody is live", async () => {
      await mount(cfg(true, []));
      const before = getFeaturedStream.mock.calls.length;
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      expect(getFeaturedStream.mock.calls.length).toBeGreaterThan(before);
    });

    it("does not come back when a game ends", async () => {
      const el = await openThenClose();
      document.dispatchEvent(new CustomEvent("leave-lobby"));
      await el.updateComplete;
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      expect(card()).toBeNull();
      expect(FakePlayer.constructed).toEqual(["openfrontmasters"]);
    });
  });

  it("hides the panel when a live stream ends mid-session", async () => {
    const el = await mount(cfg(true, ["openfrontmasters"]));
    FakePlayer.last!.fire(FakePlayer.READY);
    await el.updateComplete;
    expect(card()).not.toBeNull();

    FakePlayer.last!.fire(FakePlayer.ENDED);
    await el.updateComplete;
    expect(card()).toBeNull();
  });
});
