import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/Api", () => ({
  fetchTribeLeaderboard: vi.fn(async () => false),
}));

// Keys pass through with their params inlined so assertions can see both
// which string was used and what was interpolated into it.
vi.mock("../../src/client/Utils", () => ({
  translateText: vi.fn(
    (key: string, params?: Record<string, string | number>) =>
      params ? `${key}(${JSON.stringify(params)})` : key,
  ),
}));

import { fetchTribeLeaderboard } from "../../src/client/Api";
import {
  formatWindowDate,
  LeaderboardTribeTable,
} from "../../src/client/components/leaderboard/LeaderboardTribeTable";

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

describe("boost column", () => {
  const entry = (overrides: Record<string, unknown> = {}) => ({
    rank: 1,
    name: "Dragon Riders",
    gamesAppeared: 140,
    playerReach: 12400,
    ownerPublicId: "aB3xK9zQ",
    ownerUsername: null,
    activeBoosts: 0,
    ...overrides,
  });

  const board = (tribes: Record<string, unknown>[]) => ({
    windowDays: 30,
    start: "2026-06-27",
    end: "2026-07-27",
    tribes,
  });

  let el: LeaderboardTribeTable;

  const renderBoard = async (tribes: Record<string, unknown>[]) => {
    vi.mocked(fetchTribeLeaderboard).mockResolvedValueOnce(
      board(tribes) as Awaited<ReturnType<typeof fetchTribeLeaderboard>>,
    );
    el = document.createElement(
      "leaderboard-tribe-table",
    ) as LeaderboardTribeTable;
    document.body.appendChild(el);
    await el.ensureLoaded();
    await el.updateComplete;
  };

  afterEach(() => {
    el?.remove();
  });

  const boostValues = () =>
    Array.from(
      el.querySelectorAll(
        '[title^="leaderboard_modal.tribes_boost_value_tooltip"]',
      ),
    );

  const headerTexts = () =>
    Array.from(el.querySelectorAll("th")).map((th) => th.textContent?.trim());

  // The in-game draw weight is 1 + activeBoosts, so 2 boosts display as 3× —
  // the same convention the owner's store UI uses.
  it("shows count + 1 as the multiplier on a boosted tribe", async () => {
    await renderBoard([entry({ activeBoosts: 2 })]);
    expect(boostValues()).toHaveLength(1);
    expect(boostValues()[0].textContent).toContain(
      'leaderboard_modal.tribes_boost_value({"multiplier":3})',
    );
  });

  it("renders the Boost column header", async () => {
    await renderBoard([entry()]);
    expect(headerTexts()).toContain("leaderboard_modal.tribes_boost");
  });

  it("shows no multiplier at zero boosts", async () => {
    await renderBoard([entry({ activeBoosts: 0 })]);
    expect(boostValues()).toHaveLength(0);
  });

  it("shows a multiplier only on the boosted rows of a mixed board", async () => {
    await renderBoard([
      entry({ activeBoosts: 1 }),
      entry({ rank: 2, name: "Quiet Tribe" }),
    ]);
    expect(boostValues()).toHaveLength(1);
    expect(boostValues()[0].textContent).toContain('{"multiplier":2}');
  });
});
