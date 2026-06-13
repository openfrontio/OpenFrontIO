import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/client/Api", () => ({
  getApiBase: vi.fn(() => "http://localhost:3000"),
  getUserMe: vi.fn(),
}));

vi.mock("../../../src/client/Auth", () => ({
  getAuthHeader: vi.fn(async () => "Bearer test-token"),
}));

import { getUserMe } from "../../../src/client/Api";
import {
  checkClanTagOwnership,
  fetchClanDetail,
  fetchClanExists,
  fetchClanGames,
  fetchClanLeaderboard,
  fetchClanMembers,
  fetchClanRequests,
  fetchClans,
} from "../../../src/client/ClanApi";
import type { UserMeResponse } from "../../../src/core/ApiSchemas";

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
        joinedAt: "2024-01-01T00:00:00.000Z",
        memberCount: 1,
      })),
    },
  }) as unknown as UserMeResponse;

const okJson = (data: unknown, status = 200) => ({
  ok: true,
  status,
  json: async () => data,
});

const failRes = (status: number, data: unknown = {}) => ({
  ok: false,
  status,
  json: async () => data,
});

const mockFetch = (impl: (...args: unknown[]) => unknown) =>
  vi.stubGlobal("fetch", vi.fn(impl));

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("fetchClanExists", () => {
  const status = (s: number) => ({ status: s });

  it("returns true on HTTP 200", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(status(200))),
    );
    await expect(fetchClanExists("ABC")).resolves.toBe(true);
  });

  it("returns false on HTTP 404", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(status(404))),
    );
    await expect(fetchClanExists("XYZ")).resolves.toBe(false);
  });

  it("returns null on unexpected status (5xx)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(status(503))),
    );
    await expect(fetchClanExists("ABC")).resolves.toBeNull();
  });

  it("returns null on transport error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("offline"))),
    );
    await expect(fetchClanExists("ABC")).resolves.toBeNull();
  });

  it("uppercases and URL-encodes the tag in the request URL", async () => {
    const fetchSpy = vi.fn(
      (_input: string | URL | Request, _init?: RequestInit) =>
        Promise.resolve(status(200)),
    );
    vi.stubGlobal("fetch", fetchSpy);
    await fetchClanExists("abc");
    expect(fetchSpy.mock.calls[0]![0] as string).toContain(
      "/public/clan/ABC/exists",
    );
    await fetchClanExists("a/b");
    expect(fetchSpy.mock.calls[1]![0] as string).toContain(
      "/public/clan/A%2FB/exists",
    );
  });
});

describe("checkClanTagOwnership", () => {
  const status = (s: number) => ({ status: s });

  it("accepts a tag the user is a member of without probing existence", async () => {
    vi.mocked(getUserMe).mockResolvedValue(userWithClans(["abc"]));
    const fetchSpy = vi.fn(() => Promise.resolve(status(200)));
    vi.stubGlobal("fetch", fetchSpy);
    await expect(checkClanTagOwnership("ABC")).resolves.toEqual({
      tag: "ABC",
      error: null,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("accepts a fictional tag (clan does not exist)", async () => {
    vi.mocked(getUserMe).mockResolvedValue(userWithClans(["other"]));
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(status(404))),
    );
    await expect(checkClanTagOwnership("ABC")).resolves.toEqual({
      tag: "ABC",
      error: null,
    });
  });

  it("rejects a real clan the user does not belong to", async () => {
    vi.mocked(getUserMe).mockResolvedValue(false);
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(status(200))),
    );
    await expect(checkClanTagOwnership("ABC")).resolves.toEqual({
      tag: null,
      error: "username.tag_not_member",
    });
  });

  it("fails open on an inconclusive existence check (API unavailable)", async () => {
    vi.mocked(getUserMe).mockResolvedValue(false);
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(status(503))),
    );
    await expect(checkClanTagOwnership("ABC")).resolves.toEqual({
      tag: "ABC",
      error: null,
    });
  });
});

describe("fetchClanLeaderboard", () => {
  const leaderboardData = {
    start: "2024-01-01T00:00:00.000Z",
    end: "2024-01-07T23:59:59.000Z",
    clans: [],
  };

  it("returns parsed data on success", async () => {
    mockFetch(() => okJson(leaderboardData));
    const result = await fetchClanLeaderboard();
    expect(result).toEqual(leaderboardData);
  });

  it("returns false on non-ok response", async () => {
    mockFetch(() => failRes(500));
    const result = await fetchClanLeaderboard();
    expect(result).toBe(false);
  });

  it("returns false on network error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("Network failure"))),
    );
    const result = await fetchClanLeaderboard();
    expect(result).toBe(false);
  });

  it("returns false when Zod validation fails", async () => {
    mockFetch(() => okJson({ start: "bad-date", end: "bad-date", clans: [] }));
    const result = await fetchClanLeaderboard();
    expect(result).toBe(false);
  });
});

describe("fetchClanDetail", () => {
  const clanInfo = {
    name: "Test Clan",
    tag: "TEST",
    description: "We test things",
    isOpen: false,
    createdAt: "2024-01-01T00:00:00.000Z",
    memberCount: 10,
  };

  it("returns parsed data on success", async () => {
    mockFetch(() => okJson(clanInfo));
    const result = await fetchClanDetail("TEST");
    expect(result).toEqual(clanInfo);
  });

  it("returns false on 404", async () => {
    mockFetch(() => failRes(404));
    const result = await fetchClanDetail("TEST");
    expect(result).toBe(false);
  });

  it("returns false on network error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("timeout"))),
    );
    const result = await fetchClanDetail("TEST");
    expect(result).toBe(false);
  });

  it("returns false when Zod validation fails", async () => {
    mockFetch(() => okJson({ tag: 123, name: null, isOpen: "not-a-boolean" }));
    const result = await fetchClanDetail("TEST");
    expect(result).toBe(false);
  });
});

describe("fetchClans", () => {
  const browseResponse = {
    results: [],
    total: 0,
    page: 1,
    limit: 20,
  };

  it("passes page and limit as query params", async () => {
    const fetchSpy = vi.fn(
      (_input: string | URL | Request, _init?: RequestInit) =>
        Promise.resolve(okJson(browseResponse)),
    );
    vi.stubGlobal("fetch", fetchSpy);

    await fetchClans(undefined, 3, 10);

    const calledUrl = fetchSpy.mock.calls[0]![0] as string;
    const url = new URL(calledUrl);
    expect(url.searchParams.get("page")).toBe("3");
    expect(url.searchParams.get("limit")).toBe("10");
  });

  it("passes search param when provided and long enough", async () => {
    const fetchSpy = vi.fn(
      (_input: string | URL | Request, _init?: RequestInit) =>
        Promise.resolve(okJson(browseResponse)),
    );
    vi.stubGlobal("fetch", fetchSpy);

    await fetchClans("abc", 1, 20);

    const calledUrl = fetchSpy.mock.calls[0]![0] as string;
    const url = new URL(calledUrl);
    expect(url.searchParams.get("search")).toBe("abc");
  });

  it("omits search param when too short and non-alphanumeric", async () => {
    const fetchSpy = vi.fn(
      (_input: string | URL | Request, _init?: RequestInit) =>
        Promise.resolve(okJson(browseResponse)),
    );
    vi.stubGlobal("fetch", fetchSpy);

    await fetchClans("a", 1, 20);

    const calledUrl = fetchSpy.mock.calls[0]![0] as string;
    const url = new URL(calledUrl);
    expect(url.searchParams.has("search")).toBe(false);
  });

  it("returns false on failure", async () => {
    mockFetch(() => failRes(500));
    const result = await fetchClans();
    expect(result).toBe(false);
  });

  it("returns false when Zod validation fails", async () => {
    mockFetch(() => okJson({ results: "not-an-array", total: "bad" }));
    const result = await fetchClans();
    expect(result).toBe(false);
  });

  it("returns false on network error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("offline"))),
    );
    const result = await fetchClans();
    expect(result).toBe(false);
  });
});

describe("fetchClanMembers", () => {
  const membersResponse = {
    results: [
      {
        publicId: "abc123",
        role: "leader",
        joinedAt: "2024-01-01T00:00:00.000Z",
      },
    ],
    total: 1,
    page: 1,
    limit: 20,
  };

  it("returns parsed data on success", async () => {
    mockFetch(() => okJson(membersResponse));
    const result = await fetchClanMembers("TEST");
    expect(result).toEqual(membersResponse);
  });

  it("passes page and limit as query params", async () => {
    const fetchSpy = vi.fn(
      (_input: string | URL | Request, _init?: RequestInit) =>
        Promise.resolve(okJson(membersResponse)),
    );
    vi.stubGlobal("fetch", fetchSpy);

    await fetchClanMembers("TEST", 3, 50);

    const calledUrl = fetchSpy.mock.calls[0]![0] as string;
    const url = new URL(calledUrl);
    expect(url.searchParams.get("page")).toBe("3");
    expect(url.searchParams.get("limit")).toBe("50");
  });

  it("includes the optional pendingRequests field", async () => {
    mockFetch(() => okJson({ ...membersResponse, pendingRequests: 5 }));
    const result = await fetchClanMembers("TEST");
    expect(result).not.toBe(false);
    if (result) expect(result.pendingRequests).toBe(5);
  });

  it("returns false on non-ok response", async () => {
    mockFetch(() => failRes(500));
    const result = await fetchClanMembers("TEST");
    expect(result).toBe(false);
  });

  it("returns false when Zod validation fails", async () => {
    mockFetch(() => okJson({ results: "not-array", total: "bad" }));
    const result = await fetchClanMembers("TEST");
    expect(result).toBe(false);
  });

  it("returns false on network error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("offline"))),
    );
    const result = await fetchClanMembers("TEST");
    expect(result).toBe(false);
  });

  it("sends Authorization header", async () => {
    const fetchSpy = vi.fn(
      (_input: string | URL | Request, _init?: RequestInit) =>
        Promise.resolve(okJson(membersResponse)),
    );
    vi.stubGlobal("fetch", fetchSpy);

    await fetchClanMembers("TEST");

    const headers = fetchSpy.mock.calls[0]![1]?.headers as Record<
      string,
      string
    >;
    expect(headers.Authorization).toBe("Bearer test-token");
  });
});

describe("fetchClanRequests", () => {
  const requestsResponse = {
    results: [
      {
        publicId: "player1",
        createdAt: "2024-06-01T00:00:00.000Z",
      },
    ],
    total: 1,
    page: 1,
    limit: 20,
  };

  it("returns parsed data on success", async () => {
    mockFetch(() => okJson(requestsResponse));
    const result = await fetchClanRequests("TEST");
    expect(result).toEqual(requestsResponse);
  });

  it("passes page and limit as query params", async () => {
    const fetchSpy = vi.fn(
      (_input: string | URL | Request, _init?: RequestInit) =>
        Promise.resolve(okJson(requestsResponse)),
    );
    vi.stubGlobal("fetch", fetchSpy);

    await fetchClanRequests("TEST", 2, 10);

    const calledUrl = fetchSpy.mock.calls[0]![0] as string;
    const url = new URL(calledUrl);
    expect(url.searchParams.get("page")).toBe("2");
    expect(url.searchParams.get("limit")).toBe("10");
  });

  it("returns false on non-ok response", async () => {
    mockFetch(() => failRes(403));
    const result = await fetchClanRequests("TEST");
    expect(result).toBe(false);
  });

  it("returns false when Zod validation fails", async () => {
    mockFetch(() => okJson({ results: 42, total: "bad" }));
    const result = await fetchClanRequests("TEST");
    expect(result).toBe(false);
  });

  it("returns false on network error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("offline"))),
    );
    const result = await fetchClanRequests("TEST");
    expect(result).toBe(false);
  });

  it("sends Authorization header", async () => {
    const fetchSpy = vi.fn(
      (_input: string | URL | Request, _init?: RequestInit) =>
        Promise.resolve(okJson(requestsResponse)),
    );
    vi.stubGlobal("fetch", fetchSpy);

    await fetchClanRequests("TEST");

    const headers = fetchSpy.mock.calls[0]![1]?.headers as Record<
      string,
      string
    >;
    expect(headers.Authorization).toBe("Bearer test-token");
  });
});

describe("fetchClanGames", () => {
  const gamesResponse = {
    results: [
      {
        gameId: "g1",
        start: "2024-06-01T00:00:00.000Z",
        durationSeconds: 1234,
        map: "World",
        mode: "Team",
        playerTeams: "Duos",
        result: "victory",
        totalPlayers: 8,
        clanPlayers: [{ publicId: "p1", username: "alice", won: true }],
      },
    ],
    nextCursor: "opaque-cursor-abc123",
  };

  it("returns parsed data on success", async () => {
    mockFetch(() => okJson(gamesResponse));
    const result = await fetchClanGames("TEST");
    expect(result).toEqual(gamesResponse);
  });

  it("accepts a null nextCursor (no more pages)", async () => {
    mockFetch(() => okJson({ ...gamesResponse, nextCursor: null }));
    const result = await fetchClanGames("TEST");
    expect("error" in result).toBe(false);
    if (!("error" in result)) expect(result.nextCursor).toBeNull();
  });

  it("omits filter and cursor query params when not provided", async () => {
    const fetchSpy = vi.fn(
      (_input: string | URL | Request, _init?: RequestInit) =>
        Promise.resolve(okJson(gamesResponse)),
    );
    vi.stubGlobal("fetch", fetchSpy);

    await fetchClanGames("TEST");

    const calledUrl = fetchSpy.mock.calls[0]![0] as string;
    const url = new URL(calledUrl);
    expect(url.searchParams.has("filter")).toBe(false);
    expect(url.searchParams.has("cursor")).toBe(false);
    expect(url.pathname).toBe("/clans/TEST/games");
  });

  it("passes filter and cursor as query params", async () => {
    const fetchSpy = vi.fn(
      (_input: string | URL | Request, _init?: RequestInit) =>
        Promise.resolve(okJson(gamesResponse)),
    );
    vi.stubGlobal("fetch", fetchSpy);

    await fetchClanGames("TEST", {
      filter: "team",
      cursor: "opaque-cursor-abc123",
    });

    const calledUrl = fetchSpy.mock.calls[0]![0] as string;
    const url = new URL(calledUrl);
    expect(url.searchParams.get("filter")).toBe("team");
    expect(url.searchParams.get("cursor")).toBe("opaque-cursor-abc123");
  });

  it("URL-encodes the clan tag", async () => {
    const fetchSpy = vi.fn(
      (_input: string | URL | Request, _init?: RequestInit) =>
        Promise.resolve(okJson(gamesResponse)),
    );
    vi.stubGlobal("fetch", fetchSpy);

    await fetchClanGames("A/B");

    const calledUrl = fetchSpy.mock.calls[0]![0] as string;
    // encodeURIComponent('/') === '%2F'
    expect(calledUrl).toContain("/clans/A%2FB/games");
  });

  it("returns { error: 'forbidden' } on 403", async () => {
    mockFetch(() => failRes(403));
    const result = await fetchClanGames("TEST");
    expect(result).toEqual({ error: "forbidden" });
  });

  it("returns { error: 'failed' } on other non-ok responses", async () => {
    mockFetch(() => failRes(500));
    const result = await fetchClanGames("TEST");
    expect(result).toEqual({ error: "failed" });
  });

  it("returns { error: 'failed' } when Zod validation fails", async () => {
    mockFetch(() => okJson({ results: "not-an-array", nextCursor: 42 }));
    const result = await fetchClanGames("TEST");
    expect(result).toEqual({ error: "failed" });
  });

  it("returns { error: 'failed' } on network error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("offline"))),
    );
    const result = await fetchClanGames("TEST");
    expect(result).toEqual({ error: "failed" });
  });

  it("sends Authorization header", async () => {
    const fetchSpy = vi.fn(
      (_input: string | URL | Request, _init?: RequestInit) =>
        Promise.resolve(okJson(gamesResponse)),
    );
    vi.stubGlobal("fetch", fetchSpy);

    await fetchClanGames("TEST");

    const headers = fetchSpy.mock.calls[0]![1]?.headers as Record<
      string,
      string
    >;
    expect(headers.Authorization).toBe("Bearer test-token");
  });
});
