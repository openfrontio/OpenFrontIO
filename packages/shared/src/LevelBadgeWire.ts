// A player's level as a name badge: the display subset of the API's
// /users/@me `progress`. Display-only — the simulation never reads it, so it
// cannot desync.
export interface LevelBadge {
  level: number;
  prestige: number;
  legend: boolean;
}

// The lobby roster (ClientInfo.levelBadge) carries a badge as ONE small
// integer rather than a nested { level, prestige, legend } object. The roster
// goes to every client once a second, encoded once per recipient, so a
// 150-player lobby encodes 22,500 entries a second: a nested object cost each
// entry its own header byte plus two varints and a per-object encode/decode
// step; a packed varint is one or two bytes and a plain number.
//
//   bits 0-6   level     1..100
//   bits 7-10  prestige  0..10
//   bit  11    legend
//
// Prestige 0 (most players) packs below 128, so one varint byte; anything
// else, up to legend at P10 L100 (3428), is two.
export const LEVEL_BADGE_MAX_LEVEL = 100;
export const LEVEL_BADGE_MAX_PRESTIGE = 10;
const LEVEL_BITS = 7;
const LEVEL_MASK = (1 << LEVEL_BITS) - 1;
const PRESTIGE_SHIFT = LEVEL_BITS;
const PRESTIGE_MASK = 0b1111;
const LEGEND_BIT = 1 << 11;
const ALL_BITS = (1 << 12) - 1;

function inRange(level: number, prestige: number): boolean {
  return (
    Number.isInteger(level) &&
    level >= 1 &&
    level <= LEVEL_BADGE_MAX_LEVEL &&
    Number.isInteger(prestige) &&
    prestige >= 0 &&
    prestige <= LEVEL_BADGE_MAX_PRESTIGE
  );
}

// The wire form of a badge, or undefined when it holds anything the packing
// cannot represent (so no badge is sent rather than a wrong one).
export function packLevelBadge(
  badge: LevelBadge | undefined,
): number | undefined {
  if (badge === undefined) return undefined;
  const { level, prestige, legend } = badge;
  if (!inRange(level, prestige) || typeof legend !== "boolean") {
    return undefined;
  }
  return level | (prestige << PRESTIGE_SHIFT) | (legend ? LEGEND_BIT : 0);
}

// Back to { level, prestige, legend }. Undefined for no badge and for any
// value no server would send — out-of-range level or prestige, reserved bits
// set, not a whole number — so a bad roster entry shows no badge instead of
// a wrong one or an exception.
export function unpackLevelBadge(
  packed: number | undefined,
): LevelBadge | undefined {
  if (packed === undefined) return undefined;
  if (!Number.isInteger(packed) || packed < 0 || packed > ALL_BITS) {
    return undefined;
  }
  const level = packed & LEVEL_MASK;
  const prestige = (packed >> PRESTIGE_SHIFT) & PRESTIGE_MASK;
  if (!inRange(level, prestige)) return undefined;
  return { level, prestige, legend: (packed & LEGEND_BIT) !== 0 };
}
