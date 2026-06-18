import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import featuredStream from "../../../resources/featured-stream.json";
import { getFeaturedStream } from "../../../src/client/Api";
import { cornerFromCenter } from "../../../src/client/FeaturedStream";
import { FeaturedStreamSchema } from "../../../src/core/ApiSchemas";

describe("FeaturedStream", () => {
  describe("bundled config (resources/featured-stream.json)", () => {
    it("validates against the schema", () => {
      expect(FeaturedStreamSchema.safeParse(featuredStream).success).toBe(true);
    });

    it("is off by default (no channel shown unless OF turns it on)", () => {
      const cfg = FeaturedStreamSchema.parse(featuredStream);
      expect(cfg.enabled).toBe(false);
      expect(cfg.channels).toEqual([]);
    });
  });

  describe("FeaturedStreamSchema", () => {
    it("defaults to disabled with no channels", () => {
      const cfg = FeaturedStreamSchema.parse({});
      expect(cfg.enabled).toBe(false);
      expect(cfg.channels).toEqual([]);
    });

    it("accepts enabled with a channel list", () => {
      const cfg = FeaturedStreamSchema.parse({
        enabled: true,
        channels: ["openfrontmasters", "openfront"],
      });
      expect(cfg.enabled).toBe(true);
      expect(cfg.channels).toEqual(["openfrontmasters", "openfront"]);
    });

    it("rejects a non-string channel", () => {
      expect(FeaturedStreamSchema.safeParse({ channels: [1] }).success).toBe(
        false,
      );
    });

    it("rejects a malformed channel login (so a typo fails the config closed)", () => {
      // too short, illegal chars, and a full URL must all be rejected
      for (const bad of ["ab", "has space", "bad!", "https://twitch.tv/x"]) {
        expect(
          FeaturedStreamSchema.safeParse({ channels: [bad] }).success,
        ).toBe(false);
      }
    });

    it("accepts a valid channel login", () => {
      expect(
        FeaturedStreamSchema.safeParse({ channels: ["eslcs", "es_l_2"] })
          .success,
      ).toBe(true);
    });
  });

  describe("getFeaturedStream", () => {
    const off = { enabled: false, channels: [] };

    beforeEach(() => {
      vi.unstubAllGlobals();
      vi.spyOn(console, "warn").mockImplementation(() => {});
    });
    afterEach(() => {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    });

    const stubFetch = (impl: () => unknown) =>
      vi.stubGlobal("fetch", vi.fn(impl));

    it("returns the served config on HTTP 200 with valid JSON", async () => {
      stubFetch(() =>
        Promise.resolve({
          status: 200,
          json: async () => ({ enabled: true, channels: ["eslcs"] }),
        }),
      );
      const cfg = await getFeaturedStream();
      expect(cfg).toEqual({ enabled: true, channels: ["eslcs"] });
    });

    it("falls back to the bundled config on a non-200 status", async () => {
      stubFetch(() => Promise.resolve({ status: 404, json: async () => ({}) }));
      expect(await getFeaturedStream()).toEqual(off);
    });

    it("falls back when the served JSON fails validation (bad channel)", async () => {
      stubFetch(() =>
        Promise.resolve({
          status: 200,
          json: async () => ({ enabled: true, channels: ["bad name!"] }),
        }),
      );
      expect(await getFeaturedStream()).toEqual(off);
    });

    it("falls back when the request rejects (network error)", async () => {
      stubFetch(() => Promise.reject(new Error("network down")));
      expect(await getFeaturedStream()).toEqual(off);
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
});
