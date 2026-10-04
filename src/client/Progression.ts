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
 * The outline of a prestige emblem, drawn around the level frame. Every rank
 * has its own, so ranks read apart by SHAPE as well as colour (colour-blind
 * players): a plain medal, four points, a laurel, an eight-point star, wings,
 * a tiara, compass rays, a sun, a crystal, and prismatic rays with big wings.
 */
export type PrestigeOutline =
  | "plain"
  | "points"
  | "laurel"
  | "star"
  | "wings"
  | "tiara"
  | "compass"
  | "sun"
  | "crystal"
  | "prismatic";

/** How one prestige rank is drawn ("Heraldry": a colour and outline each). */
export interface PrestigeStyle {
  rank: number;
  // Stable id, for the badge's data-prestige-tier ("bronze" … "prismatic").
  id: string;
  outline: PrestigeOutline;
  // The emblem's fill, its outline and number tab colour, and its shadow.
  base: string;
  light: string;
  dark: string;
  // The inner level frame's fill once prestiged: base darkened toward dark.
  frame: string;
  // The rank's colour on other surfaces: the ceremony's glow, a card's halo.
  accent: string;
  // P5 and P10 are milestone ranks: a star on top, wings, and a glow.
  milestone: boolean;
  // CSS colour of the emblem's glow, or null for none.
  glow: string | null;
  // Wings reach past the badge's box; where it sits next to text it gets
  // side margin so they never touch a name.
  winged: boolean;
}

const PRESTIGE_STYLES: readonly PrestigeStyle[] = [
  {
    rank: 1,
    id: "bronze",
    outline: "plain",
    base: "#a8642f",
    light: "#f2b77f",
    dark: "#3d200b",
    frame: "#7b4720",
    accent: "#e2924f",
    milestone: false,
    glow: null,
    winged: false,
  },
  {
    rank: 2,
    id: "silver",
    outline: "points",
    base: "#8792a5",
    light: "#f1f5f9",
    dark: "#232a35",
    frame: "#5d6676",
    accent: "#e2e8f0",
    milestone: false,
    glow: null,
    winged: false,
  },
  {
    rank: 3,
    id: "jade",
    outline: "laurel",
    base: "#0f9d6a",
    light: "#86efc4",
    dark: "#053b27",
    frame: "#0b744e",
    accent: "#34d399",
    milestone: false,
    glow: null,
    winged: false,
  },
  {
    rank: 4,
    id: "sapphire",
    outline: "star",
    base: "#2457d6",
    light: "#a8c6ff",
    dark: "#0a1a4a",
    frame: "#193d9b",
    accent: "#60a5fa",
    milestone: false,
    glow: null,
    winged: false,
  },
  {
    rank: 5,
    id: "amethyst",
    outline: "wings",
    base: "#8b3ee0",
    light: "#e4c6ff",
    dark: "#2a0b52",
    frame: "#6229a4",
    accent: "#c084fc",
    milestone: true,
    glow: "rgba(196,140,255,0.85)",
    winged: true,
  },
  {
    rank: 6,
    id: "crimson",
    outline: "tiara",
    base: "#cc2236",
    light: "#ffa3ae",
    dark: "#4a0812",
    frame: "#951727",
    accent: "#f43f5e",
    milestone: false,
    glow: null,
    winged: false,
  },
  {
    rank: 7,
    id: "ember",
    outline: "compass",
    base: "#ec6a10",
    light: "#ffd19e",
    dark: "#561f02",
    frame: "#ad4b0a",
    accent: "#fb923c",
    milestone: false,
    glow: null,
    winged: false,
  },
  {
    rank: 8,
    id: "gold",
    outline: "sun",
    base: "#e3ad06",
    light: "#fff2a8",
    dark: "#4f3700",
    frame: "#a57b03",
    accent: "#facc15",
    milestone: false,
    glow: null,
    winged: false,
  },
  {
    rank: 9,
    id: "diamond",
    outline: "crystal",
    base: "#3fbfe0",
    light: "#effdff",
    dark: "#08414f",
    frame: "#288aa3",
    accent: "#67e8f9",
    milestone: false,
    glow: null,
    winged: false,
  },
  {
    rank: 10,
    id: "prismatic",
    outline: "prismatic",
    base: "#ec4899",
    light: "#ffd1ec",
    dark: "#3d0a2a",
    frame: "#a32e6a",
    accent: "#f472b6",
    milestone: true,
    glow: "rgba(244,114,182,0.9)",
    winged: true,
  },
];

/** How a prestige rank is drawn; null at prestige 0 (no emblem). */
export function prestigeStyle(prestige: number): PrestigeStyle | null {
  const p = clampPrestige(prestige);
  return p === 0 ? null : PRESTIGE_STYLES[p - 1];
}

// The colour of an unprestiged badge's moments (and of Legend).
const UNPRESTIGED_ACCENT = "#facc15";

/** A prestige rank's colour, for glows and highlights around its emblem. */
export function prestigeAccent(prestige: number): string {
  return prestigeStyle(prestige)?.accent ?? UNPRESTIGED_ACCENT;
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

export type XpLineKey =
  | "played"
  | "time"
  | "placement"
  | "win"
  | "firstGame"
  | "feats";

export const XP_LINE_KEYS: readonly XpLineKey[] = [
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
};

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
