import type { UserMeResponse } from "@openfront/shared/ApiSchemas";
import type { Cosmetics } from "@openfront/shared/CosmeticSchemas";
import { resolveCosmetics, type ResolvedCosmetic } from "./Cosmetics";

/**
 * Everything the store sells this player: what they can buy, under the
 * affiliate code it was opened with. The Store's lists and the home sale
 * banner both read it, so a banner shows only for a sale the On sale tab
 * lists.
 */
export function storePurchasables(
  cosmetics: Cosmetics | null,
  userMe: UserMeResponse | false,
  affiliateCode: string | null,
): ResolvedCosmetic[] {
  return resolveCosmetics(cosmetics, userMe, affiliateCode).filter(
    (resolved) => resolved.relationship === "purchasable",
  );
}
