import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getStreams } from "../../../src/client/Api";
import { ClientEnv } from "../../../src/client/ClientEnv";
import {
  cornerFromCenter,
  featuredStream,
  isOffFrame,
} from "../../../src/client/FeaturedStream";
import { StreamsFeed } from "../../../src/core/ApiSchemas";

const entry = {
  platform: "twitch" as const,
  channel: "openfrontmasters",
  displayName: "OFM",
  viewers: 100,
  url: "https://twitch.tv/openfrontmasters",
  startedAt: "2026-08-03T12:00:00Z",
};

const feed = (featured: (typeof entry)[]): StreamsFeed => ({
  verifiedAt: "2026-08-03T13:00:00Z",
  featured,
  live: [],
});

describe("FeaturedStream", () => {
  describe("featuredStream", () => {
    it("embeds nothing when the API lists no live channel", () => {
      // The API lists only channels its cron sees live, so an empty list means nobody
      // is live — the client must not load the Twitch SDK or a player at all.
      expect(featuredStream(feed([]), new Set())).toBeNull();
    });

    it("takes the first entry as the API's priority order", () => {
      const second = { ...entry, channel: "openfront" };
      expect(featuredStream(feed([entry, second]), new Set())?.channel).toBe(
        "openfrontmasters",
      );
    });

    // The bug: an offline-but-listed channel re-mounted a full Twitch player every 60s
    // forever, because goOffline() nulled the very state the dedupe guard depended on.
    // Suppression is now keyed on the broadcast itself, so it survives that reset.
    it("skips a broadcast already known dead", () => {
      const dead = new Set(["twitch:openfrontmasters:2026-08-03T12:00:00Z"]);
      expect(featuredStream(feed([entry]), dead)).toBeNull();
    });

    it("falls through to the next live channel when the first is dead", () => {
      const second = { ...entry, channel: "openfront" };
      const dead = new Set(["twitch:openfrontmasters:2026-08-03T12:00:00Z"]);
      expect(featuredStream(feed([entry, second]), dead)?.channel).toBe(
        "openfront",
      );
    });

    // A genuine restart has a new startedAt, so it is embeddable again.
    it("embeds the same channel again after it restarts", () => {
      const dead = new Set(["twitch:openfrontmasters:2026-08-03T12:00:00Z"]);
      const restarted = { ...entry, startedAt: "2026-08-03T18:00:00Z" };
      expect(featuredStream(feed([restarted]), dead)?.startedAt).toBe(
        "2026-08-03T18:00:00Z",
      );
    });
  });

  describe("getStreams", () => {
    const empty = {
      verifiedAt: "1970-01-01T00:00:00.000Z",
      featured: [],
      live: [],
    };

    beforeEach(() => {
      vi.unstubAllGlobals();
      vi.spyOn(console, "warn").mockImplementation(() => {});
      // getApiBase() → getAudience() reads the JWT audience from BOOTSTRAP_CONFIG
      // (ClientEnv), so getStreams needs it present or it throws before fetch and
      // silently falls back. The value is irrelevant here since fetch is stubbed.
      (window as any).BOOTSTRAP_CONFIG = {
        gameEnv: "prod",
        numWorkers: 1,
        turnstileSiteKey: "x",
        jwtAudience: "openfront.io",
        instanceId: "desktop",
        gitCommit: "test",
      };
      ClientEnv.reset();
    });
    afterEach(() => {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
      delete (window as any).BOOTSTRAP_CONFIG;
      ClientEnv.reset();
    });

    const stubFetch = (impl: () => unknown) =>
      vi.stubGlobal("fetch", vi.fn(impl));

    it("returns the served feed on HTTP 200 with valid JSON", async () => {
      stubFetch(() =>
        Promise.resolve({
          status: 200,
          json: async () => feed([entry]),
        }),
      );
      const served = await getStreams();
      expect(served.featured).toHaveLength(1);
      expect(served.featured[0].startedAt).toBe("2026-08-03T12:00:00Z");
    });

    // An API still serving the pre-cutover contract is healthy and returns 200, so this
    // is the case the old client could not detect. It must now be indistinguishable
    // from the API being down.
    it("falls back when the API serves the legacy {enabled, channels} payload", async () => {
      stubFetch(() =>
        Promise.resolve({
          status: 200,
          json: async () => ({
            enabled: true,
            channels: ["openfrontmasters"],
          }),
        }),
      );
      expect(await getStreams()).toEqual(empty);
    });

    it("falls back when an entry has no startedAt", async () => {
      stubFetch(() =>
        Promise.resolve({
          status: 200,
          json: async () => ({
            verifiedAt: "2026-08-03T13:00:00Z",
            featured: [{ ...entry, startedAt: undefined }],
            live: [],
          }),
        }),
      );
      expect(await getStreams()).toEqual(empty);
    });

    it("falls back to the bundled feed on a non-200 status", async () => {
      stubFetch(() => Promise.resolve({ status: 404, json: async () => ({}) }));
      expect(await getStreams()).toEqual(empty);
    });

    it("falls back when the request rejects (network error)", async () => {
      stubFetch(() => Promise.reject(new Error("network down")));
      expect(await getStreams()).toEqual(empty);
    });
  });

  describe("cornerFromCenter", () => {
    it("maps each quadrant to the nearest corner", () => {
      expect(cornerFromCenter(100, 100, 1000, 800)).toBe("tl");
      expect(cornerFromCenter(900, 100, 1000, 800)).toBe("tr");
      expect(cornerFromCenter(100, 700, 1000, 800)).toBe("bl");
      expect(cornerFromCenter(900, 700, 1000, 800)).toBe("br");
    });
  });

  describe("isOffFrame", () => {
    it("is false while the center is inside the viewport", () => {
      expect(isOffFrame(500, 400, 1000, 800)).toBe(false);
      expect(isOffFrame(0, 0, 1000, 800)).toBe(false);
      expect(isOffFrame(1000, 800, 1000, 800)).toBe(false);
    });

    it("is true once the center passes any edge (flick-to-dismiss)", () => {
      expect(isOffFrame(-1, 400, 1000, 800)).toBe(true); // left
      expect(isOffFrame(1001, 400, 1000, 800)).toBe(true); // right
      expect(isOffFrame(500, -1, 1000, 800)).toBe(true); // top
      expect(isOffFrame(500, 801, 1000, 800)).toBe(true); // bottom
    });
  });
});
