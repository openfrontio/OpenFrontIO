import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/client/Api", () => ({
  getApiBase: vi.fn(() => "http://localhost:3000"),
}));

vi.mock("../../../src/client/Auth", () => ({
  getAuthHeader: vi.fn(async () => "Bearer test-token"),
}));

import {
  fetchClanDetail,
  fetchClanLeaderboard,
  fetchClanMembers,
  fetchClanRequests,
  fetchClans,
  fetchClanStats,
} from "../../../src/client/ClanApi";

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

describe("fetchClanStats", () => {
  const clanStats = {
    clanTag: "TEST",
    games: 20,
    wins: 15,
    losses: 5,
    stats: {
      total: { wins: 15, losses: 5 },
      ffa: { wins: 7, losses: 3 },
      team: { wins: 4, losses: 1 },
      hvn: { wins: 1, losses: 0 },
      duos: { wins: 2, losses: 0 },
      trios: { wins: 1, losses: 1 },
      quads: { wins: 1, losses: 0 },
      "2": { wins: 2, losses: 0 },
      "3": { wins: 1, losses: 1 },
      "4": { wins: 1, losses: 0 },
      "5": { wins: 0, losses: 0 },
      "6": { wins: 0, losses: 0 },
      "7": { wins: 0, losses: 0 },
      ranked: { wins: 3, losses: 1 },
      "1v1": { wins: 3, losses: 1 },
    },
    teamTypeWL: { ffa: { wl: [15, 5] } },
    teamCountWL: { "2": { wl: [10, 3] } },
  };

  it("returns parsed data from json.clan on success", async () => {
    mockFetch(() => okJson({ clan: clanStats }));
    const result = await fetchClanStats("TEST");
    expect(result).toEqual(clanStats);
  });

  it("returns false when json.clan is missing", async () => {
    mockFetch(() => okJson({}));
    const result = await fetchClanStats("TEST");
    expect(result).toBe(false);
  });

  it("returns false on non-ok response", async () => {
    mockFetch(() => failRes(404));
    const result = await fetchClanStats("TEST");
    expect(result).toBe(false);
  });

  it("returns false on network error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("offline"))),
    );
    const result = await fetchClanStats("TEST");
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
