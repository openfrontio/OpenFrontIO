import { translateText } from "../../Utils";

/** Games a player must finish before OFstats gives them a tier. */
export const FFA_CALIBRATION_GAMES = 10;

export const FFA_TIER_BASES = [
  "iron",
  "bronze",
  "silver",
  "gold",
  "platinum",
  "diamond",
  "master",
  "grandmaster",
] as const;
export type FfaTierBase = (typeof FFA_TIER_BASES)[number];

export type FfaDivision = "I" | "II" | "III";

export interface ParsedFfaTier {
  base: FfaTierBase;
  division: FfaDivision | null;
}

// Literal keys, so the translation-usage test sees them used.
export const FFA_TIER_NAME_KEYS: Record<FfaTierBase, string> = {
  iron: "ffa_rating.tier.iron",
  bronze: "ffa_rating.tier.bronze",
  silver: "ffa_rating.tier.silver",
  gold: "ffa_rating.tier.gold",
  platinum: "ffa_rating.tier.platinum",
  diamond: "ffa_rating.tier.diamond",
  master: "ffa_rating.tier.master",
  grandmaster: "ffa_rating.tier.grandmaster",
};

const DIVISION_RANK: Record<FfaDivision, number> = { III: 0, II: 1, I: 2 };

const DIVIDED_BASES = FFA_TIER_BASES.slice(0, 7);
const DIVISIONS: readonly string[] = ["I", "II", "III"];

/**
 * Parses an OFstats tier string: "<Base> <I|II|III>" for the first seven
 * bases, exactly "Grandmaster" for the last. Anything else is null.
 */
export function parseFfaTier(tier: string): ParsedFfaTier | null {
  if (tier === "Grandmaster") return { base: "grandmaster", division: null };
  const parts = tier.split(" ");
  if (parts.length !== 2 || !DIVISIONS.includes(parts[1])) return null;
  const base = DIVIDED_BASES.find(
    (b) => b[0].toUpperCase() + b.slice(1) === parts[0],
  );
  if (base === undefined) return null;
  return { base, division: parts[1] as FfaDivision };
}

export function ffaTierLabel(tier: ParsedFfaTier): string {
  const name = translateText(FFA_TIER_NAME_KEYS[tier.base]);
  return tier.division === null ? name : `${name} ${tier.division}`;
}

/** The translated label, or the raw string when this build doesn't know it. */
export function ffaTierLabelOf(tier: string): string {
  const parsed = parseFfaTier(tier);
  return parsed === null ? tier : ffaTierLabel(parsed);
}

/** 0 (Iron III) … 21 (Grandmaster); null for an unknown tier. */
export function ffaTierRank(tier: string): number | null {
  const parsed = parseFfaTier(tier);
  if (parsed === null) return null;
  const baseIndex = FFA_TIER_BASES.indexOf(parsed.base);
  if (parsed.division === null) return baseIndex * 3;
  return baseIndex * 3 + DIVISION_RANK[parsed.division];
}

export function formatRating(n: number): string {
  return String(Math.round(n));
}

export function formatRatingWithUncertainty(
  rating: number,
  uncertainty: number,
): string {
  return `${formatRating(rating)} ± ${formatRating(uncertainty)}`;
}

export function formatRatingChange(n: number): string {
  const r = Math.round(n);
  if (r === 0) return "0";
  return r > 0 ? `+${r}` : String(r);
}

export function formatExpectedPct(p: number): string {
  return (p * 100).toFixed(1);
}
