import { GameType } from "@openfront/engine-api/game/GameTypes";
import type { XpBreakdown } from "@openfront/shared/ApiSchemas";

// Pure helpers behind the level / XP UI. No DOM, no fetches — so the rules the
// components follow are unit-testable on their own.

// The badge art is cut for a 100-level track with 10 prestige ranks (see
// prestigeTier), so the caps stay client constants: raising either on the
// server needs new art, not only a new number. A rank past MAX_PRESTIGE is
// still named by its own number, drawn with the last rank's art.
export const MAX_LEVEL = 100;
export const MAX_PRESTIGE = 10;

/**
 * The prestige rank to show: whole and never negative, but not capped at
 * MAX_PRESTIGE, so a badge agrees with a server that has more ranks.
 */
export function clampPrestige(prestige: number): number {
  if (!Number.isFinite(prestige)) return 0;
  return Math.max(0, Math.floor(prestige));
}

/**
 * The tier a prestige rank's badge is drawn in, one per rank: Iron at P1 up
 * to Champion at P10 (a rank past it keeps Champion's art), "none" before the
 * first prestige. The badge also lights one segment of its rim gauge per
 * rank, so the order reads without telling the colours apart.
 */
export const PRESTIGE_TIERS = [
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
] as const;

export type PrestigeTier = "none" | (typeof PRESTIGE_TIERS)[number];

export function prestigeTier(prestige: number): PrestigeTier {
  const p = Math.min(MAX_PRESTIGE, clampPrestige(prestige));
  return p === 0 ? "none" : PRESTIGE_TIERS[p - 1];
}

/**
 * Each tier's colour: the badge's gauge, icon and level chip. Champion's rim
 * and chip are prismatic; this is the pink its glow takes. "none" is the
 * slate of an unprestiged badge.
 */
export const TIER_COLORS: Readonly<Record<PrestigeTier, string>> = {
  none: "#64748b",
  iron: "#6b7280",
  bronze: "#c27c3e",
  silver: "#c3cbd6",
  gold: "#f2c230",
  platinum: "#9fe3dc",
  emerald: "#2fd28f",
  diamond: "#a5e7ff",
  master: "#c48cff",
  grandmaster: "#ff6b81",
  champion: "#f472b6",
};

/** Legend's gold: its gauge, crown and chip. */
export const LEGEND_COLOR = "#facc15";

/**
 * The colour for a glow or highlight around a player's badge, so it matches
 * the badge: the tier's colour, Legend's gold, and a light slate before the
 * first prestige.
 */
export function prestigeAccent(prestige: number, legend: boolean): string {
  if (legend) return LEGEND_COLOR;
  const tier = prestigeTier(prestige);
  return tier === "none" ? "#cbd5e1" : TIER_COLORS[tier];
}

// Levels called out when reached: the end-of-game XP panel gives one reached
// this game its own "new milestone" card (100 is the Legend card at the last
// prestige). Must match the server's milestone list, which dates them on the
// profile.
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
  { tier: "sovereign", permille: 2000, colors: ["#ffc713", "#ffde90"] },
  { tier: "warlord", permille: 1500, colors: ["#4cadd0", "#b2f9ff"] },
  { tier: "vanguard", permille: 1250, colors: ["#369876", "#71ff9e"] },
];

/** The subscription tier a subscriber multiplier belongs to, if it's one. */
export function subscriberTierOf(permille: number) {
  return SUBSCRIBER_TIERS.find((t) => t.permille === permille) ?? null;
}

/** A permille multiplier as a percentage change: 1200 → 20, 500 → -50. */
export function multiplierPercent(permille: number): number {
  return Math.round(permille - 1000) / 10;
}

type XpSourceKey =
  | "played"
  | "time"
  | "placement"
  | "win"
  | "firstGame"
  | "feats";

// "other" is XP in the subtotal that no known source accounts for: a source
// this client doesn't know, or one stored under an older name.
export type XpLineKey = XpSourceKey | "other";

export const XP_LINE_KEYS: readonly XpSourceKey[] = [
  "played",
  "time",
  "placement",
  "win",
  "firstGame",
  "feats",
];

// Each breakdown line's label.
export const XP_LINE_LABEL_KEYS: Record<XpLineKey, string> = {
  played: "progression.line_played",
  time: "progression.line_time",
  placement: "progression.line_placement",
  win: "progression.line_win",
  firstGame: "progression.line_first_game",
  feats: "progression.line_feats",
  other: "progression.line_other",
};

/**
 * The breakdown lines worth showing: the non-zero ones, in a fixed order, then
 * whatever of the subtotal they leave unaccounted for, so the lines add up to
 * the subtotal and no line is credited with XP another source earned.
 */
export function visibleXpLines(
  breakdown: XpBreakdown,
): { key: XpLineKey; amount: number }[] {
  const lines: { key: XpLineKey; amount: number }[] = XP_LINE_KEYS.map(
    (key) => ({ key, amount: breakdown[key] }),
  ).filter((line) => line.amount !== 0);
  const other = breakdown.subtotal - lines.reduce((a, l) => a + l.amount, 0);
  if (other > 0) lines.push({ key: "other", amount: other });
  return lines;
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
 * The multipliers worth showing, each with the XP it added (negative for a
 * cut), so that the sources and these lines add up to the total — or null
 * where that can't be known.
 *
 * The API applies both multipliers in one step and rounds once:
 * total = round(subtotal × game × subscriber). With one multiplier in play,
 * what it added is exactly total − subtotal. With both, how much each added
 * depends on which is applied first, and the breakdown doesn't say — so
 * neither line gets an amount rather than one that might be wrong.
 */
export function multiplierAmounts(
  breakdown: XpBreakdown,
): { key: "game" | "subscriber"; permille: number; amount: number | null }[] {
  const multipliers = visibleMultipliers(breakdown);
  const exact = multipliers.length === 1;
  return multipliers.map((m) => ({
    ...m,
    amount: exact ? breakdown.total - breakdown.subtotal : null,
  }));
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

// The ineligibility reason for a game played before player levels existed.
export const BEFORE_PROGRESSION = "before_progression";

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
  // Played before player levels launched: never scored.
  [BEFORE_PROGRESSION]: "progression.xp_before_levels",
};

// A singleplayer game never carries the end-of-game vote, so the server
// always marks it unverified: callers that know the game's type pass it, and
// it gets its own line instead.
export function ineligibleReasonKey(
  reason: string,
  gameType?: GameType | null,
): string {
  if (reason === "unverified" && gameType === GameType.Singleplayer) {
    return "progression.ineligible_singleplayer";
  }
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

/** A reward's amount (a stringified bigint); 0 when it isn't one. */
export function rewardAmount(value: string): bigint {
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}
