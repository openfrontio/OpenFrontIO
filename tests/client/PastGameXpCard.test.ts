import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/Utils", () => ({
  translateText: (key: string, params?: Record<string, string | number>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));

import { GameType } from "@openfront/engine-api/game/GameTypes";
import {
  type GameXpEligible,
  GameXpResponseSchema,
} from "@openfront/shared/ApiSchemas";
import {
  PastGameXpCard,
  type PastGameXpView,
} from "../../src/client/components/PastGameXpCard";

if (!customElements.get("past-game-xp-card")) {
  customElements.define("past-game-xp-card", PastGameXpCard);
}

// A win with a Vanguard boost that takes the player from 46 to 47.
const levelUp: GameXpEligible = {
  gameId: "g1",
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
  before: { prestige: 3, level: 46, xpInLevel: 1550, xpForNext: 2210 },
  after: {
    prestige: 3,
    level: 47,
    xpInLevel: 444,
    xpForNext: 2260,
    lifetimeXp: 125_400,
    legend: false,
    canPrestige: false,
  },
  levelsReached: [{ prestige: 3, level: 47 }],
};

const milestone: GameXpEligible = {
  ...levelUp,
  before: { prestige: 3, level: 49, xpInLevel: 1700, xpForNext: 2360 },
  after: { ...levelUp.after, level: 50, xpForNext: 2410 },
  levelsReached: [{ prestige: 3, level: 50 }],
};

const noLevelUp: GameXpEligible = {
  ...levelUp,
  breakdown: {
    ...levelUp.breakdown,
    time: 190,
    placement: 20,
    win: 0,
    firstGame: 0,
    subtotal: 260,
    total: 325,
  },
  before: { prestige: 3, level: 47, xpInLevel: 444, xpForNext: 2260 },
  after: { ...levelUp.after, xpInLevel: 769 },
  levelsReached: [],
};

let card: PastGameXpCard | null = null;

async function mount(
  view: PastGameXpView,
  gameType: GameType | null = null,
): Promise<PastGameXpCard> {
  card = document.createElement("past-game-xp-card") as PastGameXpCard;
  card.view = view;
  card.gameType = gameType;
  document.body.appendChild(card);
  await card.updateComplete;
  return card;
}

function q(selector: string): Element | null {
  return card!.querySelector(selector);
}

function stateOf(): string | null {
  return q("[data-past-xp]")?.getAttribute("data-past-xp-state") ?? null;
}

afterEach(() => {
  card?.remove();
  card = null;
});

describe("<past-game-xp-card>", () => {
  it("renders nothing while hidden", async () => {
    await mount({ kind: "hidden" });
    expect(q("[data-past-xp]")).toBeNull();
  });

  it("(a) shows the total, the level change and each source at its base value", async () => {
    await mount({ kind: "result", data: levelUp });
    expect(stateOf()).toBe("result");
    expect(q("[data-past-xp-total]")!.textContent).toContain(
      'progression.xp_total:{"xp":"1,150"}',
    );
    const change = q("[data-past-xp-levelup]")!;
    expect(change.getAttribute("data-past-xp-levelup")).toBe("47");
    expect(change.textContent).toContain(
      'progression.level_change:{"from":46,"to":47}',
    );
    const badges = [...change.querySelectorAll("level-badge")] as (Element & {
      level: number;
    })[];
    expect(badges.map((b) => b.level)).toEqual([46, 47]);
    // Base values, not shares of the boosted total.
    const lines = [...card!.querySelectorAll("[data-past-xp-line]")].map(
      (l) => [l.getAttribute("data-past-xp-line"), l.textContent!.trim()],
    );
    expect(lines).toEqual([
      ["played", expect.stringContaining('progression.xp_plus:{"xp":"50"}')],
      ["time", expect.stringContaining('progression.xp_plus:{"xp":"280"}')],
      ["placement", expect.stringContaining('progression.xp_plus:{"xp":"90"}')],
      ["win", expect.stringContaining('progression.xp_plus:{"xp":"300"}')],
      [
        "firstGame",
        expect.stringContaining('progression.xp_plus:{"xp":"200"}'),
      ],
    ]);
    // No milestone, no chip.
    expect(q("[data-past-xp-milestone]")).toBeNull();
  });

  it("lays the sources out in three columns, stacking on a phone", async () => {
    await mount({ kind: "result", data: levelUp });
    const grid = q("[data-past-xp-lines]")!;
    expect(grid.classList).toContain("grid-cols-1");
    expect(grid.classList).toContain("sm:grid-cols-3");
  });

  it("gives the subscriber boost its own line, so the lines add up to the total", async () => {
    await mount({ kind: "result", data: levelUp });
    const boost = q('[data-past-xp-multiplier="subscriber"]')!;
    expect(boost.getAttribute("data-xp-tier")).toBe("vanguard");
    expect(boost.textContent).toContain("progression.bonus_line");
    expect(
      boost.querySelector("[data-past-xp-multiplier-amount]")!.textContent,
    ).toBe('progression.xp_plus:{"xp":"230"}');
    // 50 + 280 + 90 + 300 + 200 + 230 = 1,150.
  });

  it("shows a game-type cut with its amount when it is the only multiplier", async () => {
    await mount({
      kind: "result",
      data: {
        ...noLevelUp,
        breakdown: {
          ...noLevelUp.breakdown,
          gamePermille: 500,
          subscriberPermille: 1000,
          total: 130,
        },
      },
    });
    expect(q('[data-past-xp-multiplier="subscriber"]')).toBeNull();
    const cut = q('[data-past-xp-multiplier="game"]')!;
    expect(cut.textContent).toContain("progression.penalty_line");
    expect(
      cut.querySelector("[data-past-xp-multiplier-amount]")!.textContent,
    ).toBe('progression.xp_minus:{"xp":"130"}');
  });

  it("leaves the amounts off when both multipliers apply, rather than guess the split", async () => {
    await mount({
      kind: "result",
      data: {
        ...noLevelUp,
        breakdown: {
          ...noLevelUp.breakdown,
          gamePermille: 500,
          subscriberPermille: 2000,
          total: 260,
        },
      },
    });
    expect(q('[data-past-xp-multiplier="game"]')).not.toBeNull();
    expect(q('[data-past-xp-multiplier="subscriber"]')).not.toBeNull();
    expect(q("[data-past-xp-multiplier-amount]")).toBeNull();
  });

  it("shows no multiplier line without a multiplier", async () => {
    await mount({
      kind: "result",
      data: {
        ...noLevelUp,
        breakdown: {
          ...noLevelUp.breakdown,
          subscriberPermille: 1000,
          total: 260,
        },
      },
    });
    expect(q("[data-past-xp-multiplier]")).toBeNull();
  });

  it("marks a milestone level with a chip and a glow", async () => {
    await mount({ kind: "result", data: milestone });
    expect(q("[data-past-xp-milestone]")!.textContent!.trim()).toBe(
      "progression.milestone_chip",
    );
    expect(q("[data-past-xp-new-badge]")!.className).toContain("shadow-");
  });

  it("(b) without a level-up, shows the level and the progress through it", async () => {
    await mount({ kind: "result", data: noLevelUp });
    expect(q("[data-past-xp-levelup]")).toBeNull();
    const level = q("[data-past-xp-level]")!;
    expect(level.textContent).toContain('progression.level:{"level":47}');
    expect(level.textContent).toContain(
      'progression.xp_progress:{"current":"769","next":"2,260"}',
    );
    expect(q("[data-past-xp-new-badge]")).toBeNull();
  });

  it("(c) shows a spinner while calculating", async () => {
    await mount({ kind: "calculating" });
    expect(stateOf()).toBe("calculating");
    expect(q("[data-past-xp-note]")!.textContent).toBe(
      "progression.calculating",
    );
    expect(q(".animate-spin")).not.toBeNull();
  });

  it("(d) says why a game didn't earn XP, in one line", async () => {
    await mount({
      kind: "result",
      data: { gameId: "g1", eligible: false, reason: "too_short" },
    });
    expect(stateOf()).toBe("ineligible");
    expect(q("[data-past-xp-note]")!.textContent).toBe(
      "progression.ineligible_too_short",
    );
    expect(q("[data-past-xp-total]")).toBeNull();
  });

  it("(e) says a game was played before levels existed", async () => {
    await mount({
      kind: "result",
      data: { gameId: "g1", eligible: false, reason: "before_progression" },
    });
    expect(stateOf()).toBe("before_levels");
    expect(q("[data-past-xp-note]")!.textContent).toBe(
      "progression.xp_before_levels",
    );
  });

  it("tells a singleplayer game it doesn't earn XP, not that it couldn't be verified", async () => {
    const unverified = {
      gameId: "g1",
      eligible: false as const,
      reason: "unverified",
    };
    await mount({ kind: "result", data: unverified }, GameType.Singleplayer);
    expect(q("[data-past-xp-note]")!.textContent).toBe(
      "progression.ineligible_singleplayer",
    );
    card!.remove();
    await mount({ kind: "result", data: unverified }, GameType.Private);
    expect(q("[data-past-xp-note]")!.textContent).toBe(
      "progression.ineligible_unverified",
    );
  });

  it("shows XP no known source accounts for as its own line, so the lines add up", async () => {
    // Scored when the first-game bonus was stored as `firstWinOfDay`.
    const legacy = GameXpResponseSchema.parse({
      ...noLevelUp,
      breakdown: {
        played: 50,
        time: 100,
        firstWinOfDay: 200,
        subtotal: 350,
        gamePermille: 1000,
        subscriberPermille: 1000,
        total: 350,
      },
    });
    await mount({ kind: "result", data: legacy });
    const lines = [...card!.querySelectorAll("[data-past-xp-line]")].map(
      (l) => [l.getAttribute("data-past-xp-line"), l.textContent!.trim()],
    );
    expect(lines).toEqual([
      ["played", expect.stringContaining('progression.xp_plus:{"xp":"50"}')],
      ["time", expect.stringContaining('progression.xp_plus:{"xp":"100"}')],
      ["other", expect.stringContaining('progression.xp_plus:{"xp":"200"}')],
    ]);
    expect(lines[2][1]).toContain("progression.line_other");
  });
  it("notes a game the player left early", async () => {
    await mount({
      kind: "result",
      data: {
        ...noLevelUp,
        breakdown: { ...noLevelUp.breakdown, leftEarly: true },
      },
    });
    expect(q("[data-past-xp-left-early]")).not.toBeNull();
  });
});
