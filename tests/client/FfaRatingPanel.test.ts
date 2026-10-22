import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/Utils", () => ({
  translateText: (k: string, p?: Record<string, string | number>) =>
    p ? `${k}:${JSON.stringify(p)}` : k,
}));

import type { FfaGameRatingResponse } from "@openfront/shared/ApiSchemas";
import {
  FFA_RATING_MIN_HUMANS,
  type FfaRatingPanel,
  ffaRatingPanelView,
} from "../../src/client/components/ffaRating/FfaRatingPanel";
import type { FfaTierBadge } from "../../src/client/components/ffaRating/FfaTierBadge";

const rated: FfaGameRatingResponse = {
  gameId: "g1",
  calibrating: false,
  calibrationGames: 10,
  ratingBefore: 1600.4,
  ratingAfter: 1612.6,
  uncertaintyAfter: 84.7,
  tierBefore: "Gold I",
  tierAfter: "Platinum III",
  expected: 0.0623,
  deltaResult: 9.1,
  deltaPlace: 3.1,
};

let panel: FfaRatingPanel;
afterEach(() => panel?.remove());

async function render(poll: FfaRatingPanel["poll"], lobbyHumans = 24) {
  panel = document.createElement("ffa-rating-panel") as FfaRatingPanel;
  panel.poll = poll;
  panel.gameId = "g1";
  panel.lobbyHumans = lobbyHumans;
  document.body.appendChild(panel);
  await panel.updateComplete;
  return panel;
}

const text = (sel: string) => panel.querySelector(sel)?.textContent ?? null;

describe("ffaRatingPanelView", () => {
  it("maps a missing response to hidden", () => {
    expect(ffaRatingPanelView(null)).toEqual({ kind: "hidden" });
  });

  it("maps a calibrating response to calibrating", () => {
    expect(
      ffaRatingPanelView({
        gameId: "g1",
        calibrating: true,
        calibrationGames: 4,
      }),
    ).toEqual({ kind: "calibrating", calibrationGames: 4 });
  });

  it("maps the calibration-completing game to revealed", () => {
    expect(
      ffaRatingPanelView({
        gameId: "g1",
        calibrating: false,
        revealed: true,
        calibrationGames: 10,
        ratingAfter: 1712.4,
        uncertaintyAfter: 120.2,
        tierAfter: "Gold II",
      }),
    ).toEqual({
      kind: "revealed",
      ratingAfter: 1712.4,
      uncertaintyAfter: 120.2,
      tierAfter: "Gold II",
    });
  });

  it("hides a revealed response missing a field and has no result fallback", () => {
    expect(
      ffaRatingPanelView({
        gameId: "g1",
        calibrating: false,
        revealed: true,
        calibrationGames: 10,
        ratingAfter: 1712.4,
      }),
    ).toEqual({ kind: "hidden" });
  });

  it("maps a complete rated response to result", () => {
    const view = ffaRatingPanelView(rated);
    expect(view.kind).toBe("result");
  });

  it("hides a rated response with a missing field", () => {
    const partial: FfaGameRatingResponse = { ...rated, deltaPlace: undefined };
    expect(ffaRatingPanelView(partial)).toEqual({ kind: "hidden" });
  });
});

describe("<ffa-rating-panel>", () => {
  it("says the rating is being calculated while the seat is unrated", async () => {
    await render(() => new Promise(() => {}));
    expect(panel.textContent).toContain("ffa_rating.pending");
  });

  it("shows expected win, the split change and the new rating", async () => {
    await render(async () => rated);
    await vi.waitFor(() =>
      expect(
        panel.querySelector("[data-ffa-rating-panel='result']"),
      ).not.toBeNull(),
    );
    expect(text("[data-ffa-rating-after]")).toContain("1613 ± 85");
    expect(text("[data-ffa-rating-change]")).toContain("+12");
    expect(text("[data-ffa-rating-expected]")).toContain(
      'ffa_rating.expected:{"pct":"6.2"}',
    );
    expect(text("[data-ffa-rating-result]")).toContain("+9");
    expect(text("[data-ffa-rating-placement]")).toContain("+3");
    expect(panel.querySelector<FfaTierBadge>("ffa-tier-badge")!.tier).toBe(
      "Platinum III",
    );
    expect(panel.querySelector("ofstats-credit")).not.toBeNull();
  });

  it("colours the change by sign", async () => {
    await render(async () => rated);
    await vi.waitFor(() =>
      expect(panel.querySelector("[data-ffa-rating-change]")).not.toBeNull(),
    );
    expect(
      panel.querySelector("[data-ffa-rating-change]")!.className,
    ).toContain("text-green-400");
    panel.remove();
    await render(async () => ({
      ...rated,
      ratingAfter: 1590,
      tierAfter: "Gold I",
    }));
    await vi.waitFor(() =>
      expect(panel.querySelector("[data-ffa-rating-change]")).not.toBeNull(),
    );
    expect(
      panel.querySelector("[data-ffa-rating-change]")!.className,
    ).toContain("text-red-400");
  });

  it("announces a promotion", async () => {
    await render(async () => rated);
    await vi.waitFor(() =>
      expect(text("[data-ffa-tier-up]")).toContain(
        'ffa_rating.tier_up:{"tier":"ffa_rating.tier.platinum III"}',
      ),
    );
  });

  it.each([
    ["Platinum III", "Platinum III"],
    ["Platinum III", "Gold I"],
  ])("has no promotion line from %s to %s", async (tierBefore, tierAfter) => {
    await render(async () => ({ ...rated, tierBefore, tierAfter }));
    await vi.waitFor(() =>
      expect(panel.querySelector("[data-ffa-rating-after]")).not.toBeNull(),
    );
    expect(panel.querySelector("[data-ffa-tier-up]")).toBeNull();
  });

  it("reveals the rating, with no change, on the game that completes calibration", async () => {
    await render(async () => ({
      gameId: "g1",
      calibrating: false,
      revealed: true,
      calibrationGames: 10,
      ratingAfter: 1712.4,
      uncertaintyAfter: 120.2,
      tierAfter: "Gold II",
    }));
    await vi.waitFor(() =>
      expect(
        panel.querySelector("[data-ffa-rating-panel='revealed']"),
      ).not.toBeNull(),
    );
    expect(panel.textContent).toContain("ffa_rating.calibration_complete");
    expect(text("[data-ffa-rating-after]")).toContain("1712 ± 120");
    expect(panel.querySelector<FfaTierBadge>("ffa-tier-badge")!.tier).toBe(
      "Gold II",
    );
    expect(panel.querySelector("[data-ffa-rating-change]")).toBeNull();
    expect(panel.querySelector("[data-ffa-rating-expected]")).toBeNull();
    expect(panel.querySelector("ofstats-credit")).not.toBeNull();
  });

  it("shows Calibrating N/10 and no numbers while calibrating", async () => {
    await render(async () => ({
      gameId: "g1",
      calibrating: true,
      calibrationGames: 4,
    }));
    await vi.waitFor(() =>
      expect(
        panel.querySelector<FfaTierBadge>("ffa-tier-badge")?.calibrationGames,
      ).toBe(4),
    );
    expect(panel.querySelector("[data-ffa-rating-after]")).toBeNull();
    expect(panel.querySelector("ofstats-credit")).not.toBeNull();
  });

  it("renders nothing and asks nothing for a lobby under 10 humans", async () => {
    const poll = vi.fn();
    await render(poll, FFA_RATING_MIN_HUMANS - 1);
    expect(poll).not.toHaveBeenCalled();
    expect(panel.textContent!.trim()).toBe("");
  });

  it("renders nothing once the poll gives up", async () => {
    await render(async () => null);
    await vi.waitFor(() => expect(panel.textContent!.trim()).toBe(""));
  });

  it("asks once per game", async () => {
    const poll = vi.fn(
      () => new Promise<FfaGameRatingResponse | null>(() => {}),
    );
    await render(poll);
    panel.lobbyHumans = 25;
    await panel.updateComplete;
    expect(poll).toHaveBeenCalledTimes(1);
  });

  it("stops asking once removed", async () => {
    let signal!: AbortSignal;
    await render((_id, s) => {
      signal = s;
      return new Promise(() => {});
    });
    panel.remove();
    expect(signal.aborted).toBe(true);
  });
});
