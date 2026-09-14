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
  fetchClanDonations,
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
      unlimitedRanked: false,
      canCreatePublicLobbies: false,
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

  it("passes through the clan balances as bigint strings", async () => {
    mockFetch(() =>
      okJson({
        ...clanInfo,
        softBalance: "9007199254740993",
        hardBalance: "0",
      }),
    );
    const result = await fetchClanDetail("TEST");
    expect(result).not.toBe(false);
    if (result !== false) {
      // Exact, not rounded: a Number round-trip would lose the trailing 3.
      expect(result.softBalance).toBe("9007199254740993");
      expect(result.hardBalance).toBe("0");
    }
  });

  it("parses a response with no balances (older API)", async () => {
    mockFetch(() => okJson(clanInfo));
    const result = await fetchClanDetail("TEST");
    expect(result).not.toBe(false);
    if (result !== false) {
      expect(result.softBalance).toBeUndefined();
      expect(result.hardBalance).toBeUndefined();
    }
  });

  it("returns false when a balance arrives as a number", async () => {
    mockFetch(() => okJson({ ...clanInfo, softBalance: 1000 }));
    expect(await fetchClanDetail("TEST")).toBe(false);
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

  it("passes a trimmed member search with pagination and sorting", async () => {
    const fetchSpy = vi.fn(
      (_input: string | URL | Request, _init?: RequestInit) =>
        Promise.resolve(okJson(membersResponse)),
    );
    vi.stubGlobal("fetch", fetchSpy);

    await fetchClanMembers("TEST", 3, 50, "winsTotal", "desc", "  d3G1QO8Z  ");

    const calledUrl = fetchSpy.mock.calls[0]![0] as string;
    const url = new URL(calledUrl);
    expect(url.searchParams.get("page")).toBe("3");
    expect(url.searchParams.get("limit")).toBe("50");
    expect(url.searchParams.get("sort")).toBe("winsTotal");
    expect(url.searchParams.get("order")).toBe("desc");
    expect(url.searchParams.get("search")).toBe("d3G1QO8Z");
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

describe("fetchClanDonations", () => {
  const donationsResponse = {
    results: [
      {
        id: "1834",
        currencyType: "soft",
        amount: "500",
        reason: "clan_donation",
        note: null,
        createdBy: "Xk3pQ9",
        createdByUsername: "evan.0042",
        createdAt: "2026-08-26T02:10:31.512Z",
      },
    ],
    total: 27,
    page: 1,
    limit: 10,
  };

  const spyFetch = () => {
    const fetchSpy = vi.fn(
      (_input: string | URL | Request, _init?: RequestInit) =>
        Promise.resolve(okJson(donationsResponse)),
    );
    vi.stubGlobal("fetch", fetchSpy);
    return fetchSpy;
  };

  it("returns parsed data on success", async () => {
    mockFetch(() => okJson(donationsResponse));
    const result = await fetchClanDonations("TEST");
    expect(result).toEqual(donationsResponse);
  });

  it("sends page and limit defaults and omits currencyType when unset", async () => {
    const fetchSpy = spyFetch();
    await fetchClanDonations("TEST");
    const url = new URL(fetchSpy.mock.calls[0]![0] as string);
    expect(url.pathname).toBe("/clans/TEST/donations");
    expect(url.searchParams.get("page")).toBe("1");
    expect(url.searchParams.get("limit")).toBe("10");
    // The endpoint 400s on an empty value, so the key must be absent.
    expect(url.searchParams.has("currencyType")).toBe(false);
  });

  it("forwards page, limit and currencyType when provided", async () => {
    const fetchSpy = spyFetch();
    await fetchClanDonations("TEST", {
      page: 3,
      limit: 25,
      currencyType: "hard",
    });
    const url = new URL(fetchSpy.mock.calls[0]![0] as string);
    expect(url.searchParams.get("page")).toBe("3");
    expect(url.searchParams.get("limit")).toBe("25");
    expect(url.searchParams.get("currencyType")).toBe("hard");
  });

  it("URL-encodes the tag", async () => {
    const fetchSpy = spyFetch();
    await fetchClanDonations("a/b");
    expect(fetchSpy.mock.calls[0]![0] as string).toContain(
      "/clans/a%2Fb/donations?",
    );
  });

  it("returns forbidden on HTTP 403", async () => {
    mockFetch(() => failRes(403));
    await expect(fetchClanDonations("TEST")).resolves.toEqual({
      error: "forbidden",
    });
  });

  it("returns failed on other non-OK statuses", async () => {
    mockFetch(() => failRes(500));
    await expect(fetchClanDonations("TEST")).resolves.toEqual({
      error: "failed",
    });
  });

  it("returns failed on a transport error", async () => {
    mockFetch(() => Promise.reject(new Error("offline")));
    await expect(fetchClanDonations("TEST")).resolves.toEqual({
      error: "failed",
    });
  });

  it("returns failed when the body does not match the schema", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // amount must be a string (bigint on the wire), not a number.
    mockFetch(() =>
      okJson({
        ...donationsResponse,
        results: [{ ...donationsResponse.results[0], amount: 500 }],
      }),
    );
    await expect(fetchClanDonations("TEST")).resolves.toEqual({
      error: "failed",
    });
    warn.mockRestore();
  });
});
