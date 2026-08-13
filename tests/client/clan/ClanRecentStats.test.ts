import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/client/Api", () => ({
  getApiBase: vi.fn(() => "http://localhost:3000"),
  getUserMe: vi.fn(),
}));

vi.mock("../../../src/client/Auth", () => ({
  getAuthHeader: vi.fn(async () => "Bearer test-token"),
}));

import { fetchClanRecentStats } from "../../../src/client/ClanApi";
import { ClanWindowStatsResponseSchema } from "../../../src/core/ClanApiSchemas";

const clanStats = (overrides: Record<string, unknown> = {}) => ({
  clanTag: "UN",
  games: 12,
  playerSessions: 30,
  wins: 5,
  losses: 7,
  weightedWins: 8.25,
  weightedLosses: 4.5,
  weightedWLRatio: 1.83,
  ...overrides,
});

const windowResponse = (clan = clanStats()) => ({
  start: "2026-08-12T18:00:00.000Z",
  end: "2026-08-13T18:00:00.000Z",
  clan,
});

const okJson = (data: unknown) => ({
  ok: true,
  status: 200,
  json: async () => data,
});

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("fetchClanRecentStats", () => {
  it("requests the public endpoint with a 24h window and the uppercased tag", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      okJson(windowResponse()),
    );
    vi.stubGlobal("fetch", fetchMock);

    const before = Date.now();
    await fetchClanRecentStats("un");
    const after = Date.now();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.origin + url.pathname).toBe(
      "http://localhost:3000/public/clan/UN",
    );

    const start = new Date(url.searchParams.get("start")!);
    const end = new Date(url.searchParams.get("end")!);
    // The API rejects windows longer than one day, so this must be exact.
    expect(end.getTime() - start.getTime()).toBe(24 * 60 * 60 * 1000);
    expect(end.getTime()).toBeGreaterThanOrEqual(before);
    expect(end.getTime()).toBeLessThanOrEqual(after);
    // Both bounds must be ISO-8601 with a Z offset for the server's parser.
    expect(url.searchParams.get("start")).toBe(start.toISOString());
    expect(url.searchParams.get("end")).toBe(end.toISOString());
  });

  it("sends no Authorization header (public endpoint)", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      okJson(windowResponse()),
    );
    vi.stubGlobal("fetch", fetchMock);

    await fetchClanRecentStats("UN");

    expect(fetchMock.mock.calls[0][1]?.headers).toEqual({
      Accept: "application/json",
    });
  });

  it("returns the parsed window aggregate", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => okJson(windowResponse())),
    );

    const res = await fetchClanRecentStats("UN");
    expect(res).not.toBe(false);
    if (res === false) return;
    expect(res.clan.games).toBe(12);
    expect(res.clan.wins).toBe(5);
    expect(res.clan.weightedWLRatio).toBe(1.83);
  });

  it("returns false on a non-OK status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 400, json: async () => ({}) })),
    );
    await expect(fetchClanRecentStats("UN")).resolves.toBe(false);
  });

  it("returns false when the payload fails validation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => okJson({ start: "nope", end: "nope", clan: {} })),
    );
    await expect(fetchClanRecentStats("UN")).resolves.toBe(false);
  });

  it("returns false when the request throws (offline / timeout)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    await expect(fetchClanRecentStats("UN")).resolves.toBe(false);
  });
});

describe("ClanWindowStatsResponseSchema", () => {
  it("accepts the live payload and strips the breakdown maps", () => {
    const result = ClanWindowStatsResponseSchema.safeParse(
      windowResponse(
        clanStats({
          teamTypeWL: { Duos: { wl: [1, 2], weightedWL: [1.5, 0.5] } },
          teamCountWL: { "2": { wl: [1, 2], weightedWL: [1.5, 0.5] } },
        }),
      ),
    );
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.clan).not.toHaveProperty("teamTypeWL");
    expect(result.data.clan).not.toHaveProperty("teamCountWL");
  });

  it("accepts a zero-activity window", () => {
    const result = ClanWindowStatsResponseSchema.safeParse(
      windowResponse(
        clanStats({
          games: 0,
          playerSessions: 0,
          wins: 0,
          losses: 0,
          weightedWins: 0,
          weightedLosses: 0,
          // The API reports a ratio of 1 when there are no weighted losses.
          weightedWLRatio: 1,
        }),
      ),
    );
    expect(result.success).toBe(true);
  });

  it("rejects non-ISO window bounds", () => {
    const result = ClanWindowStatsResponseSchema.safeParse({
      ...windowResponse(),
      start: "August 12, 2026",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a missing counter", () => {
    const clan = clanStats();
    delete (clan as Record<string, unknown>).weightedWLRatio;
    const result = ClanWindowStatsResponseSchema.safeParse(
      windowResponse(clan),
    );
    expect(result.success).toBe(false);
  });
});
