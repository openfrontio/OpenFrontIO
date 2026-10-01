import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/Utils", () => ({
  translateText: (key: string, params?: Record<string, string | number>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));

import { LevelBadge } from "../../src/client/components/LevelBadge";
import {
  apportionXp,
  ineligibleReasonKey,
  levelBand,
  levelFraction,
  levelRewardReasonKey,
  multiplierPercent,
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

  it("draws a prestige emblem whose shape changes by rank group", async () => {
    expect(await tierOf({ level: 12, prestige: 0 })).toBe("none");
    expect(await tierOf({ level: 12, prestige: 1 })).toBe("ring");
    expect(await tierOf({ level: 12, prestige: 3 })).toBe("ring");
    expect(await tierOf({ level: 12, prestige: 4 })).toBe("double");
    expect(await tierOf({ level: 12, prestige: 7 })).toBe("sunburst");
    expect(await tierOf({ level: 12, prestige: 10 })).toBe("radiant");

    // Shape, not just colour: every tier's markup differs.
    const markup = new Set<string>();
    for (const prestige of [1, 4, 7, 10]) {
      const badge = await render({ level: 12, prestige, size: 16 });
      markup.add(
        markupWithoutComments(badge.querySelector("svg")!).replace(
          /class="[^"]*"/g,
          "",
        ),
      );
    }
    expect(markup.size).toBe(4);
  });

  it("tells ranks within a group apart with one to three gems", async () => {
    const gems = async (prestige: number, size = 16) =>
      (await render({ level: 12, prestige, size })).querySelectorAll(
        "[data-rank-gem]",
      ).length;
    expect(await gems(0)).toBe(0);
    expect([await gems(1), await gems(2), await gems(3)]).toEqual([1, 2, 3]);
    expect([await gems(4), await gems(5), await gems(6)]).toEqual([1, 2, 3]);
    expect([await gems(7), await gems(8), await gems(9)]).toEqual([1, 2, 3]);
    // The last rank is its own group, told apart by its silhouette.
    expect(await gems(10)).toBe(0);
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

  it("gives Legend its own look", async () => {
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
  });
});

describe("progression helpers", () => {
  const breakdown: XpBreakdown = {
    leftEarly: false,
    played: 50,
    time: 0,
    placement: 25,
    win: 0,
    firstWin: 100,
    feats: 0,
    subtotal: 175,
    gamePermille: 1000,
    subscriberPermille: 1200,
    total: 210,
  };

  it("lists only the non-zero breakdown lines, in order", () => {
    expect(visibleXpLines(breakdown)).toEqual([
      { key: "played", amount: 50 },
      { key: "placement", amount: 25 },
      { key: "firstWin", amount: 100 },
    ]);
  });

  it("lists only the multipliers that are not 1x", () => {
    expect(visibleMultipliers(breakdown)).toEqual([
      { key: "subscriber", permille: 1200 },
    ]);
    expect(
      visibleMultipliers({ ...breakdown, gamePermille: 250 }).map((m) => m.key),
    ).toEqual(["game", "subscriber"]);
  });

  it("formats permille multipliers", () => {
    expect(multiplierPercent(1200)).toBe(20);
    expect(multiplierPercent(1250)).toBe(25);
    expect(multiplierPercent(1125)).toBe(12.5);
    expect(multiplierPercent(500)).toBe(-50);
    expect(multiplierPercent(1000)).toBe(0);
  });

  it("recognises the subscription tiers by their XP boost", () => {
    expect(subscriberTierOf(1500)?.tier).toBe("sovereign");
    expect(subscriberTierOf(1300)?.tier).toBe("warlord");
    expect(subscriberTierOf(1200)?.tier).toBe("vanguard");
    // Anything else is a plain subscriber bonus.
    expect(subscriberTierOf(1250)).toBeNull();
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

  it("maps only the level reward reasons", () => {
    expect(levelRewardReasonKey("level_up")).toBe(
      "account_modal.reward_level_up",
    );
    expect(levelRewardReasonKey("subscription_daily")).toBeUndefined();
    expect(levelRewardReasonKey("toString")).toBeUndefined();
  });
});
