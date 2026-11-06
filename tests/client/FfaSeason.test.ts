import { describe, expect, it } from "vitest";
import {
  formatSeasonDate,
  seasonTiming,
} from "../../src/client/components/ffaRating/FfaSeason";

const at = (iso: string) => new Date(`${iso}T12:00:00Z`);
const START = "2026-11-09";
const END = "2026-12-20"; // 42 days, the first and last included

describe("seasonTiming", () => {
  it("counts the days left on the first day, including the last", () => {
    expect(seasonTiming(START, END, at(START))).toEqual({
      daysLeft: 41,
      progress: 1 / 42,
    });
  });

  it("is on the last day when the end date is today", () => {
    expect(seasonTiming(START, END, at(END))).toEqual({
      daysLeft: 0,
      progress: 1,
    });
  });

  it("is halfway through after half the days", () => {
    expect(seasonTiming(START, END, at("2026-11-29")).progress).toBeCloseTo(
      0.5,
    );
  });

  it("changes day at midnight UTC, not on the viewer's clock", () => {
    const lastMinute = new Date("2026-11-09T23:59:00Z");
    const nextMinute = new Date("2026-11-10T00:01:00Z");
    expect(seasonTiming(START, END, lastMinute).daysLeft).toBe(41);
    expect(seasonTiming(START, END, nextMinute).daysLeft).toBe(40);
  });

  it("stays in range if the viewer's clock is outside the season", () => {
    expect(seasonTiming(START, END, at("2026-11-01"))).toEqual({
      daysLeft: 41,
      progress: 1 / 42,
    });
    expect(seasonTiming(START, END, at("2027-02-01"))).toEqual({
      daysLeft: 0,
      progress: 1,
    });
  });
});

describe("formatSeasonDate", () => {
  it("reads the date as UTC, whatever the viewer's timezone", () => {
    const text = formatSeasonDate(START);
    expect(text).toMatch(/9/);
    expect(text).toMatch(/Nov/);
    expect(text).not.toMatch(/2026/);
  });

  it("adds the year when asked", () => {
    expect(formatSeasonDate(END, true)).toMatch(/2026/);
  });
});
