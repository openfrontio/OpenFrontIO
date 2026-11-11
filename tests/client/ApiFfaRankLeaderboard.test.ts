import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/ClientEnv", () => ({
  ClientEnv: { jwtAudience: () => "localhost" },
}));
vi.mock("../../src/client/Auth", () => ({
  getAuthHeader: vi.fn(async () => ""),
  getPlayToken: vi.fn(async () => null),
  logOut: vi.fn(async () => {}),
  userAuth: vi.fn(async () => false),
}));

import {
  fetchFfaRankLeaderboard,
  fetchFfaAllRanksLeaderboard,
  fetchFfaRankPosition,
} from "../../src/client/Api";

const res = (body: unknown, ok = true, status = 200) => ({
  ok,
  status,
  statusText: ok ? "OK" : "Error",
  json: async () => body,
});

const entry = {
  rank: 1,
  elo: 2150.4,
  peakElo: 2200,
  wins: 10,
  losses: 5,
  total: 15,
  public_id: "player-1",
  accountUsername: "alpha.0001",
  uncertainty: 40,
  tier: "Diamond III",
};

beforeEach(() => {
  process.env.API_DOMAIN = "api.test";
  vi.stubGlobal("fetch", vi.fn());
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("fetchFfaRankPosition", () => {
  it("reads the signed-in player's position", async () => {
    vi.mocked(fetch).mockResolvedValue(res({ position: 4812 }) as never);

    expect(await fetchFfaRankPosition()).toBe(4812);
    const url = new URL(String(vi.mocked(fetch).mock.calls[0][0]));
    expect(url.pathname).toBe("/users/@me/ffa_rank_position");
  });

  it("is null when the board doesn't list them", async () => {
    vi.mocked(fetch).mockResolvedValue(res({ position: null }) as never);

    expect(await fetchFfaRankPosition()).toBeNull();
  });

  it("is null on an error or a malformed body", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(res({}, false, 500) as never);
    expect(await fetchFfaRankPosition()).toBeNull();

    vi.mocked(fetch).mockResolvedValueOnce(res({ position: "x" }) as never);
    expect(await fetchFfaRankPosition()).toBeNull();
  });
});

describe("fetchFfaRankLeaderboard", () => {
  it("asks for the rank and page", async () => {
    vi.mocked(fetch).mockResolvedValue(res({ players: [entry] }) as never);

    const result = await fetchFfaRankLeaderboard("diamond", 2);

    const url = new URL(String(vi.mocked(fetch).mock.calls[0][0]));
    expect(url.pathname).toBe("/leaderboard/ranked/ffa/diamond");
    expect(url.searchParams.get("page")).toBe("2");
    expect(result).toEqual({ players: [expect.objectContaining(entry)] });
  });

  it("reads the page limit as the end of the list", async () => {
    vi.mocked(fetch).mockResolvedValue(
      res({ message: "Page must be between 1 and 2" }, false, 400) as never,
    );

    expect(await fetchFfaRankLeaderboard("diamond", 3)).toBe("reached_limit");
  });

  it("fails on any other error", async () => {
    vi.mocked(fetch).mockResolvedValue(res({}, false, 500) as never);

    expect(await fetchFfaRankLeaderboard("diamond", 1)).toBe(false);
  });

  it("fails on a malformed body", async () => {
    vi.mocked(fetch).mockResolvedValue(res({ players: "nope" }) as never);

    expect(await fetchFfaRankLeaderboard("diamond", 1)).toBe(false);
  });
});

describe("fetchFfaAllRanksLeaderboard", () => {
  it("requests the globally ordered page", async () => {
    vi.mocked(fetch).mockResolvedValue(res({ players: [entry] }) as never);
    expect(await fetchFfaAllRanksLeaderboard(3)).toEqual({
      players: [expect.objectContaining(entry)],
    });
    const url = new URL(String(vi.mocked(fetch).mock.calls[0][0]));
    expect(url.pathname).toBe("/leaderboard/ranked/ffa/all");
    expect(url.searchParams.get("page")).toBe("3");
  });

  it("recognizes the five-page cap", async () => {
    vi.mocked(fetch).mockResolvedValue(
      res({ message: "Page must be between 1 and 5" }, false, 400) as never,
    );
    expect(await fetchFfaAllRanksLeaderboard(6)).toBe("reached_limit");
  });
});
