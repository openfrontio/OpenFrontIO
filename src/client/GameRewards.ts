import {
  type GameXpFlare,
  type GameXpReward,
  isRewardClaimable,
} from "@openfront/shared/ApiSchemas";
import {
  cosmeticSelectionLabel,
  cosmeticTypeLabel,
} from "./components/CosmeticPresentation";
import {
  findPackItem,
  type ResolvedCosmetic,
  translateCosmetic,
} from "./Cosmetics";
import { rewardAmount } from "./Progression";
import { claimRewards, type RefusedHold } from "./RewardClaims";
import { translateText } from "./Utils";

// The level rewards and unlocks one game earned, as the end-of-game reveal
// shows them: summed per currency, and claimed together (only this game's).
// A held reward (isRewardClaimable) is shown apart, with why it is held, and
// is never claimed nor counted as claimed. So is one the API refused as held
// when it was claimed (withRefusedHolds): held after all.

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

export interface HeldRewardLine extends RewardLine {
  // The label shown in place of a claim, a translation key: the one the
  // rewards panel shows for a trust hold, and the generic note for any other.
  labelKey: string;
}

export interface GameRewardsSummary {
  // The row's heading, a translation key and its params.
  headingKey: string;
  headingParams: Record<string, number>;
  // The rewards that can be claimed (or were): Caps first, then Plutonium; a
  // currency the game didn't pay is left out.
  lines: RewardLine[];
  // The unclaimed held ones, in the same order, one line per currency and
  // kind of hold.
  heldLines: HeldRewardLine[];
  // Whether any reward isn't held (claimed already or not): false when every
  // one is, and the row offers no claim.
  claimable: boolean;
  // Every claimable reward was already claimed (elsewhere, or on an earlier
  // view). Held ones don't count.
  allClaimed: boolean;
}

// A held reward, unclaimed: it stays pending until the API lets it go.
function isHeld(reward: GameXpReward): boolean {
  return !reward.claimed && !isRewardClaimable(reward);
}

/**
 * The game's rewards as they are now known: each one the API refused as held
 * (`holds`, by id, from claimGameRewards) carries its hold, as if it had
 * arrived held. Unchanged when there are none.
 */
export function withRefusedHolds(
  rewards: readonly GameXpReward[],
  holds: ReadonlyMap<string, string>,
): readonly GameXpReward[] {
  if (holds.size === 0) return rewards;
  return rewards.map((r) => {
    const held = holds.get(r.id);
    return held === undefined || r.claimed ? r : { ...r, held };
  });
}

function linesOf(rewards: readonly GameXpReward[]): RewardLine[] {
  const lines: RewardLine[] = [];
  for (const currency of ["soft", "hard"] as const) {
    const these = rewards.filter((r) => r.currencyType === currency);
    if (these.length === 0) continue;
    const amounts = these.map((r) => rewardAmount(r.amount));
    const total = amounts.reduce((a, b) => a + b, 0n);
    const each =
      amounts.length > 1 && amounts.every((a) => a === amounts[0])
        ? amounts[0]
        : null;
    lines.push({ currency, total, count: these.length, each });
  }
  return lines;
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
  const open = rewards.filter((r) => !isHeld(r));
  const held = rewards.filter(isHeld);
  const trust = held.filter((r) => r.held === "trust");
  const other = held.filter((r) => r.held !== "trust");
  const heldLines: HeldRewardLine[] = [
    ...linesOf(trust).map((l) => ({
      ...l,
      labelKey: "account_modal.reward_held_trust",
    })),
    ...linesOf(other).map((l) => ({
      ...l,
      labelKey: "account_modal.reward_held_other_info",
    })),
  ];
  return {
    headingKey,
    headingParams,
    lines: linesOf(open),
    heldLines,
    claimable: open.length > 0,
    allClaimed: open.every((r) => r.claimed),
  };
}

export interface Balances {
  soft: number;
  hard: number;
}

type ClaimOutcome =
  | {
      ok: true;
      // The balances after the last claim this call made, or null when it
      // made none (all were claimed elsewhere first).
      currency: Balances | null;
      // What this call's claims added to the balances.
      credited: Balances;
      claimedIds: string[];
      // The ones the API refused as held (held after all): neither claimed
      // nor credited. Shown as held from then on (withRefusedHolds).
      held: RefusedHold[];
    }
  // A claim failed. The ones before it went through (`claimedIds`), or were
  // refused as held (`held`), so a retry claims only the rest.
  | { ok: false; claimedIds: string[]; held: RefusedHold[] };

/**
 * Claims this game's unclaimed rewards, one by one, and only those: never
 * the player's other pending rewards, nor a held one. `skip` holds ids
 * already claimed from this view. A reward someone else claimed first (a
 * second device, the rewards panel) answers not_found and counts as claimed;
 * one the API refuses as held is passed over, and the rest still claimed.
 */
export async function claimGameRewards(
  rewards: readonly GameXpReward[],
  skip: ReadonlySet<string> = new Set(),
): Promise<ClaimOutcome> {
  const run = await claimRewards(
    rewards.filter((r) => !r.claimed && !skip.has(r.id) && !isHeld(r)),
  );
  if (run.failed) {
    return { ok: false, claimedIds: run.claimedIds, held: run.held };
  }
  const credited: Balances = { soft: 0, hard: 0 };
  for (const reward of rewards) {
    if (run.creditedIds.includes(reward.id)) {
      credited[reward.currencyType] += Number(rewardAmount(reward.amount));
    }
  }
  return {
    ok: true,
    currency: run.currency,
    credited,
    claimedIds: run.claimedIds,
    held: run.held,
  };
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
