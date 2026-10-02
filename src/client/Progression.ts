import type { XpBreakdown } from "../core/ApiSchemas";

// Pure helpers behind the level / XP UI. No DOM, no fetches — so the rules the
// components follow are unit-testable on their own.

export const MAX_LEVEL = 100;
export const MAX_PRESTIGE = 10;

/**
 * The level band a badge frame is drawn from: 0 for levels 1–9, 1 for 10–19,
 * … 9 for 90–99, and 10 for level 100 alone. Out-of-range input is clamped so
 * a surprising server value still draws a frame.
 */
export function levelBand(level: number): number {
  if (!Number.isFinite(level)) return 0;
  const clamped = Math.min(MAX_LEVEL, Math.max(1, Math.floor(level)));
  if (clamped >= MAX_LEVEL) return 10;
  return Math.floor(clamped / 10);
}

export function clampPrestige(prestige: number): number {
  if (!Number.isFinite(prestige)) return 0;
  return Math.min(MAX_PRESTIGE, Math.max(0, Math.floor(prestige)));
}

/**
 * The prestige emblem drawn around a badge. Each tier is a different SHAPE,
 * not just a colour (colour-blind players): a ring, a double ring, a
 * sunburst, and a denser glowing burst for the last rank.
 */
export type PrestigeTier = "none" | "ring" | "double" | "sunburst" | "radiant";

export function prestigeTier(prestige: number): PrestigeTier {
  const p = clampPrestige(prestige);
  if (p === 0) return "none";
  if (p <= 3) return "ring";
  if (p <= 6) return "double";
  if (p <= 9) return "sunburst";
  return "radiant";
}

// Levels called out when reached: the end-of-game XP panel gives one reached
// this game its own "new milestone" card (100 is the Legend card at the last
// prestige).
export const MILESTONE_LEVELS: readonly number[] = [10, 25, 50, 75, 100];

export function isMilestoneLevel(level: number): boolean {
  return MILESTONE_LEVELS.includes(level);
}

interface LevelReachedLike {
  prestige: number;
  level: number;
}

/**
 * The levels one game crossed, for the level-up celebration. A game never
 * changes prestige (that is an opt-in reset, done from the profile), so an
 * entry at another prestige is dropped rather than celebrated as a level-up.
 */
export function levelsReachedInGame(data: {
  before: { prestige: number };
  levelsReached: readonly LevelReachedLike[];
}): LevelReachedLike[] {
  return data.levelsReached.filter((l) => l.prestige === data.before.prestige);
}

/** True when this game is the one that made the player a Legend. */
export function reachedLegendThisGame(data: {
  before: { prestige: number };
  after: { legend: boolean };
  levelsReached: readonly LevelReachedLike[];
}): boolean {
  return (
    data.after.legend &&
    levelsReachedInGame(data).some((l) => l.level === MAX_LEVEL)
  );
}

/**
 * How far through the current level, 0..1. A level with nothing left to earn
 * (level 100, `xpForNext` 0) reads as full.
 */
export function levelFraction(xpInLevel: number, xpForNext: number): number {
  if (!(xpForNext > 0)) return 1;
  const fraction = xpInLevel / xpForNext;
  if (!Number.isFinite(fraction)) return 0;
  return Math.min(1, Math.max(0, fraction));
}

export type SubscriberTier = "sovereign" | "warlord" | "vanguard";

// The subscription tiers' XP boosts, highest first, in their Discord role
// colours (a gradient, from → to). The game is told only the multiplier, so
// the tier is recognised by it: these must match the multipliers set on the
// tiers in the admin panel. A multiplier not listed here still shows, as a
// plain subscriber bonus.
export const SUBSCRIBER_TIERS: readonly {
  tier: SubscriberTier;
  permille: number;
  colors: readonly [string, string];
}[] = [
  { tier: "sovereign", permille: 1500, colors: ["#ffc713", "#ffde90"] },
  { tier: "warlord", permille: 1300, colors: ["#4cadd0", "#b2f9ff"] },
  { tier: "vanguard", permille: 1200, colors: ["#369876", "#71ff9e"] },
];

/** The subscription tier a subscriber multiplier belongs to, if it's one. */
export function subscriberTierOf(permille: number) {
  return SUBSCRIBER_TIERS.find((t) => t.permille === permille) ?? null;
}

/** A permille multiplier as a percentage change: 1200 → 20, 500 → -50. */
export function multiplierPercent(permille: number): number {
  return Math.round(permille - 1000) / 10;
}

export type XpLineKey =
  | "played"
  | "time"
  | "placement"
  | "win"
  | "firstWin"
  | "feats";

export const XP_LINE_KEYS: readonly XpLineKey[] = [
  "played",
  "time",
  "placement",
  "win",
  "firstWin",
  "feats",
];

/** The breakdown lines worth showing: the non-zero ones, in a fixed order. */
export function visibleXpLines(
  breakdown: XpBreakdown,
): { key: XpLineKey; amount: number }[] {
  return XP_LINE_KEYS.map((key) => ({ key, amount: breakdown[key] })).filter(
    (line) => line.amount !== 0,
  );
}

/** The multipliers worth showing: anything other than 1x. */
export function visibleMultipliers(
  breakdown: XpBreakdown,
): { key: "game" | "subscriber"; permille: number }[] {
  const out: { key: "game" | "subscriber"; permille: number }[] = [];
  if (breakdown.gamePermille !== 1000) {
    out.push({ key: "game", permille: breakdown.gamePermille });
  }
  if (breakdown.subscriberPermille !== 1000) {
    out.push({ key: "subscriber", permille: breakdown.subscriberPermille });
  }
  return out;
}

/**
 * Splits `total` across `amounts` in proportion, as whole numbers that add up
 * to exactly `total` (largest remainder). It is how the breakdown shows each
 * source's share of a multiplied award without the cards disagreeing with the
 * total.
 */
export function apportionXp(
  amounts: readonly number[],
  total: number,
): number[] {
  const sum = amounts.reduce((a, b) => a + Math.max(0, b), 0);
  if (sum <= 0 || total <= 0) return amounts.map(() => 0);
  const raw = amounts.map((a) => (Math.max(0, a) * total) / sum);
  const out = raw.map((r) => Math.floor(r));
  let left = total - out.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - out[i] }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    out[i]++;
    left--;
  }
  return out;
}

// Ineligibility reasons with their own copy. Anything else — including reasons
// the API adds later — gets the generic line. Keys spelled out in full so the
// translation checks can see them.
const INELIGIBLE_REASON_KEYS: Record<string, string> = {
  not_spawned: "progression.ineligible_not_spawned",
  too_short: "progression.ineligible_too_short",
  no_action: "progression.ineligible_no_action",
  custom_settings: "progression.ineligible_custom_settings",
  too_few_humans: "progression.ineligible_too_few_humans",
  daily_cap: "progression.ineligible_daily_cap",
  // The game's stats were not agreed on by the players' votes.
  unverified: "progression.ineligible_unverified",
};

export function ineligibleReasonKey(reason: string): string {
  return Object.prototype.hasOwnProperty.call(INELIGIBLE_REASON_KEYS, reason)
    ? INELIGIBLE_REASON_KEYS[reason]
    : "progression.ineligible_generic";
}

// Reward reasons the progression system grants (RewardSchema.reason).
const LEVEL_REWARD_REASON_KEYS: Record<string, string> = {
  level_up: "account_modal.reward_level_up",
  level_milestone: "account_modal.reward_level_milestone",
  prestige: "account_modal.reward_prestige",
};

export function levelRewardReasonKey(reason: string): string | undefined {
  return Object.prototype.hasOwnProperty.call(LEVEL_REWARD_REASON_KEYS, reason)
    ? LEVEL_REWARD_REASON_KEYS[reason]
    : undefined;
}
