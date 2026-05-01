import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/client/Api", () => ({
  getApiBase: vi.fn(() => "http://localhost:3000"),
}));

vi.mock("../../../src/client/Auth", () => ({
  getAuthHeader: vi.fn(async () => "Bearer test-token"),
}));

import {
  banClanMember,
  fetchClanBans,
  unbanClanMember,
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

describe("banClanMember", () => {
  it("returns true on 204 success", async () => {
    mockFetch(() => ({ ok: true, status: 204, json: async () => ({}) }));
    const result = await banClanMember("TEST", "player-1");
    expect(result).toBe(true);
  });

  it("sends reason in request body when provided", async () => {
    const fetchSpy = vi.fn(
      (_input: string | URL | Request, _init?: RequestInit) =>
        Promise.resolve({ ok: true, status: 204, json: async () => ({}) }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    await banClanMember("TEST", "player-1", "spamming");

    const body = JSON.parse(fetchSpy.mock.calls[0]![1]?.body as string);
    expect(body).toEqual({ targetPublicId: "player-1", reason: "spamming" });
  });

  it("omits reason from request body when not provided", async () => {
    const fetchSpy = vi.fn(
      (_input: string | URL | Request, _init?: RequestInit) =>
        Promise.resolve({ ok: true, status: 204, json: async () => ({}) }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    await banClanMember("TEST", "player-1");

    const body = JSON.parse(fetchSpy.mock.calls[0]![1]?.body as string);
    expect(body).toEqual({ targetPublicId: "player-1" });
    expect(body).not.toHaveProperty("reason");
  });

  it("returns error object on failure", async () => {
    mockFetch(() => failRes(403, { message: "insufficient permissions" }));
    const result = await banClanMember("TEST", "player-1");
    expect(result).toEqual({ error: "clan_modal.error_failed" });
  });

  it("returns network error on fetch failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("offline"))),
    );
    const result = await banClanMember("TEST", "player-1");
    expect(result).toEqual({ error: "clan_modal.error_network" });
  });
});

describe("unbanClanMember", () => {
  it("returns true on success", async () => {
    mockFetch(() => ({ ok: true, status: 204, json: async () => ({}) }));
    const result = await unbanClanMember("TEST", "player-1");
    expect(result).toBe(true);
  });

  it("returns error object on failure", async () => {
    mockFetch(() => failRes(409, { message: "Player not currently banned" }));
    const result = await unbanClanMember("TEST", "player-1");
    expect(result).toEqual({ error: "clan_modal.error_failed" });
  });

  it("returns network error on fetch failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("offline"))),
    );
    const result = await unbanClanMember("TEST", "player-1");
    expect(result).toEqual({ error: "clan_modal.error_network" });
  });
});

describe("fetchClanBans", () => {
  const bansResponse = {
    results: [
      {
        publicId: "banned-1",
        bannedBy: "officer-1",
        reason: "toxic",
        createdAt: "2024-06-01T00:00:00.000Z",
      },
    ],
    total: 1,
    page: 1,
    limit: 20,
  };

  it("returns parsed data on success", async () => {
    mockFetch(() => okJson(bansResponse));
    const result = await fetchClanBans("TEST");
    expect(result).toEqual(bansResponse);
  });

  it("passes page and limit as query params", async () => {
    const fetchSpy = vi.fn(
      (_input: string | URL | Request, _init?: RequestInit) =>
        Promise.resolve(okJson(bansResponse)),
    );
    vi.stubGlobal("fetch", fetchSpy);

    await fetchClanBans("TEST", 2, 10);

    const calledUrl = fetchSpy.mock.calls[0]![0] as string;
    const url = new URL(calledUrl);
    expect(url.searchParams.get("page")).toBe("2");
    expect(url.searchParams.get("limit")).toBe("10");
  });

  it("returns false on non-ok response", async () => {
    mockFetch(() => failRes(403));
    const result = await fetchClanBans("TEST");
    expect(result).toBe(false);
  });

  it("returns false when Zod validation fails", async () => {
    mockFetch(() => okJson({ results: "not-an-array", total: 0 }));
    const result = await fetchClanBans("TEST");
    expect(result).toBe(false);
  });

  it("returns false on network error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("offline"))),
    );
    const result = await fetchClanBans("TEST");
    expect(result).toBe(false);
  });
});
