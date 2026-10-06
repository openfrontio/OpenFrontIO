import type { GameXpFlare, GameXpReward } from "@openfront/shared/ApiSchemas";
import { claimReward } from "./Api";
import {
  cosmeticSelectionLabel,
  cosmeticTypeLabel,
} from "./components/CosmeticPresentation";
import {
  findPackItem,
  type ResolvedCosmetic,
  translateCosmetic,
} from "./Cosmetics";
import { translateText } from "./Utils";

// The level rewards and unlocks one game earned, as the end-of-game reveal
// shows them: summed per currency, and claimed together (only this game's).

export type Currency = "soft" | "hard";

export interface RewardLine {
  currency: Currency;
  // Sum of this game's rewards in the currency (amounts are stringified
  // bigints; summed exactly).
  total: bigint;
  count: number;
  // The amount of each, when several rewards in this currency are all the
  // same ("3 × 100"); null otherwise.
  each: bigint | null;
}

export interface GameRewardsSummary {
  // The row's heading, a translation key and its params.
  headingKey: string;
  headingParams: Record<string, number>;
  // Caps first, then Plutonium; a currency the game didn't pay is left out.
  lines: RewardLine[];
  // Every reward was already claimed (elsewhere, or on an earlier view).
  allClaimed: boolean;
}

function amountOf(reward: GameXpReward): bigint {
  try {
    return BigInt(reward.amount);
  } catch {
    return 0n;
  }
}

/**
 * The rewards row for one game: "Level 47 reward +100 Caps", "Levels 45–47
 * +300 Caps (3 × 100)", "Level 50 rewards +100 Caps +25 Plutonium". Null
 * when the game paid nothing.
 */
export function summarizeGameRewards(
  rewards: readonly GameXpReward[],
): GameRewardsSummary | null {
  if (rewards.length === 0) return null;
  const levels = [...new Set(rewards.map((r) => r.level))].sort(
    (a, b) => a - b,
  );
  let headingKey: string;
  let headingParams: Record<string, number>;
  if (levels.length > 1) {
    headingKey = "progression.rewards_levels";
    headingParams = { from: levels[0], to: levels[levels.length - 1] };
  } else {
    headingKey =
      rewards.length > 1
        ? "progression.rewards_level_many"
        : "progression.rewards_level_one";
    headingParams = { level: levels[0] };
  }
  const lines: RewardLine[] = [];
  for (const currency of ["soft", "hard"] as const) {
    const these = rewards.filter((r) => r.currencyType === currency);
    if (these.length === 0) continue;
    const amounts = these.map(amountOf);
    const total = amounts.reduce((a, b) => a + b, 0n);
    const each =
      amounts.length > 1 && amounts.every((a) => a === amounts[0])
        ? amounts[0]
        : null;
    lines.push({ currency, total, count: these.length, each });
  }
  return {
    headingKey,
    headingParams,
    lines,
    allClaimed: rewards.every((r) => r.claimed),
  };
}

export interface Balances {
  soft: number;
  hard: number;
}

export type ClaimOutcome =
  | {
      ok: true;
      // The balances after the last claim this call made, or null when it
      // made none (all were claimed elsewhere first).
      currency: Balances | null;
      // What this call's claims added to the balances.
      credited: Balances;
      claimedIds: string[];
    }
  // A claim failed. The ones before it went through (`claimedIds`), so a
  // retry claims only the rest.
  | { ok: false; claimedIds: string[] };

/**
 * Claims this game's unclaimed rewards, one by one, and only those: never
 * the player's other pending rewards. `skip` holds ids already claimed from
 * this view. A reward someone else claimed first (a second device, the
 * rewards panel) answers not_found and counts as claimed.
 */
export async function claimGameRewards(
  rewards: readonly GameXpReward[],
  skip: ReadonlySet<string> = new Set(),
): Promise<ClaimOutcome> {
  const claimedIds: string[] = [];
  const credited: Balances = { soft: 0, hard: 0 };
  let currency: Balances | null = null;
  for (const reward of rewards) {
    if (reward.claimed || skip.has(reward.id)) continue;
    const result = await claimReward(reward.id);
    if (result === false) return { ok: false, claimedIds };
    claimedIds.push(reward.id);
    if (result === "not_found") continue;
    currency = result.currency;
    credited[reward.currencyType] += Number(amountOf(reward));
  }
  return { ok: true, currency, credited, claimedIds };
}

export interface FlareUnlock {
  flare: GameXpFlare;
  // The catalog entry, for its preview; null while the catalog is unknown or
  // when it no longer lists the cosmetic.
  resolved: ResolvedCosmetic | null;
  name: string;
  // "Skin", "Boat Trail Effect", …
  typeLabel: string;
}

const NAME_PREFIXES: Record<string, string> = {
  pattern: "territory_patterns.pattern",
  skin: "territory_patterns.pattern",
  flag: "flags",
  crown: "crowns",
  effect: "effects",
};

const TYPE_KEYS: Record<string, string> = {
  pattern: "cosmetics.type_skin",
  skin: "cosmetics.type_skin",
  flag: "cosmetics.type_flag",
  crown: "cosmetics.type_crown",
};

/**
 * What a flare unlocked, for the reveal's "Unlocked" card: its catalog entry
 * where `catalog` lists it (flares spell cosmetics "type:name", or
 * "pattern:name:palette"), named the way the store names it.
 */
export function flareUnlock(
  flare: GameXpFlare,
  catalog: readonly ResolvedCosmetic[],
): FlareUnlock {
  const [type = "", name = "", palette] = flare.flareName.split(":");
  const known = ["pattern", "flag", "skin", "crown", "effect"].includes(type);
  const resolved = known
    ? (findPackItem(
        {
          type: type as "pattern" | "flag" | "skin" | "crown" | "effect",
          name,
          colorPalette: palette,
        },
        catalog,
      ) ?? null)
    : null;
  if (resolved !== null) {
    return {
      flare,
      resolved,
      name: cosmeticSelectionLabel(resolved),
      typeLabel: cosmeticTypeLabel(resolved),
    };
  }
  const prefix = NAME_PREFIXES[type];
  const typeKey = TYPE_KEYS[type];
  return {
    flare,
    resolved: null,
    name:
      prefix !== undefined && name !== ""
        ? translateCosmetic(prefix, name)
        : flare.flareName,
    typeLabel: translateText(typeKey ?? "progression.unlocked_cosmetic"),
  };
}
