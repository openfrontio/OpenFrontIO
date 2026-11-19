import { translateText } from "./Utils";

/** The catalogue's price fields on anything sold for Plutonium or caps. */
export interface PricedItem {
  priceHard?: number;
  priceSoft?: number;
  listPriceHard?: number;
  listPriceSoft?: number;
  promotion?: {
    name: string;
    percentOff: number;
    endsAt: string;
    kind?: "flash";
  };
}

/** What a price chip or purchase button shows for one currency. */
export interface ShownPrice {
  /** The price charged now. */
  price: number;
  /** The price before the running sale, struck through; null with no sale. */
  listPrice: number | null;
  /** The running sale's name ("Flash sale" for a flash sale); null with no
   * sale, or a sale with no promotion behind it. */
  saleLabel: string | null;
}

/**
 * The one place the client decides what price to show for an item: the
 * Store, the Inventory and the Player card tab all read prices through it.
 * It reads the catalogue's sale fields today; a personal offer would plug in
 * here and nowhere else.
 *
 * Same rule as `currentPrice` and `activeSale` in Cosmetics.ts: once the
 * item's own sale has ended (`promotion.endsAt` has passed) the price is its
 * list price, as the purchase endpoints charge it, whatever the catalogue in
 * hand still says. A sale shows only while the list price is above the price.
 */
export function shownPrice(
  item: PricedItem,
  currency: "hard" | "soft",
  now: number = Date.now(),
): ShownPrice | null {
  const price = currency === "hard" ? item.priceHard : item.priceSoft;
  if (price === undefined) return null;
  const listPrice =
    currency === "hard" ? item.listPriceHard : item.listPriceSoft;
  const promotion = item.promotion;
  if (promotion !== undefined && new Date(promotion.endsAt).getTime() <= now) {
    return { price: listPrice ?? price, listPrice: null, saleLabel: null };
  }
  if (listPrice === undefined || listPrice <= price) {
    return { price, listPrice: null, saleLabel: null };
  }
  const saleLabel =
    promotion === undefined
      ? null
      : promotion.kind === "flash"
        ? translateText("store.flash_sale")
        : promotion.name;
  return { price, listPrice, saleLabel };
}

/** When the item's own sale ends, in ms; null with no sale. A shown price
 * changes then, so a view that shows one re-renders at that moment. */
export function saleEndsAt(item: PricedItem): number | null {
  if (item.promotion === undefined) return null;
  const at = new Date(item.promotion.endsAt).getTime();
  return Number.isFinite(at) ? at : null;
}
