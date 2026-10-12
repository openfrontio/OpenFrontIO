import {
  type ClaimRewardResponse,
  isRewardClaimable,
  type Reward,
} from "@openfront/shared/ApiSchemas";
import { claimReward, invalidateUserMe } from "./Api";

// Claiming a list of rewards one by one: the profile's Claim all and the
// end-of-game reveal's Claim both go through here. A held reward (see
// isRewardClaimable) is never claimed: it stays pending until the API lets it
// go, so it is left out of the run, as if it weren't in the list.

export interface ClaimRun {
  // Claimed by this run, or found claimed already ("not_found": a second
  // device, another tab, the rewards panel), in the order given.
  claimedIds: string[];
  // The ones this run itself credited: claimedIds less the not_found ones.
  creditedIds: string[];
  // The balances after the last claim this run credited; null when it
  // credited none.
  currency: ClaimRewardResponse["currency"] | null;
  // A claim failed, and the run stopped there. The ones before it went
  // through (`claimedIds`), so a retry claims only the rest.
  failed: boolean;
}

export interface ClaimRunOptions {
  // Replaceable for tests and previews.
  claim?: (rewardId: string) => Promise<unknown>;
  // Checked before each claim: true stops the run (its caller has gone).
  stopped?: () => boolean;
}

// Only the success shape counts as claimed. Anything else (false, a
// `{ held }` answer for a reward held after all, or a result this client
// doesn't know) stops the run without reading balances from it.
function isClaimed(result: unknown): result is ClaimRewardResponse {
  return (
    typeof result === "object" &&
    result !== null &&
    "currency" in result &&
    typeof result.currency === "object" &&
    result.currency !== null
  );
}

/**
 * Claims `rewards` one by one, in order, skipping the held ones, and stops
 * at the first failure. When anything was claimed the cached /users/@me is
 * dropped (its balances and pending rewards changed); telling the page
 * (`rewards-changed`) is the caller's, which knows what changed.
 */
export async function claimRewards(
  rewards: readonly Pick<Reward, "id" | "held">[],
  { claim = claimReward, stopped = () => false }: ClaimRunOptions = {},
): Promise<ClaimRun> {
  const run: ClaimRun = {
    claimedIds: [],
    creditedIds: [],
    currency: null,
    failed: false,
  };
  for (const reward of rewards) {
    if (!isRewardClaimable(reward)) continue;
    if (stopped()) break;
    const id = reward.id;
    const result = await claim(id);
    if (result === "not_found") {
      run.claimedIds.push(id);
      continue;
    }
    if (!isClaimed(result)) {
      run.failed = true;
      break;
    }
    run.claimedIds.push(id);
    run.creditedIds.push(id);
    run.currency = result.currency;
  }
  if (run.claimedIds.length > 0) invalidateUserMe();
  return run;
}
