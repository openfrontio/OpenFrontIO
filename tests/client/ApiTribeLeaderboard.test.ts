import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/ClientEnv", () => ({
  ClientEnv: { jwtAudience: () => "localhost" },
}));

// fetchTribeLeaderboard is unauthenticated; Auth is only mocked because
// Api.ts imports it at module scope.
vi.mock("../../src/client/Auth", () => ({
  getAuthHeader: vi.fn(async () => ""),
  getPlayToken: vi.fn(async () => null),
  logOut: vi.fn(async () => {}),
  userAuth: vi.fn(async () => false),
}));

import { fetchTribeLeaderboard } from "../../src/client/Api";

const entry = (rank: number) => ({
  rank,
  name: `Tribe ${rank}`,
  gamesAppeared: 140,
  playerReach: 12400,
  ownerPublicId: `owner-${rank}`,
  // Odd ranks have no account username, so the fallback path is exercised too.
  ownerUsername: rank % 2 === 0 ? `buyer.${rank}` : null,
  activeBoosts: 0,
});

const board = (ranks: number[]) => ({
  windowDays: 30,
  start: "2026-06-27",
  end: "2026-07-27",
  tribes: ranks.map(entry),
});

const page = (size: number, startRank: number) =>
  board(Array.from({ length: size }, (_, i) => startRank + i));

const res = (body: unknown, ok = true, status = 200) => ({
  ok,
  status,
  statusText: ok ? "OK" : "Error",
  json: async () => body,
});

const fetchMock = () => global.fetch as ReturnType<typeof vi.fn>;

beforeEach(() => {
  // Short-circuits getApiBase before it reads localStorage.
  process.env.API_DOMAIN = "api.test";
  vi.stubGlobal("fetch", vi.fn());
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("fetchTribeLeaderboard", () => {
  it("returns the parsed board", async () => {
    fetchMock().mockResolvedValueOnce(res(board([1, 2])));

    const result = await fetchTribeLeaderboard();
    expect(result).not.toBe(false);
    if (result === false) return;
    expect(result.tribes).toHaveLength(2);
    expect(result.windowDays).toBe(30);
    expect(result.start).toBe("2026-06-27");
  });

  it("requests 1-based page 1 first", async () => {
    fetchMock().mockResolvedValueOnce(res(board([1])));

    await fetchTribeLeaderboard();
    expect(String(fetchMock().mock.calls[0][0])).toContain("page=1");
  });

  // The board has no total or hasMore, so a short page is the only end signal.
  it("stops after one request when page 1 is short", async () => {
    fetchMock().mockResolvedValueOnce(res(page(49, 1)));

    const result = await fetchTribeLeaderboard();
    expect(fetchMock()).toHaveBeenCalledTimes(1);
    expect(result === false ? 0 : result.tribes).toHaveLength(49);
  });

  it("fetches and appends page 2 when page 1 is exactly full", async () => {
    fetchMock()
      .mockResolvedValueOnce(res(page(50, 1)))
      .mockResolvedValueOnce(res(page(30, 51)));

    const result = await fetchTribeLeaderboard();
    expect(fetchMock()).toHaveBeenCalledTimes(2);
    expect(String(fetchMock().mock.calls[1][0])).toContain("page=2");
    expect(result === false ? [] : result.tribes).toHaveLength(80);
    // Ranks are absolute across pages, so page 2 continues at 51.
    expect(result === false ? null : result.tribes[50].rank).toBe(51);
  });

  it("does not request a page 3 even when page 2 is full", async () => {
    fetchMock()
      .mockResolvedValueOnce(res(page(50, 1)))
      .mockResolvedValueOnce(res(page(50, 51)));

    const result = await fetchTribeLeaderboard();
    expect(fetchMock()).toHaveBeenCalledTimes(2);
    expect(result === false ? [] : result.tribes).toHaveLength(100);
  });

  // A truncated board beats an error screen.
  it("keeps page 1 when page 2 fails", async () => {
    fetchMock()
      .mockResolvedValueOnce(res(page(50, 1)))
      .mockResolvedValueOnce(res({}, false, 500));

    const result = await fetchTribeLeaderboard();
    expect(result === false ? [] : result.tribes).toHaveLength(50);
  });

  it("returns false when page 1 fails", async () => {
    fetchMock().mockResolvedValueOnce(res({}, false, 500));
    expect(await fetchTribeLeaderboard()).toBe(false);
  });

  it("returns false when the payload fails validation", async () => {
    fetchMock().mockResolvedValueOnce(
      res({ windowDays: 30, start: "2026-06-27", end: "2026-07-27" }),
    );
    expect(await fetchTribeLeaderboard()).toBe(false);
  });

  it("returns false when the request throws", async () => {
    fetchMock().mockRejectedValueOnce(new TypeError("network down"));
    expect(await fetchTribeLeaderboard()).toBe(false);
  });
});
