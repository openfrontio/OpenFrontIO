import {
  formatViewers,
  watchUrl,
} from "../../../src/client/components/StreamingNow";

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
});
