import { shownPrice } from "./ShownPrice";

// Sale-aware prices, shared by the store and the player card surfaces. Kept
// apart from Cosmetics.ts so a component can read prices without pulling in
// the whole purchase flow.

/**
 * An item's price in one currency as the store shows and the server charges
 * it now. While the item's own sale runs that is the catalog price (the sale
 * price); once the sale's endsAt has passed it is the list price, even if the
 * catalog in hand predates the end. The store's buttons and the purchase
 * balance check both read this, so they never disagree.
 */
export function currentPrice(
  item: {
    priceHard?: number;
    priceSoft?: number;
    listPriceHard?: number;
    listPriceSoft?: number;
    promotion?: { endsAt: string };
  },
  currency: "hard" | "soft",
): number | undefined {
  return shownPrice(item, currency)?.price;
}

/** Whether the item's own sale has ended (its endsAt has passed). */
export function saleHasEnded(item: {
  promotion?: { endsAt: string };
}): boolean {
  return (
    item.promotion !== undefined &&
    new Date(item.promotion.endsAt).getTime() <= Date.now()
  );
}
