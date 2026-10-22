import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/Utils", () => ({
  translateText: (k: string, p?: Record<string, string | number>) =>
    p ? `${k}:${JSON.stringify(p)}` : k,
}));

import {
  type FfaRatingSummary,
  type FfaRatingSummaryData,
  ffaSummaryFromMe,
  ffaSummaryFromProfile,
} from "../../src/client/components/ffaRating/FfaRatingSummary";
import type { FfaTierBadge } from "../../src/client/components/ffaRating/FfaTierBadge";

let el: FfaRatingSummary;
afterEach(() => el?.remove());

async function render(rating: FfaRatingSummaryData | null) {
  el = document.createElement("ffa-rating-summary") as FfaRatingSummary;
  el.rating = rating;
  document.body.appendChild(el);
  await el.updateComplete;
  await el.querySelector<FfaTierBadge>("ffa-tier-badge")?.updateComplete;
  return el;
}

describe("ffaSummaryFromMe / ffaSummaryFromProfile", () => {
  it.each([
    [undefined, null],
    [{ elo: 1234 }, null],
    [
      { games: 3, wins: 1, calibrationGames: 3 },
      { kind: "calibrating", calibrationGames: 3 },
    ],
    [
      {
        elo: 1612.6,
        uncertainty: 84.7,
        tier: "Gold I",
        games: 40,
        wins: 5,
        peak: 1700,
      },
      {
        kind: "rated",
        rating: 1612.6,
        uncertainty: 84.7,
        tier: "Gold I",
        peak: 1700,
      },
    ],
  ])("reads @me's %j as %j", (ffa, expected) =>
    expect(ffaSummaryFromMe(ffa as never)).toEqual(expected),
  );

  it("reads another player's profile rating", () => {
    expect(ffaSummaryFromProfile(null)).toBeNull();
    expect(ffaSummaryFromProfile(undefined)).toBeNull();
    expect(
      ffaSummaryFromProfile({
        rating: 1612.6,
        uncertainty: 84.7,
        tier: "Gold I",
        games: 40,
        wins: 5,
        peak: 1700,
      }),
    ).toEqual({
      kind: "rated",
      rating: 1612.6,
      uncertainty: 84.7,
      tier: "Gold I",
      peak: 1700,
    });
  });
});

describe("<ffa-rating-summary>", () => {
  it("shows the badge, rating ±, peak and credit", async () => {
    await render({
      kind: "rated",
      rating: 1612.6,
      uncertainty: 84.7,
      tier: "Gold I",
      peak: 1700,
    });
    expect(
      el
        .querySelector("[data-ffa-rating-summary]")!
        .getAttribute("data-ffa-rating-summary"),
    ).toBe("rated");
    expect(el.textContent).toContain("ffa_rating.title");
    expect(el.querySelector<FfaTierBadge>("ffa-tier-badge")!.tier).toBe(
      "Gold I",
    );
    expect(el.querySelector("[data-ffa-rating-value]")!.textContent).toContain(
      "1613 ± 85",
    );
    expect(el.querySelector("[data-ffa-rating-peak]")!.textContent).toContain(
      'ffa_rating.peak:{"rating":"1700"}',
    );
    expect(el.querySelector("ofstats-credit")).not.toBeNull();
  });

  it("leaves the peak out when there is none", async () => {
    await render({
      kind: "rated",
      rating: 1612.6,
      uncertainty: 84.7,
      tier: "Gold I",
    });
    expect(el.querySelector("[data-ffa-rating-value]")).not.toBeNull();
    expect(el.querySelector("[data-ffa-rating-peak]")).toBeNull();
  });

  it("shows Calibrating for a calibrating player", async () => {
    await render({ kind: "calibrating", calibrationGames: 3 });
    expect(
      el
        .querySelector("[data-ffa-rating-summary]")!
        .getAttribute("data-ffa-rating-summary"),
    ).toBe("calibrating");
    expect(
      el.querySelector<FfaTierBadge>("ffa-tier-badge")!.calibrationGames,
    ).toBe(3);
    expect(el.querySelector("[data-ffa-rating-value]")).toBeNull();
    expect(el.querySelector("ofstats-credit")).not.toBeNull();
  });

  it("renders nothing without a rating", async () => {
    await render(null);
    expect(el.textContent).toBe("");
    expect(el.querySelector("[data-ffa-rating-summary]")).toBeNull();
  });
});
