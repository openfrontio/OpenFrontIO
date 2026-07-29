import liveStreamsFallback from "../../../resources/live-streams.json";
import {
  formatViewers,
  watchUrl,
} from "../../../src/client/components/StreamingNow";
import { LiveStreamsSchema } from "../../../src/core/ApiSchemas";

describe("StreamingNow", () => {
  describe("watchUrl", () => {
    it("derives a Twitch URL from the channel", () => {
      expect(
        watchUrl({
          platform: "twitch",
          channel: "zixer",
          displayName: "Zixer",
          viewers: 0,
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

  describe("LiveStreamsSchema", () => {
    it("parses a valid config and applies defaults", () => {
      const cfg = LiveStreamsSchema.parse({
        enabled: true,
        streams: [
          { platform: "twitch", channel: "zixer", displayName: "Zixer" },
        ],
      });
      expect(cfg.enabled).toBe(true);
      expect(cfg.streams[0].viewers).toBe(0); // default
    });

    it("rejects a malformed stream entry (fails closed)", () => {
      const parsed = LiveStreamsSchema.safeParse({
        enabled: true,
        streams: [{ platform: "kick", channel: "x", displayName: "X" }],
      });
      expect(parsed.success).toBe(false);
    });

    it("rejects a non-URL avatarUrl", () => {
      const parsed = LiveStreamsSchema.safeParse({
        enabled: true,
        streams: [
          {
            platform: "twitch",
            channel: "x",
            displayName: "X",
            avatarUrl: "not a url",
          },
        ],
      });
      expect(parsed.success).toBe(false);
    });

    it("rejects non-https url schemes (no javascript:/http:)", () => {
      for (const url of ["javascript:alert(1)", "http://example.com"]) {
        const parsed = LiveStreamsSchema.safeParse({
          enabled: true,
          streams: [
            { platform: "twitch", channel: "x", displayName: "X", url },
          ],
        });
        expect(parsed.success).toBe(false);
      }
    });
  });

  describe("bundled fallback", () => {
    it("is valid and ships disabled/empty", () => {
      const cfg = LiveStreamsSchema.parse(liveStreamsFallback);
      expect(cfg.enabled).toBe(false);
      expect(cfg.streams).toEqual([]);
    });
  });
});
