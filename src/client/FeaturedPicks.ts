import {
  activeSale,
  groupCosmeticVariants,
  isNew,
  newUntilMs,
  type ResolvedCosmetic,
} from "./Cosmetics";

// What the store's Featured tab picks, as pure functions of the purchasable
// items, so another spot (the join lobby's store row) shows the same picks.

export type Group = readonly ResolvedCosmetic[];

/** What the Featured tab shows, each item in only the first section it fits. */
export interface FeaturedSections {
  /** The running flash sale's item, while the player can buy it. */
  deal: Group | undefined;
  /** New items, newest first, without the deal item. */
  new: Group[];
  /** The rest on sale, without the deal item and anything in `new`. */
  sale: Group[];
}

/** The running flash sale's item group, if one is among `groups`. */
export function flashGroup<T extends readonly ResolvedCosmetic[]>(
  groups: readonly T[],
): T | undefined {
  return groups.find((group) =>
    group.some((resolved) => activeSale(resolved.cosmetic)?.kind === "flash"),
  );
}

/** Whether a running sale discounts any variant in a card's group. */
export function groupOnSale(group: readonly ResolvedCosmetic[]): boolean {
  return group.some((resolved) => activeSale(resolved.cosmetic) !== null);
}

/** Whether any variant in a card's group is new to the store. */
export function groupIsNew(group: readonly ResolvedCosmetic[]): boolean {
  return group.some((resolved) => isNew(resolved.cosmetic));
}

/** When a card's group stops being new: its latest variant's newUntil. */
function groupNewUntil(group: readonly ResolvedCosmetic[]): number {
  return Math.max(
    ...group.map((resolved) => newUntilMs(resolved.cosmetic) ?? 0),
  );
}

/** The most recently added first: the one that stays new longest. */
export function newestFirst<T extends readonly ResolvedCosmetic[]>(
  groups: readonly T[],
): T[] {
  return groups
    .map((group) => ({ group, until: groupNewUntil(group) }))
    .sort((a, b) => b.until - a.until)
    .map(({ group }) => group);
}

/** The flash item, then the rest on sale, then everything else. */
export function saleFirst<T extends readonly ResolvedCosmetic[]>(
  groups: readonly T[],
): T[] {
  const flash = flashGroup(groups);
  const rest = groups.filter((group) => group !== flash);
  return [
    ...(flash ? [flash] : []),
    ...rest.filter(groupOnSale),
    ...rest.filter((group) => !groupOnSale(group)),
  ];
}

/**
 * The store's New or On sale list: every new (or discounted) skin, flag,
 * crown, effect and bundle among `items`, skins grouped with their palettes.
 */
export function newOrSaleGroups(
  items: readonly ResolvedCosmetic[],
  tab: "new" | "sale",
): Group[] {
  const skins = groupCosmeticVariants(
    items.filter(
      (resolved) => resolved.type === "pattern" || resolved.type === "skin",
    ),
  );
  const flags = items
    .filter((resolved) => resolved.type === "flag")
    .map((r) => [r]);
  const crowns = items
    .filter((resolved) => resolved.type === "crown")
    .map((r) => [r]);
  // A sale (a flash sale's pick included) or a new item can be an effect or
  // a bundle too, and those live on other tabs; list them here as well so On
  // sale and New each lead to every such item (the banner's "On sale" link
  // included).
  const others = items
    .filter(
      (resolved) =>
        resolved.type === "effect" || resolved.type === "cosmeticPack",
    )
    .map((r) => [r]);
  const all = [...skins, ...flags, ...crowns, ...others];
  return tab === "sale"
    ? saleFirst(all.filter(groupOnSale))
    : newestFirst(all.filter(groupIsNew));
}

/** The Featured sections from the purchasable items, `rowLength` a row. */
export function featuredSections(
  items: readonly ResolvedCosmetic[],
  rowLength: number,
): FeaturedSections {
  const onSale = newOrSaleGroups(items, "sale");
  const deal = flashGroup(onSale);
  const keysOf = (groups: readonly Group[]) =>
    new Set(groups.flatMap((group) => group.map((item) => item.key)));
  const dealKeys = keysOf(deal ? [deal] : []);
  const fresh = newOrSaleGroups(items, "new")
    .filter((group) => !group.some((item) => dealKeys.has(item.key)))
    .slice(0, rowLength);
  // Only what the New row shows at this width: a new item on sale that
  // doesn't fit there still shows under On sale.
  const newKeys = keysOf(fresh);
  const sale = onSale.filter(
    (group) =>
      group !== deal &&
      !group.some((item) => dealKeys.has(item.key) || newKeys.has(item.key)),
  );
  return {
    deal,
    new: fresh,
    sale: sale.slice(0, rowLength),
  };
}
