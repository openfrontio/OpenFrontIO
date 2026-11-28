import {
  JingleJamFeed,
  JingleJamFeedSchema,
} from "@openfront/shared/ApiSchemas";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import jingleJamFallback from "../../../resources/jinglejam.json";
import {
  acceptJingleJam,
  formatGbp,
  jingleJamFeed,
  matchPercent,
} from "../../../src/client/JingleJamFeed";

const getJingleJam = vi.fn<() => Promise<JingleJamFeed>>();
vi.mock("../../../src/client/Api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/client/Api")>()),
  getJingleJam: () => getJingleJam(),
}));

const portal = vi.hoisted(() => ({ on: false }));
vi.mock("../../../src/client/GamePortal", async (importOriginal) => {
  const mod =
    await importOriginal<typeof import("../../../src/client/GamePortal")>();
  return {
    ...mod,
    gamePortal: new Proxy(mod.gamePortal, {
      get: (target, prop) =>
        prop === "isOnGamePortal"
          ? () => portal.on
          : Reflect.get(target, prop, target),
    }),
  };
});

const startedAt = "2026-12-03T18:00:00Z";
const stream = (channel: string, viewers: number) => ({
  platform: "twitch" as const,
  channel,
  displayName: channel,
  viewers,
  url: `https://www.twitch.tv/${channel}`,
  startedAt,
});
const totals = {
  raisedPence: 2_020_800,
  tiltifyPence: 1_410_400,
  packPence: 0,
  matchPence: 610_400,
  matchCapPence: 1_000_000,
  approx: false,
};
const feed = (over: Partial<JingleJamFeed>): JingleJamFeed =>
  JingleJamFeedSchema.parse({
    mode: "live",
    updatedAt: new Date().toISOString(),
    donateUrl: "https://donate.example/gosh",
    ...over,
  });

describe("JingleJamFeedSchema", () => {
  it("reads a live feed", () => {
    const f = feed({ totals, liveStreams: [stream("a", 1)] });
    expect(f.totals?.raisedPence).toBe(2_020_800);
    expect(f.rewards).toEqual([]);
  });

  it("falls back to the default copy for a preset it doesn't know", () => {
    expect(feed({ copy: "brand_new" as never }).copy).toBe("default");
  });

  it("rejects fractional pence and a non-https Donate link", () => {
    expect(
      JingleJamFeedSchema.safeParse({
        mode: "live",
        updatedAt: startedAt,
        totals: { ...totals, raisedPence: 10.5 },
      }).success,
    ).toBe(false);
    expect(
      JingleJamFeedSchema.safeParse({
        mode: "live",
        updatedAt: startedAt,
        donateUrl: "http://donate.example",
      }).success,
    ).toBe(false);
  });

  it("bundles an off fallback", () => {
    expect(JingleJamFeedSchema.parse(jingleJamFallback).mode).toBe("off");
  });
});

describe("money helpers", () => {
  it("formats whole pounds", () => {
    expect(formatGbp(2_020_800)).toBe("£20,208");
    expect(formatGbp(1_000_000)).toBe("£10,000");
    expect(formatGbp(149)).toBe("£1");
  });

  it("clamps the match bar and survives a zero cap", () => {
    expect(matchPercent(610_400, 1_000_000)).toBeCloseTo(61.04);
    expect(matchPercent(2_000_000, 1_000_000)).toBe(100);
    expect(matchPercent(5, 0)).toBe(0);
  });
});

describe("acceptJingleJam (stale feeds)", () => {
  const now = Date.parse("2026-12-03T20:00:00Z");
  const at = (minsAgo: number) =>
    new Date(now - minsAgo * 60_000).toISOString();
  const live = (minsAgo: number) =>
    feed({
      updatedAt: at(minsAgo),
      totals,
      pinned: stream("p", 1),
      liveStreams: [stream("a", 1)],
    });

  it("passes a fresh feed through", () => {
    const f = live(2);
    expect(acceptJingleJam(f, now)).toBe(f);
  });

  it("drops the streams after 15 minutes but keeps the total", () => {
    const f = acceptJingleJam(live(20), now);
    expect(f.mode).toBe("live");
    expect(f.totals?.raisedPence).toBe(2_020_800);
    expect(f.liveStreams).toEqual([]);
    expect(f.pinned).toBeUndefined();
  });

  it("drops a live total after an hour, leaving the static banner", () => {
    const f = acceptJingleJam(live(90), now);
    expect(f.mode).toBe("static");
    expect(f.totals).toBeUndefined();
    expect(f.donateUrl).toBe("https://donate.example/gosh");
  });

  it("goes by the server's clock when the feed carries servedAt", () => {
    // Healthy feed (read a minute before it was served) on a player clock two hours
    // ahead: the total and streams must stay.
    const healthy = feed({
      updatedAt: at(121),
      servedAt: at(120),
      totals,
      liveStreams: [stream("a", 1)],
    });
    const f = acceptJingleJam(healthy, now);
    expect(f.mode).toBe("live");
    expect(f.totals?.raisedPence).toBe(2_020_800);
    expect(f.liveStreams).toHaveLength(1);
  });

  it("a held feed keeps ageing when it is checked again later", () => {
    const received = {
      ...feed({
        updatedAt: at(1),
        servedAt: at(0),
        totals,
        liveStreams: [stream("a", 1)],
      }),
      receivedAt: now,
    };
    expect(acceptJingleJam(received, now).mode).toBe("live");
    const later = acceptJingleJam(received, now + 2 * 60 * 60_000);
    expect(later.mode).toBe("static");
    expect(later.totals).toBeUndefined();
    expect(later.liveStreams).toEqual([]);
  });

  it("a slow player clock can't keep a feed the server says is stale", () => {
    const stale = feed({
      updatedAt: at(0),
      servedAt: new Date(now + 90 * 60_000).toISOString(),
      totals,
    });
    expect(acceptJingleJam(stale, now).mode).toBe("static");
  });

  it("leaves an ended feed alone, however old", () => {
    const f = feed({ mode: "ended", updatedAt: at(60 * 24 * 3), totals });
    expect(acceptJingleJam(f, now)).toBe(f);
  });
});

type Lit = HTMLElement & { updateComplete: Promise<boolean> };

describe("jj-banner and jj-tracker", () => {
  beforeEach(async () => {
    portal.on = false;
    vi.stubGlobal("matchMedia", () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    await import("../../../src/client/components/JingleJamBanner");
    await import("../../../src/client/components/JingleJamTracker");
  });

  afterEach(() => {
    document.body.innerHTML = "";
    jingleJamFeed.reset();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  async function mount(tag: "jj-banner" | "jj-tracker", f: JingleJamFeed) {
    getJingleJam.mockResolvedValue(f);
    const el = document.createElement(tag) as Lit;
    document.body.appendChild(el);
    await el.updateComplete;
    if (!portal.on) {
      await vi.waitFor(() => expect(getJingleJam).toHaveBeenCalled());
    }
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;
    return el;
  }

  it("renders nothing, and takes no space, while off", async () => {
    const el = await mount("jj-banner", feed({ mode: "off" }));
    expect(el.style.display).toBe("none");
    expect(el.textContent?.trim()).toBe("");
  });

  it("shows the total, match bar and Donate while live", async () => {
    const el = await mount("jj-banner", feed({ totals }));
    expect(el.textContent).toContain("£20,208");
    expect(el.querySelector('a[href="https://donate.example/gosh"]')).not.toBe(
      null,
    );
    expect(el.querySelector('[style*="width:61.0%"]')).not.toBe(null);
  });

  it("never shows a £ figure without a total", async () => {
    const el = await mount("jj-banner", feed({ mode: "static" }));
    expect(el.textContent).not.toContain("£");
    expect(el.textContent).toContain("jingle_jam.static_line");
    expect(el.querySelector("a[href^='https://donate']")).not.toBe(null);
  });

  it("puts the pinned stream first and marks it featured", async () => {
    const el = await mount(
      "jj-banner",
      feed({
        totals,
        pinned: stream("punish_lewis", 10),
        liveStreams: [stream("big", 900), stream("small", 5)],
      }),
    );
    const cards = [...el.querySelectorAll("a.jj-stream")];
    expect(cards.map((a) => a.getAttribute("href"))).toEqual([
      "https://www.twitch.tv/punish_lewis",
      "https://www.twitch.tv/big",
      "https://www.twitch.tv/small",
    ]);
    expect(cards[0].textContent).toContain("jingle_jam.featured");
    expect(cards[1].textContent).not.toContain("jingle_jam.featured");
  });

  it("shows at most six stream cards", async () => {
    const el = await mount(
      "jj-banner",
      feed({
        totals,
        liveStreams: Array.from({ length: 9 }, (_, i) => stream(`s${i}`, i)),
      }),
    );
    expect(el.querySelectorAll("a.jj-stream")).toHaveLength(6);
  });

  it("thanks everyone once ended, with no Donate and no streams", async () => {
    const el = await mount(
      "jj-banner",
      feed({ mode: "ended", totals, liveStreams: [stream("a", 1)] }),
    );
    expect(el.textContent).toContain("jingle_jam.thanks");
    expect(el.querySelector("a[href^='https://donate']")).toBe(null);
    expect(el.querySelectorAll("a.jj-stream")).toHaveLength(0);
  });

  it("shows the punishment menu only when the feed has rewards", async () => {
    const el = await mount(
      "jj-banner",
      feed({
        totals,
        rewards: [{ name: "Only warships", amountPence: 2_500 }],
      }),
    );
    expect(el.textContent).toContain("jingle_jam.punishment_menu");
    expect(el.textContent).toContain("Only warships");
  });

  it("isn't shown on a game portal, and doesn't fetch there", async () => {
    portal.on = true;
    const el = await mount("jj-banner", feed({ totals }));
    expect(el.style.display).toBe("none");
    expect(getJingleJam).not.toHaveBeenCalled();
  });

  it("lobby tracker: total and Donate while live", async () => {
    const el = await mount("jj-tracker", feed({ totals }));
    expect(el.textContent).toContain("£20,208");
    expect(el.querySelector("a[href^='https://donate']")).not.toBe(null);
  });

  it("shows the day's message on phones too, under the match caption", async () => {
    const el = await mount("jj-banner", feed({ totals, copy: "punish_today" }));
    const phone = el.querySelector(".jj-copy-phone");
    expect(phone?.textContent).toContain("jingle_jam.copy_punish_today");
    expect(el.textContent).toContain("jingle_jam.match_caption_short");
  });

  it('with a zero match cap, shows no match bar and never "£0"', async () => {
    const el = await mount(
      "jj-banner",
      feed({ totals: { ...totals, matchPence: 0, matchCapPence: 0 } }),
    );
    expect(el.textContent).not.toContain("£0");
    expect(el.textContent).not.toContain("jingle_jam.match");
    expect(el.querySelector('[style*="width:"]')).toBe(null);
    expect(el.textContent).toContain("jingle_jam.copy_default_nocap");
  });

  it("ended with no total says it has finished, not that it's running", async () => {
    const el = await mount("jj-banner", feed({ mode: "ended" }));
    expect(el.textContent).toContain("jingle_jam.ended_line");
    expect(el.textContent).not.toContain("jingle_jam.static_line");
    expect(el.textContent).not.toContain("£");
  });

  it("lobby tracker: no match bar with a zero cap", async () => {
    const el = await mount(
      "jj-tracker",
      feed({ totals: { ...totals, matchPence: 0, matchCapPence: 0 } }),
    );
    expect(el.textContent).toContain("£20,208");
    expect(el.textContent).not.toContain("jingle_jam.matched_short");
  });

  it("lobby tracker: no Donate once ended", async () => {
    const el = await mount("jj-tracker", feed({ mode: "ended", totals }));
    expect(el.textContent).toContain("jingle_jam.thanks_short");
    expect(el.querySelector("a")).toBe(null);
  });

  it("stops polling once the game starts", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      await mount("jj-tracker", feed({ totals }));
      const calls = getJingleJam.mock.calls.length;
      document.dispatchEvent(new Event("game-starting"));
      await vi.advanceTimersByTimeAsync(180_000);
      expect(getJingleJam.mock.calls.length).toBe(calls);
    } finally {
      vi.useRealTimers();
    }
  });
});
