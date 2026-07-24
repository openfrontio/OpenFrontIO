import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/ClientEnv", () => ({
  ClientEnv: { jwtAudience: () => "localhost" },
}));

// fetchPlayerLeaderboard is unauthenticated; Auth is only mocked because
// Api.ts imports it at module scope.
vi.mock("../../src/client/Auth", () => ({
  getAuthHeader: vi.fn(async () => ""),
  getPlayToken: vi.fn(async () => null),
  logOut: vi.fn(async () => {}),
  userAuth: vi.fn(async () => false),
}));

import { fetchPlayerLeaderboard } from "../../src/client/Api";

const entry = (rank: number) => ({
  rank,
  elo: 1500,
  peakElo: 1600,
  wins: 10,
  losses: 5,
  total: 15,
  public_id: `player-${rank}`,
  username: "Alpha",
  accountUsername: "alpha.0001",
});

const res = (body: unknown, ok = true, status = 200) => ({
  ok,
  status,
  statusText: ok ? "OK" : "Error",
  json: async () => body,
});

beforeEach(() => {
  // Short-circuits getApiBase before it reads localStorage.
  process.env.API_DOMAIN = "api.test";
  vi.stubGlobal("fetch", vi.fn());
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("fetchPlayerLeaderboard", () => {
  it("returns the parsed page", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      res({ "1v1": [entry(1)] }),
    );

    const result = await fetchPlayerLeaderboard(1);
    expect(result).not.toBe(false);
    expect(result).not.toBe("reached_limit");
    expect((result as { "1v1": unknown[] })["1v1"]).toHaveLength(1);
  });

  it("requests the page it was asked for", async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(res({ "1v1": [] }));

    await fetchPlayerLeaderboard(3);
    expect(String(fetchMock.mock.calls[0][0])).toContain("page=3");
  });

  it("reports a page past the end as reached_limit", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      res(
        { error: "Bad request", message: "Page must be between 1 and 2" },
        false,
        400,
      ),
    );

    expect(await fetchPlayerLeaderboard(3)).toBe("reached_limit");
  });

  // The bounds are open so a dynamic page cap keeps matching.
  it("accepts any numeric bounds in the message", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      res(
        { error: "Bad request", message: "Page must be between 1 and 137" },
        false,
        400,
      ),
    );

    expect(await fetchPlayerLeaderboard(200)).toBe("reached_limit");
  });

  // Anything looser than the exact page-bounds wording would hide real errors.
  it.each([
    ["a 500", res({}, false, 500)],
    ["a 400 with no message", res({ error: "Bad request" }, false, 400)],
    [
      "an unrelated 400 mentioning a page",
      res(
        { error: "Bad request", message: "Invalid page parameter" },
        false,
        400,
      ),
    ],
    [
      "a 400 with a non-string message",
      res({ error: "Bad request", message: { page: 3 } }, false, 400),
    ],
    [
      "a 400 that only embeds the bounds phrase",
      res(
        {
          error: "Bad request",
          message: "Upstream rejected the query: Page must be between 1 and 2",
        },
        false,
        400,
      ),
    ],
    [
      "a 400 with the phrase but no bounds",
      res(
        { error: "Bad request", message: "Page must be between" },
        false,
        400,
      ),
    ],
  ])("returns false for %s", async (_label, response) => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(response);
    expect(await fetchPlayerLeaderboard(3)).toBe(false);
  });

  it("returns false when the error body is not JSON", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      json: async () => {
        throw new SyntaxError("Unexpected token <");
      },
    });

    expect(await fetchPlayerLeaderboard(3)).toBe(false);
  });

  it("returns false when the payload fails validation", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      res({ "1v1": [{ rank: "first" }] }),
    );

    expect(await fetchPlayerLeaderboard(1)).toBe(false);
  });

  it("returns false when the request throws", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new TypeError("network down"),
    );

    expect(await fetchPlayerLeaderboard(1)).toBe(false);
  });
});
