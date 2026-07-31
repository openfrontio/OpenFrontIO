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
