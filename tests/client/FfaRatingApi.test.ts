import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/Auth", () => ({
  getAuthHeader: vi.fn(async () => "Bearer test-token"),
}));

vi.mock("../../src/client/ApiBase", () => ({
  getApiBase: () => "https://api.test",
}));

import type { FfaGameRatingResponse } from "@openfront/shared/ApiSchemas";
import { getAuthHeader } from "../../src/client/Auth";
import {
  fetchMyFfaGameRating,
  pollFfaGameRating,
} from "../../src/client/FfaRatingApi";

const calibrating: FfaGameRatingResponse = {
  gameId: "g1",
  calibrating: true,
  calibrationGames: 4,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("fetchMyFfaGameRating", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function answer(response: () => Response) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response()),
    );
  }

  it("asks for the caller's seat in that game", async () => {
    answer(() => new Response("", { status: 404 }));
    await fetchMyFfaGameRating("game/1");
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("https://api.test/users/@me/ffa_rating/game%2F1");
    expect((init!.headers as Record<string, string>).Authorization).toBe(
      "Bearer test-token",
    );
  });

  it.each([
    [404, { status: "pending", notFound: true }],
    [429, { status: "pending", rateLimited: true }],
    [401, { status: "unavailable" }],
    [403, { status: "unavailable" }],
    [500, { status: "pending" }],
  ])("maps %i to %j", async (status, expected) => {
    answer(() => new Response("", { status }));
    expect(await fetchMyFfaGameRating("g1")).toEqual(expected);
  });

  it("is unavailable when signed out, without a request", async () => {
    vi.mocked(getAuthHeader).mockResolvedValueOnce("");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(await fetchMyFfaGameRating("g1")).toEqual({
      status: "unavailable",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("is unavailable for a body that fails the schema", async () => {
    answer(() => jsonResponse({ gameId: 1 }));
    expect(await fetchMyFfaGameRating("g1")).toEqual({
      status: "unavailable",
    });
  });

  it("returns a calibrating answer as ok", async () => {
    answer(() =>
      jsonResponse({ gameId: "g1", calibrating: true, calibrationGames: 4 }),
    );
    expect(await fetchMyFfaGameRating("g1")).toEqual({
      status: "ok",
      data: calibrating,
    });
  });

  it("is pending when the request throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    expect(await fetchMyFfaGameRating("g1")).toEqual({ status: "pending" });
  });
});

describe("pollFfaGameRating", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("polls past 404s until the seat is rated", async () => {
    vi.useFakeTimers();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({ status: "pending", notFound: true })
      .mockResolvedValueOnce({ status: "ok", data: calibrating });
    const result = pollFfaGameRating("g1", { intervalMs: 100, fetcher });
    await vi.advanceTimersByTimeAsync(500);
    await expect(result).resolves.toEqual(calibrating);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("gives up with null at the deadline", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockResolvedValue({ status: "pending" });
    const result = pollFfaGameRating("g1", {
      intervalMs: 100,
      timeoutMs: 1_000,
      fetcher,
    });
    await vi.advanceTimersByTimeAsync(2_000);
    await expect(result).resolves.toBeNull();
  });

  it("stops at once on unavailable", async () => {
    const fetcher = vi.fn().mockResolvedValue({ status: "unavailable" });
    await expect(pollFfaGameRating("g1", { fetcher })).resolves.toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
