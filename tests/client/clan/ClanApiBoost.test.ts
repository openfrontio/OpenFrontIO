import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/client/Api", () => ({
  getApiBase: vi.fn(() => "http://localhost:3000"),
  getUserMe: vi.fn(),
}));

vi.mock("../../../src/client/Auth", () => ({
  getAuthHeader: vi.fn(async () => "Bearer test-token"),
}));

import {
  buyClanBoost,
  fetchClanBoostStatus,
  joinClan,
} from "../../../src/client/ClanApi";

const res = (status: number, data: unknown = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => data,
});

const mockFetch = (impl: (...args: unknown[]) => unknown) => {
  const fn = vi.fn(impl);
  vi.stubGlobal("fetch", fn);
  return fn;
};

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const STATUS = {
  tiers: [
    {
      tier: "spark",
      currency: "soft",
      price: "250",
      durationMs: 3_600_000,
      weight: 1,
    },
  ],
  boostEndsAt: null,
  eligibility: {
    eligible: true,
    memberCount: 3,
    minMembers: 3,
    recentlyActive: true,
  },
  softLimit: { usedMs: 0, capMs: 43_200_000, windowMs: 86_400_000 },
  softBalance: "1000",
  hardBalance: "0",
};

describe("joinClan source", () => {
  it("marks a join from the boosted block", async () => {
    const fetchMock = mockFetch(() => res(201, { status: "joined" }));
    await joinClan("TST", "boosted");
    expect(fetchMock.mock.calls[0]![0]).toBe(
      "http://localhost:3000/clans/TST/join?source=boosted",
    );
  });

  it("sends no marker otherwise", async () => {
    const fetchMock = mockFetch(() => res(201, { status: "joined" }));
    await joinClan("TST");
    expect(fetchMock.mock.calls[0]![0]).toBe(
      "http://localhost:3000/clans/TST/join",
    );
  });
});

describe("fetchClanBoostStatus", () => {
  it("returns the parsed status", async () => {
    const fetchMock = mockFetch(() => res(200, STATUS));
    expect(await fetchClanBoostStatus("TST")).toEqual(STATUS);
    expect(fetchMock.mock.calls[0]![0]).toBe(
      "http://localhost:3000/clans/TST/boost",
    );
  });

  it("returns false on a non-OK response or a malformed body", async () => {
    mockFetch(() => res(403));
    expect(await fetchClanBoostStatus("TST")).toBe(false);
    mockFetch(() => res(200, { tiers: "nope" }));
    expect(await fetchClanBoostStatus("TST")).toBe(false);
  });
});

describe("buyClanBoost", () => {
  it("POSTs the tier with the idempotency key and returns the end time", async () => {
    const fetchMock = mockFetch(() =>
      res(201, {
        id: "1",
        tier: "spark",
        currency: "soft",
        amount: "250",
        startsAt: "2026-10-06T12:00:00.000Z",
        endsAt: "2026-10-06T13:00:00.000Z",
      }),
    );
    expect(await buyClanBoost("TST", "spark", "key-12345678")).toEqual({
      endsAt: "2026-10-06T13:00:00.000Z",
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:3000/clans/TST/boost");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      tier: "spark",
      idempotencyKey: "key-12345678",
    });
  });

  it.each([
    ["not_enough_members", "clan_modal.boost_error_not_enough_members"],
    ["not_recently_active", "clan_modal.boost_error_not_recently_active"],
    ["daily_limit", "clan_modal.boost_error_daily_limit"],
    ["insufficient_balance", "clan_modal.boost_error_insufficient_balance"],
    ["unknown_tier", "clan_modal.boost_error_failed"],
  ])("maps refusal %s to %s", async (code, key) => {
    mockFetch(() => res(400, { code }));
    expect(await buyClanBoost("TST", "spark", "k".repeat(8))).toEqual({
      error: key,
    });
  });

  it("maps 403 and network failures", async () => {
    mockFetch(() => res(403));
    expect(await buyClanBoost("TST", "spark", "k".repeat(8))).toEqual({
      error: "clan_modal.boost_error_forbidden",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("offline"))),
    );
    expect(await buyClanBoost("TST", "spark", "k".repeat(8))).toEqual({
      error: "clan_modal.error_network",
    });
  });
});
