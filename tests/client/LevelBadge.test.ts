import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../resources/lang/en.json";

vi.mock("../../src/client/Utils", () => ({
  translateText: (key: string, params?: Record<string, string | number>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));

import {
  LevelBadge,
  levelBadgeAccent,
  WINGED_MARGIN,
} from "../../src/client/components/LevelBadge";
import {
  apportionXp,
  ineligibleReasonKey,
  levelBand,
  levelFraction,
  levelRewardReasonKey,
  multiplierAmounts,
  multiplierPercent,
  prestigeAccent,
  prestigeStyle,
  subscriberTierOf,
  visibleMultipliers,
  visibleXpLines,
} from "../../src/client/Progression";
import type { XpBreakdown } from "../../src/core/ApiSchemas";

if (!customElements.get("level-badge")) {
  customElements.define("level-badge", LevelBadge);
}

describe("levelBand", () => {
  it("groups levels in tens, with level 100 on its own", () => {
    expect(levelBand(1)).toBe(0);
    expect(levelBand(9)).toBe(0);
    expect(levelBand(10)).toBe(1);
    expect(levelBand(19)).toBe(1);
    expect(levelBand(20)).toBe(2);
    expect(levelBand(55)).toBe(5);
    expect(levelBand(90)).toBe(9);
    expect(levelBand(99)).toBe(9);
    expect(levelBand(100)).toBe(10);
  });

  it("clamps surprising input to a drawable band", () => {
    expect(levelBand(0)).toBe(0);
    expect(levelBand(-5)).toBe(0);
    expect(levelBand(150)).toBe(10);
    expect(levelBand(Number.NaN)).toBe(0);
  });
});

describe("<level-badge>", () => {
  let el: LevelBadge | undefined;

  afterEach(() => {
    el?.remove();
    el = undefined;
  });

  async function render(props: Partial<LevelBadge>): Promise<LevelBadge> {
    el?.remove();
    el = document.createElement("level-badge") as LevelBadge;
    Object.assign(el, props);
    document.body.appendChild(el);
    await el.updateComplete;
    return el;
  }

  // An element's markup without Lit's comment markers, which differ between
  // renders of the same template. Removed as nodes, not by pattern.
  function markupWithoutComments(el: Element): string {
    const clone = el.cloneNode(true) as Element;
    const walker = document.createTreeWalker(clone, NodeFilter.SHOW_COMMENT);
    const comments: Node[] = [];
    while (walker.nextNode()) comments.push(walker.currentNode);
    for (const comment of comments) comment.parentNode?.removeChild(comment);
    return clone.innerHTML;
  }

  // The frame's outline, as markup — two bands with the same outline would
  // differ only by colour, which colour-blind players can't rely on.
  async function frameShape(level: number): Promise<string> {
    const badge = await render({ level });
    const frame = badge.querySelector("svg > g");
    expect(frame).not.toBeNull();
    return markupWithoutComments(frame!).replace(/\s+/g, " ").trim();
  }

  it("draws a differently shaped frame for every band", async () => {
    const levels = [1, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    const shapes = new Set<string>();
    for (const level of levels) shapes.add(await frameShape(level));
    expect(shapes.size).toBe(levels.length);
  });

  it("keeps one frame within a band", async () => {
    expect(await frameShape(40)).toBe(await frameShape(49));
  });

  it("shows the level number and an accessible name", async () => {
    const badge = await render({ level: 42 });
    const svg = badge.querySelector("svg")!;
    expect(svg.querySelector("text")?.textContent).toBe("42");
    expect(svg.getAttribute("aria-label")).toBe(
      'progression.level:{"level":42}',
    );
    expect(svg.getAttribute("data-level-band")).toBe("4");
  });

  it("renders at the requested size, never below 16px", async () => {
    let badge = await render({ level: 5, size: 48 });
    expect(badge.querySelector("svg")?.getAttribute("width")).toBe("48");
    badge = await render({ level: 5, size: 8 });
    expect(badge.querySelector("svg")?.getAttribute("width")).toBe("16");
  });

  const tierOf = async (props: Partial<LevelBadge>) =>
    (await render(props))
      .querySelector("svg")
      ?.getAttribute("data-prestige-tier");

  const RANK_IDS = [
    "bronze",
    "silver",
    "jade",
    "sapphire",
    "amethyst",
    "crimson",
    "ember",
    "gold",
    "diamond",
    "prismatic",
  ];

  it("gives every prestige rank its own style", async () => {
    expect(await tierOf({ level: 12, prestige: 0 })).toBe("none");
    for (let p = 1; p <= 10; p++) {
      expect(await tierOf({ level: 12, prestige: p })).toBe(RANK_IDS[p - 1]);
    }
    // Out-of-range ranks clamp to a drawable one.
    expect(await tierOf({ level: 12, prestige: 14 })).toBe("prismatic");

    // Outline, not just colour: with every colour stripped, each rank's
    // markup still differs.
    const markup = new Set<string>();
    for (let p = 1; p <= 10; p++) {
      const badge = await render({ level: 12, prestige: p, size: 16 });
      markup.add(
        markupWithoutComments(badge.querySelector("svg")!)
          .replace(/(class|fill|stroke|style|id|data-[a-z-]+)="[^"]*"/g, "")
          .replace(/url\(#[^)]*\)/g, ""),
      );
    }
    expect(markup.size).toBe(10);
  });

  it("colours each rank on its own, and its glow on the milestone ranks", async () => {
    const colours = new Set<string>();
    for (let p = 1; p <= 10; p++) {
      const style = prestigeStyle(p)!;
      expect(style.rank).toBe(p);
      colours.add(style.base);
      // Milestone ranks (P5, P10) glow and have wings; no other rank does.
      expect(style.milestone).toBe(p === 5 || p === 10);
      expect(style.glow !== null).toBe(p === 5 || p === 10);
      expect(style.winged).toBe(p === 5 || p === 10);
      const svg = (await render({ level: 12, prestige: p })).querySelector(
        "svg",
      )!;
      expect((svg.getAttribute("style") ?? "").includes("drop-shadow")).toBe(
        p === 5 || p === 10,
      );
    }
    expect(colours.size).toBe(10);
    expect(prestigeStyle(0)).toBeNull();
    expect(prestigeAccent(0)).toBe("#facc15");
    expect(prestigeAccent(5)).toBe("#c084fc");
  });

  it("draws no rank gems: the outline says the rank", async () => {
    for (const prestige of [0, 1, 2, 3, 4, 7, 10]) {
      const badge = await render({ level: 12, prestige, size: 16 });
      expect(badge.querySelectorAll("[data-rank-gem]").length).toBe(0);
    }
  });

  it("tints the level frame to the rank only once prestiged", async () => {
    const frame = async (prestige: number) =>
      (await render({ level: 42, prestige, size: 40 })).querySelector(
        "[data-level-frame]",
      )!;
    // P0: the level band's own colours.
    let g = await frame(0);
    expect(g.getAttribute("class")).toContain("fill-blue-700");
    expect(g.getAttribute("fill")).toBeNull();
    // Prestiged: the band's shape in the rank's colours.
    for (const p of [1, 4, 10]) {
      g = await frame(p);
      const style = prestigeStyle(p)!;
      expect(g.getAttribute("class")).toBeNull();
      expect(g.getAttribute("fill")).toBe(style.frame);
      expect(g.getAttribute("stroke")).toBe(style.light);
      expect(g.querySelector("polygon")?.getAttribute("points")).toBe(
        "16,1.5 29,9 29,23 16,30.5 3,23 3,9",
      );
    }
    // The number stays white with its dark outline.
    const text = (await render({ level: 42, prestige: 6 })).querySelector(
      "text",
    )!;
    expect(text.getAttribute("class")).toBe("fill-white");
    expect(text.getAttribute("stroke")).toBe("rgb(0 0 0 / 0.55)");
  });

  it("tints the numeral tab to the rank", async () => {
    const badge = await render({ level: 12, prestige: 6, size: 40 });
    const tab = badge.querySelector("[data-prestige-tab]")!;
    expect(tab.getAttribute("stroke")).toBe(prestigeStyle(6)!.light);
    const label = [...badge.querySelectorAll("text")].find((t) =>
      t.textContent?.includes("prestige_short"),
    )!;
    expect(label.getAttribute("fill")).toBe(prestigeStyle(6)!.light);
  });

  it("gives winged ranks side margin, so the wings never touch a name", async () => {
    const svgOf = async (prestige: number, size: number) =>
      (await render({ level: 12, prestige, size })).querySelector("svg")!;
    for (const size of [24, 28, 64]) {
      const margin = `${Math.round(size * WINGED_MARGIN)}px`;
      for (const p of [5, 10]) {
        const svg = await svgOf(p, size);
        expect(svg.getAttribute("data-winged")).toBe("true");
        expect(svg.style.marginLeft).toBe(margin);
        expect(svg.style.marginRight).toBe(margin);
      }
      for (const p of [0, 1, 4, 6, 9]) {
        const svg = await svgOf(p, size);
        expect(svg.getAttribute("data-winged")).toBeNull();
        expect(svg.style.marginLeft).toBe("");
      }
    }
    expect(WINGED_MARGIN).toBeCloseTo(0.12);
  });

  it("uses the rank's colour for the badge's accent", () => {
    expect(levelBadgeAccent(42, false)).toBe("#93c5fd");
    expect(levelBadgeAccent(42, false, 0)).toBe("#93c5fd");
    expect(levelBadgeAccent(42, false, 3)).toBe("#34d399");
    expect(levelBadgeAccent(42, false, 10)).toBe("#f472b6");
    expect(levelBadgeAccent(100, true, 10)).toBe("#facc15");
  });

  it("labels the rank where there is room, and always in the name", async () => {
    let badge = await render({ level: 12, prestige: 3, size: 40 });
    const texts = [...badge.querySelectorAll("text")].map((t) => t.textContent);
    expect(texts).toEqual(["12", 'progression.prestige_short:{"prestige":3}']);
    expect(badge.querySelector("svg")?.getAttribute("aria-label")).toContain(
      "progression.prestige",
    );

    badge = await render({ level: 12, prestige: 3, size: 16 });
    expect(
      [...badge.querySelectorAll("text")].map((t) => t.textContent),
    ).toEqual(["12"]);
  });

  it("gives Legend its own look: the crown on a gold halo, gems on its points", async () => {
    const badge = await render({
      level: 100,
      prestige: 10,
      legend: true,
      size: 40,
    });
    const svg = badge.querySelector("svg")!;
    expect(svg.getAttribute("data-level-band")).toBe("legend");
    expect(svg.getAttribute("data-prestige-tier")).toBe("none");
    expect(svg.getAttribute("aria-label")).toBe("progression.legend");
    expect(svg.querySelector("text")).toBeNull();
    expect(svg.querySelector("[data-legend-halo]")).not.toBeNull();
    expect(svg.querySelectorAll("[data-legend-gem]").length).toBe(3);
    // A stronger glow than any rank's, and no wings to make room for.
    expect(svg.getAttribute("style")).toContain("rgba(250,204,21,0.85)");
    expect(svg.getAttribute("data-winged")).toBeNull();
  });
});

describe("progression helpers", () => {
  const breakdown: XpBreakdown = {
    leftEarly: false,
    played: 50,
    time: 0,
    placement: 25,
    win: 0,
    firstGame: 100,
    feats: 0,
    subtotal: 175,
    gamePermille: 1000,
    subscriberPermille: 1250,
    total: 218,
  };

  it("lists only the non-zero breakdown lines, in order", () => {
    expect(visibleXpLines(breakdown)).toEqual([
      { key: "played", amount: 50 },
      { key: "placement", amount: 25 },
      { key: "firstGame", amount: 100 },
    ]);
  });

  it("lists only the multipliers that are not 1x", () => {
    expect(visibleMultipliers(breakdown)).toEqual([
      { key: "subscriber", permille: 1250 },
    ]);
    expect(
      visibleMultipliers({ ...breakdown, gamePermille: 250 }).map((m) => m.key),
    ).toEqual(["game", "subscriber"]);
  });

  it("gives a multiplier its exact amount only when it is the only one", () => {
    // The boost alone: what it added is total − subtotal.
    expect(multiplierAmounts(breakdown)).toEqual([
      { key: "subscriber", permille: 1250, amount: 43 },
    ]);
    // A game-type cut alone, the same way (negative).
    expect(
      multiplierAmounts({
        ...breakdown,
        gamePermille: 500,
        subscriberPermille: 1000,
        total: 88,
      }),
    ).toEqual([{ key: "game", permille: 500, amount: -87 }]);
    // Both: the API rounds once over the product, so how much each added
    // depends on an order it doesn't record. No amounts, not a guess.
    expect(
      multiplierAmounts({
        ...breakdown,
        gamePermille: 500,
        subscriberPermille: 2000,
        total: 175,
      }),
    ).toEqual([
      { key: "game", permille: 500, amount: null },
      { key: "subscriber", permille: 2000, amount: null },
    ]);
    expect(
      multiplierAmounts({ ...breakdown, subscriberPermille: 1000 }),
    ).toEqual([]);
  });

  it("formats permille multipliers", () => {
    expect(multiplierPercent(1200)).toBe(20);
    expect(multiplierPercent(1250)).toBe(25);
    expect(multiplierPercent(1125)).toBe(12.5);
    expect(multiplierPercent(500)).toBe(-50);
    expect(multiplierPercent(1000)).toBe(0);
  });

  it("recognises the subscription tiers by their XP boost", () => {
    expect(subscriberTierOf(2000)?.tier).toBe("sovereign");
    expect(subscriberTierOf(1500)?.tier).toBe("warlord");
    expect(subscriberTierOf(1250)?.tier).toBe("vanguard");
    // Anything else is a plain subscriber bonus, the old multipliers too.
    expect(subscriberTierOf(1300)).toBeNull();
    expect(subscriberTierOf(1200)).toBeNull();
    expect(subscriberTierOf(1000)).toBeNull();
  });

  it("splits a multiplied award across the sources, adding up exactly", () => {
    // 170 x1.25 = 212.5, awarded as 212.
    const split = apportionXp([50, 20, 100], 212);
    expect(split.reduce((a, b) => a + b, 0)).toBe(212);
    expect(split).toEqual([62, 25, 125]);
    // No multiplier: the sources as they are.
    expect(apportionXp([50, 340, 90], 480)).toEqual([50, 340, 90]);
    // A cut.
    expect(apportionXp([50, 50], 25)).toEqual([13, 12]);
    expect(apportionXp([0, 0], 10)).toEqual([0, 0]);
    expect(apportionXp([10, 20], 0)).toEqual([0, 0]);
  });

  it("measures progress through a level, full at the cap", () => {
    expect(levelFraction(50, 200)).toBe(0.25);
    expect(levelFraction(0, 0)).toBe(1);
    expect(levelFraction(500, 200)).toBe(1);
  });

  it("maps ineligible reasons, unknown ones to the generic line", () => {
    expect(ineligibleReasonKey("too_short")).toBe(
      "progression.ineligible_too_short",
    );
    expect(ineligibleReasonKey("brand_new_reason")).toBe(
      "progression.ineligible_generic",
    );
    expect(ineligibleReasonKey("constructor")).toBe(
      "progression.ineligible_generic",
    );
  });

  it("explains a game whose stats the votes did not agree on", () => {
    const key = ineligibleReasonKey("unverified");
    expect(key).toBe("progression.ineligible_unverified");
    expect(en.progression.ineligible_unverified).toBe(
      "This game's results couldn't be verified, so it didn't earn XP.",
    );
  });

  it("explains a game played before levels existed", () => {
    expect(ineligibleReasonKey("before_progression")).toBe(
      "progression.xp_before_levels",
    );
    expect(en.progression.xp_before_levels).toBe(
      "Played before levels existed, so there's no XP for this game.",
    );
  });

  it("maps only the level reward reasons", () => {
    expect(levelRewardReasonKey("level_up")).toBe(
      "account_modal.reward_level_up",
    );
    expect(levelRewardReasonKey("subscription_daily")).toBeUndefined();
    expect(levelRewardReasonKey("toString")).toBeUndefined();
  });
});
