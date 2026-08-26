import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatViewers } from "../../../src/client/components/StreamingNow";
import { streamsFeed, watchUrl } from "../../../src/client/StreamsFeed";
import type { StreamsFeed } from "../../../src/core/ApiSchemas";

const getStreams = vi.fn<() => Promise<StreamsFeed>>();
vi.mock("../../../src/client/Api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/client/Api")>()),
  getStreams: () => getStreams(),
}));

// Every entry in the feed is a verified-live broadcast, so startedAt is always present.
const startedAt = "2026-08-03T12:00:00Z";

describe("StreamingNow", () => {
  describe("watchUrl", () => {
    it("derives a Twitch URL from the channel", () => {
      expect(
        watchUrl({
          platform: "twitch",
          channel: "zixer",
          displayName: "Zixer",
          viewers: 0,
          startedAt,
        }),
      ).toBe("https://www.twitch.tv/zixer");
    });

    it("derives a YouTube URL from the channel", () => {
      expect(
        watchUrl({
          platform: "youtube",
          channel: "@ofm",
          displayName: "OFM",
          viewers: 0,
          startedAt,
        }),
      ).toBe("https://www.youtube.com/@ofm");
    });

    it("prefers an explicit url over the derived one", () => {
      expect(
        watchUrl({
          platform: "twitch",
          channel: "zixer",
          displayName: "Zixer",
          viewers: 0,
          startedAt,
          url: "https://example.com/live",
        }),
      ).toBe("https://example.com/live");
    });
  });

  describe("formatViewers", () => {
    it("formats counts across magnitudes", () => {
      expect(formatViewers(0)).toBe("0");
      expect(formatViewers(932)).toBe("932");
      expect(formatViewers(1234)).toBe("1.2K");
      expect(formatViewers(9999)).toBe("10K"); // no stray "10.0K"
      expect(formatViewers(12345)).toBe("12K");
      expect(formatViewers(999_600)).toBe("1.0M"); // no "1000K"
      expect(formatViewers(1_200_000)).toBe("1.2M");
    });
  });

  // The panel used to own a 90s setInterval cleared only in disconnectedCallback — which
  // never runs, because <play-page> is never removed from the DOM. These pin the
  // replacement: it owns no timer, it renders only what the API verified, and it stops
  // when the shared poller stops.
  describe("panel behaviour", () => {
    beforeEach(async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      getStreams.mockResolvedValue({
        verifiedAt: new Date().toISOString(),
        featured: [],
        live: [
          {
            platform: "twitch",
            channel: "bobthegamertwitch",
            displayName: "Bob",
            viewers: 14,
            url: "https://twitch.tv/bobthegamertwitch",
            startedAt,
          },
          {
            platform: "youtube",
            channel: "@enzo",
            displayName: "Enzo",
            viewers: 300,
            url: "https://www.youtube.com/watch?v=vid1",
            startedAt,
          },
        ],
      });
      // The host is desktop-only; jsdom's matchMedia reports no match for everything.
      vi.stubGlobal("matchMedia", () => ({ matches: true }));
      await import("../../../src/client/components/StreamingNow");
    });

    afterEach(() => {
      document.body.innerHTML = "";
      streamsFeed.reset();
      vi.useRealTimers();
      vi.clearAllMocks();
      vi.unstubAllGlobals();
    });

    const mount = async () => {
      const el = document.createElement("streaming-now") as HTMLElement & {
        updateComplete: Promise<boolean>;
      };
      document.body.appendChild(el);
      await el.updateComplete;
      await vi.waitFor(() => expect(getStreams).toHaveBeenCalled());
      await new Promise((r) => setTimeout(r, 0));
      await el.updateComplete;
      return el;
    };

    it("renders a card per verified-live stream, highest viewers first", async () => {
      const el = await mount();
      const names = [...el.querySelectorAll("a")].map(
        (a) => a.getAttribute("href") ?? "",
      );
      expect(names).toEqual([
        "https://www.youtube.com/watch?v=vid1", // 300 viewers
        "https://twitch.tv/bobthegamertwitch", // 14
      ]);
      expect(el.style.display).not.toBe("none");
    });

    // Viewer counts flow through translateText, which is stubbed to return the bare key
    // here, so the observable proof that YouTube carries a real count is the ordering
    // above (300 ahead of 14) plus the entry rendering at all — it used to be a
    // hardcoded 0 for every YouTube channel.
    it("renders each streamer's display name", async () => {
      const el = await mount();
      expect(el.textContent).toContain("Enzo");
      expect(el.textContent).toContain("Bob");
    });

    // The panel used to hide itself; it stays and invites instead, so the
    // invite is the only link on it.
    it("invites streamers when nobody is live", async () => {
      getStreams.mockResolvedValue({
        verifiedAt: new Date().toISOString(),
        featured: [],
        live: [],
      });
      const el = await mount();
      expect(el.style.display).not.toBe("none");
      const links = el.querySelectorAll("a");
      expect(links).toHaveLength(1);
      expect(links[0].getAttribute("href")).toContain("discord.gg");
    });

    // A feed older than the poller's max age is delivered as the empty sentinel,
    // the same value it hands over before the first fetch. Reading "loaded" off
    // that would blank the panel mid-session and leave the row a column short.
    it("keeps the panel when a loaded feed later goes stale", async () => {
      const el = await mount();
      expect(el.textContent).toContain("Enzo");

      getStreams.mockResolvedValue({
        verifiedAt: new Date(Date.now() - 60 * 60_000).toISOString(),
        featured: [],
        live: [],
      });
      await vi.advanceTimersByTimeAsync(5 * 60_000);
      await el.updateComplete;

      const links = el.querySelectorAll("a");
      expect(links).toHaveLength(1);
      expect(links[0].getAttribute("href")).toContain("discord.gg");
    });

    // A failed or stale fetch delivers the same sentinel as the pre-fetch cache.
    // Reading "loaded" off the value alone leaves the column blank for good.
    it("invites streamers when the feed never loads", async () => {
      getStreams.mockResolvedValue({
        verifiedAt: new Date(Date.now() - 60 * 60_000).toISOString(),
        featured: [],
        live: [],
      });
      const el = await mount();

      const links = el.querySelectorAll("a");
      expect(links).toHaveLength(1);
      expect(links[0].getAttribute("href")).toContain("discord.gg");
    });

    it("owns no timer: disconnecting stops all polling", async () => {
      const el = await mount();
      const before = getStreams.mock.calls.length;
      el.remove();
      await vi.advanceTimersByTimeAsync(5 * 60_000);
      expect(getStreams.mock.calls.length).toBe(before);
    });
  });
});
