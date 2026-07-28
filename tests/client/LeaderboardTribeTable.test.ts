import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/Api", () => ({
  fetchTribeLeaderboard: vi.fn(async () => false),
}));

vi.mock("../../src/client/Utils", () => ({
  translateText: vi.fn((key: string) => key),
}));

import { formatWindowDate } from "../../src/client/components/leaderboard/LeaderboardTribeTable";

describe("formatWindowDate", () => {
  // Regression guard: `new Date("2026-06-27")` is parsed as UTC midnight, so
  // formatting it with toLocaleDateString renders the PREVIOUS day anywhere
  // west of UTC. Comparing against a locally-constructed date makes this fail
  // under a western TZ if the parse ever goes back to the naive form.
  it("renders the calendar day it was given, not a UTC-shifted one", () => {
    const expected = new Date(2026, 5, 27).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
    expect(formatWindowDate("2026-06-27")).toBe(expected);
  });

  it("handles a window that spans a year boundary", () => {
    const expected = new Date(2027, 0, 1).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
    expect(formatWindowDate("2027-01-01")).toBe(expected);
  });

  // The caller drops the whole caption rather than render "Invalid Date" —
  // the same tolerance boostExpiresAt needed when its wire format wobbled.
  it.each([
    ["a full ISO datetime", "2026-06-27T00:00:00.000Z"],
    ["raw pg text", "2026-06-27 18:04:11+00"],
    ["a non-date string", "last month"],
    ["an empty string", ""],
  ])("returns null for %s", (_label, value) => {
    expect(formatWindowDate(value)).toBeNull();
  });

  it("returns null for a well-formed but impossible date", () => {
    expect(formatWindowDate("2026-13-45")).toBeNull();
  });
});
