import { describe, expect, it, vi } from "vitest";
import type { UserMeResponse } from "../../src/core/ApiSchemas";
import {
  clanExistsByTag,
  resolveClanTag,
} from "../../src/server/ClanTagOwnership";

const okResponse = (status: number): Response =>
  ({ status }) as unknown as Response;

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
  const deps = (fetcher: () => Promise<Response>) => ({
    baseUrl: "https://auth.example",
    fetcher: fetcher as unknown as typeof fetch,
  });

  it("returns true on HTTP 200", async () => {
    const result = await clanExistsByTag(
      "ABC",
      deps(async () => okResponse(200)),
    );
    expect(result).toBe(true);
  });

  it("returns false on HTTP 404", async () => {
    const result = await clanExistsByTag(
      "XYZ",
      deps(async () => okResponse(404)),
    );
    expect(result).toBe(false);
  });

  it("returns null on unexpected status (fail-closed)", async () => {
    const result = await clanExistsByTag(
      "ABC",
      deps(async () => okResponse(503)),
    );
    expect(result).toBeNull();
  });

  it("returns null on transport error (fail-closed)", async () => {
    const result = await clanExistsByTag(
      "ABC",
      deps(async () => {
        throw new Error("offline");
      }),
    );
    expect(result).toBeNull();
  });

  it("uppercases the tag in the request URL", async () => {
    const fetcher = vi.fn(async () => okResponse(200));
    await clanExistsByTag("abc", deps(fetcher));
    const calledUrl = (fetcher.mock.calls[0] as unknown[])[0] as string;
    expect(calledUrl).toContain("/public/clan/ABC/exists");
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
