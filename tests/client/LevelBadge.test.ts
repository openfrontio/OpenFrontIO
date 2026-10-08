import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../resources/lang/en.json";

vi.mock("../../src/client/Utils", () => ({
  translateText: (key: string, params?: Record<string, string | number>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));

import { GameType } from "@openfront/engine-api/game/GameTypes";
import {
  GameXpResponseSchema,
  type XpBreakdown,
} from "@openfront/shared/ApiSchemas";
import {
  LevelBadge,
  levelBadgeAccent,
  PRISM_GRADIENT_ID,
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

  describe("in a long list", () => {
    let host: HTMLElement | undefined;

    afterEach(() => {
      host?.remove();
      host = undefined;
    });

    async function list(
      rows: Partial<LevelBadge>[],
      parent: ParentNode = document.body,
    ): Promise<LevelBadge[]> {
      host = document.createElement("div");
      const badges = rows.map((props) => {
        const badge = document.createElement("level-badge") as LevelBadge;
        Object.assign(badge, props);
        host!.append(badge);
        return badge;
      });
      parent.append(host);
      await Promise.all(badges.map((b) => b.updateComplete));
      return badges;
    }

    const lobby = (n: number): Partial<LevelBadge>[] =>
      Array.from({ length: n }, (_, i) => ({
        level: 1 + ((i * 37) % 100),
        prestige: i % 11,
        legend: i === 7,
        size: i % 2 === 0 ? 24 : 16,
      }));

    it("defines the prismatic gradient once, not once per badge", async () => {
      const badges = await list(lobby(150));
      const prismatic = badges.filter((b) => b.prestige === 10 && !b.legend);
      expect(prismatic.length).toBeGreaterThan(10);

      expect(document.querySelectorAll("linearGradient")).toHaveLength(1);
      expect(document.querySelectorAll(`#${PRISM_GRADIENT_ID}`)).toHaveLength(
        1,
      );
      expect(document.querySelectorAll("filter")).toHaveLength(0);
      // No badge carries definitions of its own.
      for (const badge of badges) {
        expect(badge.querySelector("defs, linearGradient, filter")).toBeNull();
      }
      // Every prismatic medal points at the shared gradient.
      for (const badge of prismatic) {
        const fills = [...badge.querySelectorAll("circle")].map((c) =>
          c.getAttribute("fill"),
        );
        expect(fills).toContain(`url(#${PRISM_GRADIENT_ID})`);
      }
      // The shared gradient never hides: a gradient under display:none
      // paints nothing in some browsers.
      const defs = document.querySelector("[data-level-badge-defs]")!;
      expect(defs.closest("level-badge")).toBeNull();
      expect(defs.getAttribute("style")).not.toContain("display");
    });

    it("puts the gradient back when the page around it is replaced", async () => {
      await list([{ level: 12, prestige: 10 }]);
      document.body.innerHTML = "";
      host = undefined;
      expect(document.getElementById(PRISM_GRADIENT_ID)).toBeNull();
      await list([{ level: 12, prestige: 10 }]);
      expect(document.querySelectorAll(`#${PRISM_GRADIENT_ID}`)).toHaveLength(
        1,
      );
    });

    it("gives a badge inside a shadow root the gradient there", async () => {
      const outer = document.createElement("div");
      document.body.append(outer);
      const shadow = outer.attachShadow({ mode: "open" });
      try {
        await list(
          [
            { level: 12, prestige: 10 },
            { level: 40, prestige: 10 },
          ],
          shadow,
        );
        // url(#id) resolves within the badge's own tree.
        expect(shadow.querySelectorAll(`#${PRISM_GRADIENT_ID}`)).toHaveLength(
          1,
        );
      } finally {
        outer.remove();
      }
    });

    it("adds no gradient for a list without the last rank", async () => {
      document.body.innerHTML = "";
      await list(lobby(150).filter((p) => p.prestige !== 10));
      expect(document.getElementById(PRISM_GRADIENT_ID)).toBeNull();
    });

    it("shares one drawing between badges of a look, with each its own number", async () => {
      const [a, b, c] = await list([
        { level: 42, prestige: 3, size: 40 },
        { level: 47, prestige: 3, size: 40 },
        { level: 42, prestige: 4, size: 40 },
      ]);
      const texts = (badge: LevelBadge) =>
        [...badge.querySelectorAll("text")].map((t) => t.textContent);
      expect(texts(a)).toEqual([
        "42",
        'progression.prestige_short:{"prestige":3}',
      ]);
      expect(texts(b)).toEqual([
        "47",
        'progression.prestige_short:{"prestige":3}',
      ]);
      expect(texts(c)).toEqual([
        "42",
        'progression.prestige_short:{"prestige":4}',
      ]);
      const shapes = (badge: LevelBadge) => {
        const svg = badge.querySelector("svg")!.cloneNode(true) as Element;
        svg.querySelectorAll("text, title").forEach((t) => t.remove());
        return svg.innerHTML.replace(/<!--[^]*?-->/g, "");
      };
      expect(shapes(a)).toBe(shapes(b));
      expect(shapes(a)).not.toBe(shapes(c));
    });

    it("redraws when a badge's level, rank or size changes", async () => {
      const [badge] = await list([{ level: 9, prestige: 0, size: 24 }]);
      expect(badge.querySelector("svg circle")).not.toBeNull();
      badge.level = 10;
      await badge.updateComplete;
      expect(badge.querySelector("[data-level-frame] rect")).not.toBeNull();
      expect(badge.querySelector("text")?.textContent).toBe("10");
      badge.prestige = 10;
      await badge.updateComplete;
      expect(badge.querySelector("[data-prestige-tab]")).not.toBeNull();
      expect(document.getElementById(PRISM_GRADIENT_ID)).not.toBeNull();
      badge.size = 16;
      await badge.updateComplete;
      expect(badge.querySelector("[data-prestige-tab]")).toBeNull();
    });
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

  it("shows XP no known source accounts for as its own line", () => {
    // A row scored when the first-game bonus was stored as `firstWinOfDay`.
    const parsed = GameXpResponseSchema.parse({
      gameId: "g",
      eligible: true,
      breakdown: {
        played: 50,
        time: 100,
        firstWinOfDay: 200,
        subtotal: 350,
        gamePermille: 1000,
        subscriberPermille: 1000,
        total: 350,
      },
      before: { prestige: 0, level: 1, xpInLevel: 0, xpForNext: 100 },
      after: {
        prestige: 0,
        level: 3,
        xpInLevel: 0,
        xpForNext: 100,
        lifetimeXp: 350,
        legend: false,
        canPrestige: false,
      },
    });
    if (!parsed.eligible) throw new Error("expected eligible");
    expect(visibleXpLines(parsed.breakdown)).toEqual([
      { key: "played", amount: 50 },
      { key: "time", amount: 100 },
      { key: "other", amount: 200 },
    ]);
    expect(en.progression.line_other).toBe("Other");
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

  it("tells a singleplayer game it doesn't earn XP, not that it couldn't be verified", () => {
    expect(ineligibleReasonKey("unverified", GameType.Singleplayer)).toBe(
      "progression.ineligible_singleplayer",
    );
    expect(en.progression.ineligible_singleplayer).toBe(
      "Singleplayer games don't earn XP.",
    );
    // Only that reason: the others say what happened in any game.
    expect(ineligibleReasonKey("too_short", GameType.Singleplayer)).toBe(
      "progression.ineligible_too_short",
    );
    expect(ineligibleReasonKey("unverified", GameType.Public)).toBe(
      "progression.ineligible_unverified",
    );
    expect(ineligibleReasonKey("unverified", null)).toBe(
      "progression.ineligible_unverified",
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
