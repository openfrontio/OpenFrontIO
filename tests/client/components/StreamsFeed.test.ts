import { describe, expect, it } from "vitest";
import streamsFallback from "../../../resources/streams.json";
import { StreamsFeedSchema } from "../../../src/core/ApiSchemas";

const entry = {
  platform: "twitch",
  channel: "openfrontmasters",
  displayName: "OFM",
  viewers: 100,
  url: "https://twitch.tv/openfrontmasters",
  startedAt: "2026-08-03T12:00:00Z",
};

describe("StreamsFeedSchema", () => {
  it("parses a verified feed", () => {
    const feed = StreamsFeedSchema.parse({
      verifiedAt: "2026-08-03T13:00:00Z",
      featured: [entry],
      live: [],
    });
    expect(feed.featured[0].startedAt).toBe("2026-08-03T12:00:00Z");
  });

  it("defaults both lists to empty", () => {
    const feed = StreamsFeedSchema.parse({
      verifiedAt: "2026-08-03T13:00:00Z",
    });
    expect(feed.featured).toEqual([]);
    expect(feed.live).toEqual([]);
  });

  // The bug this whole change exists to prevent. The old payload was a bare channel
  // list that could not express liveness, so a client could not tell a stale API from a
  // current one and embedded an offline channel on its word. It must now fail to parse,
  // which routes it to the bundled fallback and shows nothing.
  it("rejects the legacy {enabled, channels} payload", () => {
    const parsed = StreamsFeedSchema.safeParse({
      enabled: true,
      channels: ["openfrontmasters"],
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects an entry with no startedAt (no proof of liveness)", () => {
    const noProof = { ...entry, startedAt: undefined };
    const parsed = StreamsFeedSchema.safeParse({
      verifiedAt: "2026-08-03T13:00:00Z",
      featured: [noProof],
      live: [],
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a non-ISO startedAt", () => {
    const parsed = StreamsFeedSchema.safeParse({
      verifiedAt: "2026-08-03T13:00:00Z",
      featured: [{ ...entry, startedAt: "yesterday" }],
      live: [],
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a feed with no verifiedAt", () => {
    const parsed = StreamsFeedSchema.safeParse({ featured: [], live: [] });
    expect(parsed.success).toBe(false);
  });

  it("rejects a non-https url (no javascript:/http:)", () => {
    for (const url of ["javascript:alert(1)", "http://example.com"]) {
      const parsed = StreamsFeedSchema.safeParse({
        verifiedAt: "2026-08-03T13:00:00Z",
        featured: [{ ...entry, url }],
        live: [],
      });
      expect(parsed.success).toBe(false);
    }
  });

  it("rejects channels with URL delimiters or whitespace", () => {
    for (const channel of ["foo/bar", "x?y=1", "a b", "x#frag", ""]) {
      const parsed = StreamsFeedSchema.safeParse({
        verifiedAt: "2026-08-03T13:00:00Z",
        featured: [{ ...entry, channel }],
        live: [],
      });
      expect(parsed.success).toBe(false);
    }
  });
});

describe("bundled fallback (resources/streams.json)", () => {
  it("is valid and ships empty", () => {
    const feed = StreamsFeedSchema.parse(streamsFallback);
    expect(feed.featured).toEqual([]);
    expect(feed.live).toEqual([]);
  });
});
