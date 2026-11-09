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

import { fetchFfaRankLeaderboard } from "../../src/client/Api";

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
