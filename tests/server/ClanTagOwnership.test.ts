import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UserMeResponse } from "../../src/core/ApiSchemas";
import {
  clanExistsByTag,
  resolveClanTag,
} from "../../src/server/ClanTagOwnership";

const okResponse = (status: number, body = ""): Response =>
  ({
    status,
    text: async () => body,
  }) as unknown as Response;

const userWithClans = (tags: string[]): UserMeResponse =>
  ({
    user: {},
    player: {
      publicId: "p1",
      adfree: false,
      flares: [],
      achievements: { singleplayerMap: [] },
      friends: [],
      subscription: null,
      clans: tags.map((tag) => ({
        tag,
        name: tag,
        role: "member" as const,
        joinedAt: new Date().toISOString(),
        memberCount: 1,
      })),
    },
  }) as UserMeResponse;

describe("clanExistsByTag", () => {
  let cache: Map<string, { expiresAt: number }>;
  let now: number;

  beforeEach(() => {
    cache = new Map();
    now = 1_000_000;
  });

  it("returns true on HTTP 200", async () => {
    const fetcher = vi.fn(async () => okResponse(200));
    const result = await clanExistsByTag("ABC", {
      baseUrl: "https://auth.example",
      fetcher: fetcher as unknown as typeof fetch,
      cache,
      now: () => now,
    });
    expect(result).toBe(true);
  });

  it("returns false on HTTP 404 without caching it", async () => {
    const fetcher = vi.fn(async () => okResponse(404));
    const result = await clanExistsByTag("XYZ", {
      baseUrl: "https://auth.example",
      fetcher: fetcher as unknown as typeof fetch,
      cache,
      now: () => now,
    });
    expect(result).toBe(false);
    // Negative results must not poison the cache — a clan can be created
    // moments after a 404 and a stale "false" would briefly let non-members
    // wear the tag.
    expect(cache.size).toBe(0);
  });

  it("returns null on unexpected status (fail-closed) and does not cache", async () => {
    const fetcher = vi.fn(async () => okResponse(503));
    const result = await clanExistsByTag("ABC", {
      baseUrl: "https://auth.example",
      fetcher: fetcher as unknown as typeof fetch,
      cache,
      now: () => now,
    });
    expect(result).toBeNull();
    expect(cache.size).toBe(0);
  });

  it("returns null on transport error (fail-closed)", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error("offline");
    });
    const result = await clanExistsByTag("ABC", {
      baseUrl: "https://auth.example",
      fetcher: fetcher as unknown as typeof fetch,
      cache,
      now: () => now,
    });
    expect(result).toBeNull();
  });

  it("uppercases the tag in the request URL", async () => {
    const fetcher = vi.fn(async () => okResponse(200));
    await clanExistsByTag("abc", {
      baseUrl: "https://auth.example",
      fetcher: fetcher as unknown as typeof fetch,
      cache,
      now: () => now,
    });
    const calledUrl = (fetcher.mock.calls[0] as unknown[])[0] as string;
    expect(calledUrl).toContain("/public/clan/ABC/exists");
  });

  it("serves positive results from cache without re-fetching", async () => {
    const fetcher = vi.fn(async () => okResponse(200));
    await clanExistsByTag("ABC", {
      baseUrl: "https://auth.example",
      fetcher: fetcher as unknown as typeof fetch,
      cache,
      now: () => now,
    });
    await clanExistsByTag("ABC", {
      baseUrl: "https://auth.example",
      fetcher: fetcher as unknown as typeof fetch,
      cache,
      now: () => now,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("re-fetches positive entries after TTL expiry", async () => {
    const fetcher = vi.fn(async () => okResponse(200));
    await clanExistsByTag("ABC", {
      baseUrl: "https://auth.example",
      fetcher: fetcher as unknown as typeof fetch,
      cache,
      now: () => now,
      ttlMs: 1000,
    });
    now += 2000;
    await clanExistsByTag("ABC", {
      baseUrl: "https://auth.example",
      fetcher: fetcher as unknown as typeof fetch,
      cache,
      now: () => now,
      ttlMs: 1000,
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("evicts the oldest entry when maxEntries is exceeded", async () => {
    const fetcher = vi.fn(async () => okResponse(200));
    const deps = {
      baseUrl: "https://auth.example",
      fetcher: fetcher as unknown as typeof fetch,
      cache,
      now: () => now,
      maxEntries: 2,
    };
    await clanExistsByTag("A", deps);
    await clanExistsByTag("B", deps);
    await clanExistsByTag("C", deps);
    expect(cache.size).toBe(2);
    expect(cache.has("A")).toBe(false);
    expect(cache.has("B")).toBe(true);
    expect(cache.has("C")).toBe(true);
  });

  it("treats body {exists:false} as false on 200 without caching", async () => {
    const fetcher = vi.fn(async () =>
      okResponse(200, JSON.stringify({ exists: false })),
    );
    const result = await clanExistsByTag("ABC", {
      baseUrl: "https://auth.example",
      fetcher: fetcher as unknown as typeof fetch,
      cache,
      now: () => now,
    });
    expect(result).toBe(false);
    expect(cache.size).toBe(0);
  });
});

describe("resolveClanTag", () => {
  it("passes a null tag through unchanged", async () => {
    const probe = vi.fn();
    const result = await resolveClanTag(null, null, probe);
    expect(result).toEqual({ tag: null, dropped: false });
    expect(probe).not.toHaveBeenCalled();
  });

  it("accepts a tag when the user is a member (case-insensitive)", async () => {
    const probe = vi.fn();
    const me = userWithClans(["abc"]);
    const result = await resolveClanTag("ABC", me, probe);
    expect(result).toEqual({ tag: "ABC", dropped: false });
    expect(probe).not.toHaveBeenCalled();
  });

  it("drops a tag belonging to a real clan the user does not belong to", async () => {
    const probe = vi.fn(async () => true);
    const me = userWithClans(["other"]);
    const result = await resolveClanTag("ABC", me, probe);
    expect(result).toEqual({ tag: null, dropped: true, reason: "exists" });
  });

  it("keeps a tag that does not match any real clan (fictional)", async () => {
    const probe = vi.fn(async () => false);
    const result = await resolveClanTag("ABC", null, probe);
    expect(result).toEqual({ tag: "ABC", dropped: false });
  });

  it("drops the tag on inconclusive existence check (fail-closed)", async () => {
    const probe = vi.fn(async () => null);
    const result = await resolveClanTag("ABC", null, probe);
    expect(result).toEqual({
      tag: null,
      dropped: true,
      reason: "inconclusive",
    });
  });

  it("treats anonymous users as members of no clans", async () => {
    const probe = vi.fn(async () => true);
    const result = await resolveClanTag("ABC", null, probe);
    expect(result.tag).toBeNull();
    expect(result.dropped).toBe(true);
    expect(probe).toHaveBeenCalledWith("ABC");
  });
});
