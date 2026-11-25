import type { UserMeResponse } from "@openfront/shared/ApiSchemas";
import type { Cosmetics, Pack } from "@openfront/shared/CosmeticSchemas";
import { resolveCosmetics, type ResolvedCosmetic } from "./Cosmetics";
import { sellsOnlyThroughPlay } from "./Payments";
import { shownPrice } from "./ShownPrice";

/**
 * Play's price for each product it sells, by product id. Null when Play could
 * not be asked (or outside the Android app), which lists no pack for real
 * money.
 */
export type PlayPrices = ReadonlyMap<string, string> | null;

/** The Play product ids of the catalog's real-money currency packs. */
export function playProductIds(cosmetics: Cosmetics | null): string[] {
  return Object.values(cosmetics?.currencyPacks ?? {}).flatMap((pack) =>
    pack.currency === "hard" && pack.googleProductId !== undefined
      ? [pack.googleProductId]
      : [],
  );
}

/** Play's price for a currency pack, or null when Play does not sell it. */
export function playPrice(
  resolved: ResolvedCosmetic,
  playPrices: PlayPrices,
): string | null {
  if (resolved.type !== "pack") return null;
  const pack = resolved.cosmetic as Pack;
  if (pack.currency !== "hard" || pack.googleProductId === undefined) {
    return null;
  }
  return playPrices?.get(pack.googleProductId) ?? null;
}

/**
 * In the Android app Play is the only way to pay, so a currency pack is
 * listed only at a price Play gave (or when it is bought with in-game
 * currency) and no subscription is sold. Everything else is unaffected.
 */
export function sellable(
  resolved: ResolvedCosmetic,
  playPrices: PlayPrices,
): boolean {
  if (!sellsOnlyThroughPlay()) return true;
  if (resolved.type === "subscription") return false;
  if (resolved.type !== "pack") return true;
  const pack = resolved.cosmetic as Pack;
  return (
    playPrice(resolved, playPrices) !== null ||
    shownPrice(pack, "hard") !== null ||
    shownPrice(pack, "soft") !== null
  );
}

/**
 * Everything the store sells this player: what they can buy, under the
 * affiliate code it was opened with, less what this platform can't sell. The
 * Store's lists and the home sale banner both read it, so a banner shows only
 * for a sale the On sale tab lists.
 */
export function storePurchasables(
  cosmetics: Cosmetics | null,
  userMe: UserMeResponse | false,
  affiliateCode: string | null,
  playPrices: PlayPrices,
): ResolvedCosmetic[] {
  return resolveCosmetics(cosmetics, userMe, affiliateCode).filter(
    (resolved) =>
      resolved.relationship === "purchasable" && sellable(resolved, playPrices),
  );
}
