import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/Utils", () => ({
  translateText: (key: string, params?: Record<string, string | number>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));

import type { GameXpPanelState } from "../../src/client/components/GameXpPanel";
import {
  gameShareMoment,
  momentShareLabel,
  momentShareText,
  momentShareUrl,
  momentSlug,
} from "../../src/client/MomentShare";
import { playerProfileUrl } from "../../src/client/utilities/PlayerProfileUrl";

// A server result for a game at prestige 3 that reached `levels`.
function result(
  levels: number[],
  opts: { legend?: boolean; prestige?: number } = {},
): GameXpPanelState {
  const prestige = opts.prestige ?? 3;
  const last = levels.length > 0 ? levels[levels.length - 1] : 46;
  return {
    kind: "result",
    data: {
      gameId: "wndrG4me1",
      eligible: true,
      breakdown: {
        leftEarly: false,
        played: 50,
        time: 280,
        placement: 90,
        win: 300,
        firstGame: 200,
        feats: 0,
        subtotal: 920,
        gamePermille: 1000,
        subscriberPermille: 1250,
        total: 1150,
      },
      before: { prestige, level: 46, xpInLevel: 1550, xpForNext: 2210 },
      after: {
        prestige,
        level: last,
        xpInLevel: 444,
        xpForNext: 2260,
        lifetimeXp: 125400,
        legend: opts.legend ?? false,
        canPrestige: false,
      },
      levelsReached: levels.map((level) => ({ prestige, level })),
    },
  };
}

describe("gameShareMoment", () => {
  it("shares a milestone level the server says was reached", () => {
    expect(gameShareMoment(result([49, 50]))).toEqual({
      kind: "level",
      level: 50,
    });
  });

  it("shares the highest of several milestones reached in one game", () => {
    expect(gameShareMoment(result([9, 10, 11, 24, 25, 26]))).toEqual({
      kind: "level",
      level: 25,
    });
  });

  it("shares nothing for an ordinary level-up or no level-up", () => {
    expect(gameShareMoment(result([47]))).toBeNull();
    expect(gameShareMoment(result([]))).toBeNull();
  });

  it("puts becoming a Legend ahead of the level", () => {
    const view = result([100], { legend: true, prestige: 10 });
    expect(gameShareMoment(view)).toEqual({ kind: "legend" });
  });

  it("doesn't call it a Legend moment for a player who already was one", () => {
    // Legend already, no level 100 this game: nothing new to share.
    expect(gameShareMoment(result([], { legend: true }))).toBeNull();
  });

  it("ignores levels at another prestige", () => {
    const view = result([50]);
    if (view.kind !== "result" || !view.data.eligible) throw new Error();
    view.data.levelsReached = [{ prestige: 4, level: 50 }];
    expect(gameShareMoment(view)).toBeNull();
  });

  it("only goes by the server's result, never anything provisional", () => {
    const confirmed = result([50]);
    if (confirmed.kind !== "result") throw new Error();
    // A provisional figure carries the same data under another kind.
    const provisional = {
      kind: "provisional",
      data: confirmed.data,
    } as unknown as GameXpPanelState;
    expect(gameShareMoment(provisional)).toBeNull();
    for (const kind of [
      "hidden",
      "signed_out",
      "awaiting_end",
      "calculating",
    ] as const) {
      expect(gameShareMoment({ kind })).toBeNull();
    }
    expect(
      gameShareMoment({
        kind: "result",
        data: { gameId: "g", eligible: false, reason: "too_short" },
      }),
    ).toBeNull();
  });
});

describe("moment links and lines", () => {
  it("names the moment in the profile link", () => {
    expect(momentSlug({ kind: "level", level: 50 })).toBe("level50");
    expect(momentSlug({ kind: "legend" })).toBe("legend");
    expect(momentSlug({ kind: "prestige", rank: 3 })).toBe("prestige3");
    expect(momentShareUrl("wonder01", { kind: "level", level: 50 })).toBe(
      `${playerProfileUrl("wonder01")}?moment=level50`,
    );
    expect(momentShareUrl("wonder01", { kind: "legend" })).toMatch(
      /\/player\/wonder01\?moment=legend$/,
    );
    expect(momentShareUrl("wonder01", { kind: "prestige", rank: 3 })).toMatch(
      /\/player\/wonder01\?moment=prestige3$/,
    );
  });

  // The card route answers only level 2..100 and prestige 1..10 (anything
  // else is a 400, unfurling with no image): a slug is in that range or
  // refused, and a refused one has no link.
  it.each([
    [{ kind: "level", level: 1 }, null],
    [{ kind: "level", level: 2 }, "level2"],
    [{ kind: "level", level: 100 }, "level100"],
    [{ kind: "level", level: 101 }, null],
    [{ kind: "level", level: 50.5 }, null],
    [{ kind: "level", level: Number.NaN }, null],
    [{ kind: "prestige", rank: 0 }, null],
    [{ kind: "prestige", rank: 1 }, "prestige1"],
    [{ kind: "prestige", rank: 10 }, "prestige10"],
    [{ kind: "prestige", rank: 11 }, null],
    [{ kind: "prestige", rank: 1.5 }, null],
  ] as const)("slugs %o as %s", (moment, slug) => {
    expect(momentSlug(moment)).toBe(slug);
    expect(momentShareUrl("wonder01", moment)).toBe(
      slug === null ? null : `${playerProfileUrl("wonder01")}?moment=${slug}`,
    );
  });

  it("words the line and the button for each moment", () => {
    expect(momentShareText({ kind: "level", level: 50 })).toBe(
      'progression.share_text_level:{"level":50}',
    );
    expect(momentShareText({ kind: "legend" })).toBe(
      "progression.share_text_legend",
    );
    expect(momentShareText({ kind: "prestige", rank: 3 })).toBe(
      'prestige.share_text:{"rank":3}',
    );
    expect(momentShareLabel({ kind: "level", level: 50 })).toBe(
      'progression.share_moment_level:{"level":50}',
    );
    expect(momentShareLabel({ kind: "legend" })).toBe(
      "progression.share_moment_legend",
    );
  });
});
