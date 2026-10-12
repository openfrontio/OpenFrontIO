import type { ClaimRewardResponse } from "@openfront/shared/ApiSchemas";
import { claimReward, invalidateUserMe } from "./Api";

// Claiming a list of rewards one by one: the profile's Claim all and the
// end-of-game reveal's Claim both go through here.

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

// Only the success shape counts as claimed. Anything else (false, or a
// result this client doesn't know) stops the run without reading balances
// from it. A reward the API holds back until the account is trusted will
// answer `{ held }`; once #5879's isRewardClaimable exists, callers leave
// held rewards out of `ids` rather than reach that here.
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
 * Claims `ids` one by one, in order, and stops at the first failure. When
 * anything was claimed the cached /users/@me is dropped (its balances and
 * pending rewards changed); telling the page (`rewards-changed`) is the
 * caller's, which knows what changed.
 */
export async function claimRewards(
  ids: readonly string[],
  { claim = claimReward, stopped = () => false }: ClaimRunOptions = {},
): Promise<ClaimRun> {
  const run: ClaimRun = {
    claimedIds: [],
    creditedIds: [],
    currency: null,
    failed: false,
  };
  for (const id of ids) {
    if (stopped()) break;
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
