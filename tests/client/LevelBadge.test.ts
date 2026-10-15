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
import { render as renderTemplate } from "lit";
import {
  LevelBadge,
  levelBadgeAccent,
  loadLargeBadgeIcons,
} from "../../src/client/components/LevelBadge";
import { xpBar } from "../../src/client/components/XpBar";
import {
  apportionXp,
  ineligibleReasonKey,
  LEGEND_COLOR,
  levelFraction,
  levelRewardReasonKey,
  multiplierAmounts,
  multiplierPercent,
  prestigeAccent,
  prestigeTier,
  subscriberTierOf,
  TIER_COLORS,
  visibleMultipliers,
  visibleXpLines,
} from "../../src/client/Progression";

if (!customElements.get("level-badge")) {
  customElements.define("level-badge", LevelBadge);
}

describe("prestige tiers", () => {
  it("gives every rank its own tier, the last one past the art", () => {
    expect(prestigeTier(0)).toBe("none");
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((p) => prestigeTier(p))).toEqual(
      [
        "iron",
        "bronze",
        "silver",
        "gold",
        "platinum",
        "emerald",
        "diamond",
        "master",
        "grandmaster",
        "champion",
      ],
    );
    expect(prestigeTier(12)).toBe("champion");
    expect(prestigeTier(-1)).toBe("none");
    expect(prestigeTier(Number.NaN)).toBe("none");
  });

  it("accents a badge in its tier's colour, Legend in gold", () => {
    expect(prestigeAccent(4, false)).toBe(TIER_COLORS.gold);
    expect(prestigeAccent(6, false)).toBe("#2fd28f");
    expect(prestigeAccent(12, false)).toBe(TIER_COLORS.champion);
    expect(prestigeAccent(3, true)).toBe(LEGEND_COLOR);
    // Before the first prestige: a light slate, like the plate.
    expect(prestigeAccent(0, false)).toBe("#cbd5e1");
    expect(levelBadgeAccent(5, false)).toBe(TIER_COLORS.platinum);
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

  const svgOf = (badge: LevelBadge) => badge.querySelector("svg")!;
  const segments = (badge: LevelBadge, which: "lit" | "unlit") =>
    (
      badge
        .querySelector(`[data-gauge="${which}"]`)
        ?.getAttribute("d")
        ?.match(/M/g) ?? []
    ).length;
  const iconOf = (badge: LevelBadge) => badge.querySelector("use[data-icon]")!;
  const chipOf = (badge: LevelBadge) => badge.querySelector("[data-chip]")!;
  const chipFill = (badge: LevelBadge) =>
    chipOf(badge).querySelector("rect")!.getAttribute("fill");
  // The stops of the shared plate gradient a badge's plate points at.
  const plateStops = (badge: LevelBadge) => {
    const ref = badge.querySelector("[data-plate]")!.getAttribute("fill")!;
    const gradient = document.getElementById(ref.slice("url(#".length, -1));
    expect(gradient).not.toBeNull();
    return [...gradient!.querySelectorAll("stop")].map((s) =>
      s.getAttribute("stop-color"),
    );
  };

  const RANK_ICONS = [
    "hex",
    "city",
    "factory",
    "port",
    "shield",
    "sam",
    "warship",
    "silo",
    "mushroom",
    "mirv",
    "crest",
  ];

  it("draws each rank's unit icon, tier colour and gauge", async () => {
    for (let p = 1; p <= 10; p++) {
      const badge = await render({ level: 42, prestige: p, size: 40 });
      const tier = prestigeTier(p);
      expect(svgOf(badge).getAttribute("data-prestige-tier")).toBe(tier);
      expect(iconOf(badge).getAttribute("data-icon")).toBe(RANK_ICONS[p]);
      // One gauge segment lit per rank, out of ten.
      expect(segments(badge, "lit")).toBe(p);
      expect(segments(badge, "unlit")).toBe(10 - p);
      if (p < 10) {
        expect(chipFill(badge)).toBe(TIER_COLORS[tier]);
        expect(iconOf(badge).getAttribute("fill")).toBe(TIER_COLORS[tier]);
      }
    }
  });

  it("makes Champion's gauge and chip prismatic", async () => {
    const badge = await render({ level: 81, prestige: 10, size: 64 });
    const prism = chipFill(badge)!;
    expect(prism).toMatch(/^url\(#level-badge-prism-/);
    expect(
      badge.querySelector('[data-gauge="lit"]')!.getAttribute("stroke"),
    ).toBe(prism);
    const gradient = document.getElementById(prism.slice(5, -1))!;
    expect(gradient.querySelectorAll("stop").length).toBe(6);
  });

  it("raises the plate's finish with the rank", async () => {
    const sparkles = async (prestige: number) =>
      (await render({ level: 12, prestige, size: 64 })).querySelector(
        "[data-sparkles]",
      ) !== null;
    expect(await sparkles(1)).toBe(false);
    expect(await sparkles(7)).toBe(false);
    expect(await sparkles(8)).toBe(true);
    expect(await sparkles(10)).toBe(true);
    // The top tiers' plates are lit brighter from the top.
    const p7 = plateStops(await render({ level: 12, prestige: 7 }));
    const p8 = plateStops(await render({ level: 12, prestige: 8 }));
    expect(p7[0]).not.toBe(p8[0]);
  });

  it("draws an unprestiged badge on a neutral slate plate", async () => {
    const badge = await render({ level: 18, prestige: 0, size: 64 });
    expect(svgOf(badge).getAttribute("data-prestige-tier")).toBe("none");
    expect(plateStops(badge)).toEqual(["#334155", "#1e293b"]);
    expect(iconOf(badge).getAttribute("data-icon")).toBe("hex");
    expect(iconOf(badge).getAttribute("fill")).toBe("#64748b");
    expect(chipFill(badge)).toBe("#94a3b8");
    expect(segments(badge, "lit")).toBe(0);
    expect(segments(badge, "unlit")).toBe(10);
    expect(svgOf(badge).getAttribute("style") ?? "").not.toContain("filter");
  });

  it("gives Legend a black plate, a gold crown and a full gold gauge", async () => {
    const badge = await render({
      level: 37,
      prestige: 10,
      legend: true,
      size: 40,
    });
    const svg = svgOf(badge);
    expect(svg.getAttribute("data-prestige-tier")).toBe("legend");
    expect(svg.getAttribute("aria-label")).toBe("progression.legend");
    expect(plateStops(badge)).toEqual(["#1c1917", "#0b0b0f"]);
    expect(iconOf(badge).getAttribute("data-icon")).toBe("crown");
    expect(iconOf(badge).getAttribute("fill")).toBe(LEGEND_COLOR);
    expect(segments(badge, "lit")).toBe(10);
    expect(
      badge.querySelector('[data-gauge="lit"]')!.getAttribute("stroke"),
    ).toBe(LEGEND_COLOR);
    // Its chip always reads 100, in gold.
    expect(chipOf(badge).getAttribute("data-chip")).toBe("100");
    expect(chipFill(badge)).toBe(LEGEND_COLOR);
  });

  it("glows at P5, P10 and Legend only", async () => {
    const glows = async (props: Partial<LevelBadge>) =>
      (
        svgOf(await render({ level: 30, size: 40, ...props })).getAttribute(
          "style",
        ) ?? ""
      ).includes("drop-shadow");
    const glowing: number[] = [];
    for (let prestige = 0; prestige <= 10; prestige++) {
      if (await glows({ prestige })) glowing.push(prestige);
    }
    expect(glowing).toEqual([5, 10]);
    expect(await glows({ prestige: 10, legend: true })).toBe(true);
  });

  it("shows the level in the chip, clamped to 1..100", async () => {
    const chipText = async (level: number) =>
      chipOf(await render({ level })).getAttribute("data-chip");
    expect(await chipText(42)).toBe("42");
    expect(await chipText(7)).toBe("7");
    expect(await chipText(150)).toBe("100");
    expect(await chipText(0)).toBe("1");
    expect(await chipText(Number.NaN)).toBe("1");
  });

  it("keeps the chip's digits on whole pixels, larger at larger sizes", async () => {
    const digitPixel = async (size: number) => {
      const d = chipOf(await render({ level: 8, prestige: 2, size }))
        .querySelector("path")!
        .getAttribute("d")!;
      expect(d).not.toMatch(/\d\.\d/);
      return Number(d.match(/v(\d+)/)![1]);
    };
    expect(await digitPixel(24)).toBe(1);
    expect(await digitPixel(64)).toBe(2);
    expect(await digitPixel(120)).toBe(3);
  });

  it("has an accessible name", async () => {
    const svg = svgOf(await render({ level: 42, prestige: 3 }));
    expect(svg.getAttribute("role")).toBe("img");
    expect(svg.getAttribute("aria-label")).toBe(
      'progression.level:{"level":42}, progression.prestige:{"prestige":3}',
    );
    expect(svg.querySelector("title")?.textContent).toBe(
      svg.getAttribute("aria-label"),
    );
    expect(
      svgOf(await render({ level: 42, prestige: 0 })).getAttribute(
        "aria-label",
      ),
    ).toBe('progression.level:{"level":42}');
  });

  it("renders at the requested size, never below 16px", async () => {
    for (const size of [24, 28, 36, 40, 48, 64]) {
      const svg = svgOf(await render({ level: 5, prestige: 4, size }));
      expect(svg.getAttribute("width")).toBe(String(size));
      expect(svg.getAttribute("height")).toBe(String(size));
    }
    const svg = svgOf(await render({ level: 5, size: 8 }));
    expect(svg.getAttribute("width")).toBe("16");
  });

  it("names a rank past the art's last one by its own number", async () => {
    const badge = await render({ level: 12, prestige: 12, size: 40 });
    const svg = svgOf(badge);
    // Drawn as Champion, its gauge full …
    expect(svg.getAttribute("data-prestige-tier")).toBe("champion");
    expect(iconOf(badge).getAttribute("data-icon")).toBe("crest");
    expect(segments(badge, "lit")).toBe(10);
    // … and named by its own rank.
    expect(svg.getAttribute("data-prestige")).toBe("12");
    expect(svg.getAttribute("aria-label")).toBe(
      'progression.level:{"level":12}, progression.prestige:{"prestige":12}',
    );
  });

  it("draws bold silhouettes small and the full icon art large", async () => {
    await loadLargeBadgeIcons();
    const href = async (prestige: number, size: number) =>
      iconOf(await render({ level: 50, prestige, size })).getAttribute("href");
    expect(await href(9, 24)).toBe("#level-badge-s-mirv");
    expect(await href(9, 64)).toBe("#level-badge-l-mirv");
    expect(await href(6, 28)).toBe("#level-badge-s-warship");
    expect(await href(6, 40)).toBe("#level-badge-l-warship");
    // Icons without a silhouette use their art at every size; the shield,
    // its filled outline.
    expect(await href(1, 24)).toBe("#level-badge-i-city");
    expect(await href(4, 64)).toBe("#level-badge-s-shield");
    // Every icon it points at is defined on the page.
    for (const id of [
      "level-badge-s-mirv",
      "level-badge-l-mirv",
      "level-badge-i-city",
    ]) {
      expect(document.getElementById(id)?.tagName).toBe("symbol");
    }
  });

  it("shares one set of definitions between all the badges", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const badges = Array.from({ length: 30 }, (_, i) => {
      const b = document.createElement("level-badge") as LevelBadge;
      b.level = 1 + i;
      b.prestige = i % 11;
      host.append(b);
      return b;
    });
    await Promise.all(badges.map((b) => b.updateComplete));
    expect(document.querySelectorAll("[data-level-badge-defs]").length).toBe(1);
    for (const key of ["0", "5", "10"]) {
      expect(
        document.querySelectorAll(`[id="level-badge-plate-${key}"]`).length,
      ).toBe(1);
    }
    // No ids inside the badges themselves.
    expect(host.querySelector("[id]")).toBeNull();
    host.remove();
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

describe("xpBar", () => {
  function bar(percent: number): { now: string | null; width: string } {
    const host = document.createElement("div");
    renderTemplate(xpBar(percent), host);
    const fill = host.querySelector<HTMLElement>("[data-xp-bar-fill]")!;
    return {
      now: host.querySelector("[data-xp-bar]")!.getAttribute("aria-valuenow"),
      width: fill.style.width,
    };
  }

  it("keeps the fill and value within 0..100", () => {
    expect(bar(42)).toEqual({ now: "42", width: "42%" });
    expect(bar(150)).toEqual({ now: "100", width: "100%" });
    expect(bar(-20)).toEqual({ now: "0", width: "0%" });
  });

  it("draws an empty bar for a non-number", () => {
    expect(bar(Number.NaN)).toEqual({ now: "0", width: "0%" });
    expect(bar(Number.POSITIVE_INFINITY)).toEqual({ now: "0", width: "0%" });
  });
});
