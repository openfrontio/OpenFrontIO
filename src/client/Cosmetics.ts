import { assetUrl } from "src/core/AssetUrls";
import { UserMeResponse } from "../core/ApiSchemas";
import {
  ColorPalette,
  CosmeticPack,
  CosmeticPackItem,
  Cosmetics,
  CosmeticsSchema,
  Crown,
  Effect,
  findEffectForSlot,
  Flag,
  Pack,
  Pattern,
  Skin,
  Subscription,
} from "../core/CosmeticSchemas";
import { UserSettings } from "../core/game/UserSettings";
import {
  PlayerCosmeticRefs,
  PlayerCosmetics,
  PlayerEffect,
  PlayerPattern,
} from "../core/Schemas";
import {
  changeSubscriptionTier,
  createCheckoutSession,
  getApiBase,
  getUserMe,
  invalidateUserMe,
  purchaseCosmeticPack,
  purchaseWithCurrency,
} from "./Api";
import { showInGameAlert, showInGameConfirm } from "./InGameModal";
import { translateText } from "./Utils";

export const TEMP_FLARE_OFFSET = 1 * 60 * 1000; // 1 minute

let __cosmetics: Promise<Cosmetics | null> | null = null;
let __cosmeticsHash: string | null = null;
let __cosmeticsCache: Cosmetics | null = null;

/**
 * Synchronous accessor for the most recently resolved cosmetics. Returns null
 * before the first successful `fetchCosmetics()` call. Useful when a code path
 * cannot await (e.g. WebGL per-frame sync).
 */
export function getCachedCosmetics(): Cosmetics | null {
  return __cosmeticsCache;
}

/**
 * Resolve the local player's selected skin from UserSettings + cached
 * cosmetics. Returns null if no skin is selected, cosmetics aren't loaded,
 * or the saved skin no longer exists.
 */
export function getLocalSelectedSkin(): { name: string; url: string } | null {
  const skinName = new UserSettings().getSelectedSkinName();
  if (!skinName) return null;
  const skin = __cosmeticsCache?.skins?.[skinName];
  if (!skin) return null;
  return { name: skin.name, url: skin.url };
}

export type PaymentMethod = "dollar" | "hard" | "soft";

/** Returned by {@link purchaseCosmetic} when the player can't afford an item. */
export interface InsufficientCurrency {
  /** Display name of the currency, e.g. "Plutonium". */
  currency: string;
  /** How much more currency is needed (raw; localized in the dialog text). */
  shortfall: number;
  /** Display name of the item being bought. */
  item: string;
  /** Whether the currency can be topped up (hard currency only). */
  canTopUp: boolean;
}

/** Outcome of a purchase: unaffordable details, or void on success/redirect. */
export type PurchaseResult = InsufficientCurrency | void;

export interface CosmeticPurchaseReturnActions {
  strip(): void;
  alertAndStrip(message: string): void;
  openTokenLogin(token: string): void;
  refreshStore(): void;
}

export function completeCosmeticPurchaseReturn(
  cosmeticName: string,
  loginToken: string | null,
  actions: CosmeticPurchaseReturnActions,
): void {
  if (loginToken) {
    actions.strip();
    actions.openTokenLogin(loginToken);
    return;
  }
  actions.alertAndStrip(
    translateText("store.purchase_success", { name: cosmeticName }),
  );
  actions.refreshStore();
}

export async function purchaseCosmetic(
  resolved: ResolvedCosmetic,
  method: PaymentMethod,
): Promise<PurchaseResult> {
  if (!resolved.cosmetic) return;
  const c = resolved.cosmetic;
  const colorPaletteName = resolved.colorPalette?.name;

  if (resolved.type === "subscription") {
    const sub = c as Subscription;
    const userMe = await getUserMe();
    const currentSub =
      userMe === false ? null : (userMe.player.subscription ?? null);

    if (currentSub) {
      if (currentSub.tier === sub.name) {
        await showInGameAlert(translateText("store.already_subscribed"));
        return;
      }

      // Direction-aware confirm based on priceMonthly. We don't have the
      // server's sortOrder client-side — priceMonthly is a good proxy.
      const currentCosmetic =
        (await fetchCosmetics())?.subscriptions?.[currentSub.tier] ?? null;
      const isUpgrade =
        currentCosmetic !== null
          ? sub.priceMonthly > currentCosmetic.priceMonthly
          : true;
      const targetName = translateCosmetic("subscriptions", sub.name);
      const confirmKey = isUpgrade
        ? "store.confirm_upgrade"
        : "store.confirm_downgrade";
      const confirmed = await showInGameConfirm(
        translateText(confirmKey, { tier: targetName }),
        {
          heading: translateText("account_modal.change_tier"),
          variant: "warning",
        },
      );
      if (!confirmed) return;

      const result = await changeSubscriptionTier(sub.name);
      if (result === "rate_limited") {
        await showInGameAlert(translateText("store.change_tier_rate_limited"));
        return;
      }
      if (!result) {
        await showInGameAlert(translateText("store.change_tier_failed"));
        return;
      }
      await showInGameAlert(
        translateText("store.change_tier_success", { tier: targetName }),
      );
      window.location.reload();
      return;
    }
  }

  if (resolved.type === "cosmeticPack") {
    return purchasePack(c as CosmeticPack, method);
  }

  if (method === "dollar") {
    const product = "product" in c ? c.product : null;
    if (!product) {
      await showInGameAlert(translateText("store.checkout_failed"));
      return;
    }
    const url = await createCheckoutSession(product.priceId, colorPaletteName);
    if (url === false) {
      await showInGameAlert(translateText("store.checkout_failed"));
      return;
    }
    window.location.href = url;
    return;
  }

  // Currency purchase (hard or soft) — not valid for subscriptions.
  if (resolved.type === "subscription") {
    console.error(
      "purchaseCosmetic: currency purchase not supported for subscriptions",
    );
    return;
  }
  // ResolvedCosmetic isn't a discriminated union, so the guard above doesn't
  // narrow cosmetic's type. Subscriptions are excluded by the runtime check.
  const priced = c as Pattern | Flag | Pack;
  const price =
    method === "hard" ? (priced.priceHard ?? 0) : (priced.priceSoft ?? 0);
  const userMe = await getUserMe();
  if (userMe === false) {
    await showInGameAlert(translateText("store.login_required"));
    return;
  }
  const balance =
    method === "hard"
      ? (userMe.player.currency?.hard ?? 0)
      : (userMe.player.currency?.soft ?? 0);
  if (balance < price) {
    const currencyName = translateText(
      method === "hard" ? "cosmetics.hard" : "cosmetics.soft",
    );
    let itemName: string;
    if (resolved.type === "flag") {
      itemName = translateCosmetic("flags", c.name);
    } else if (resolved.type === "crown") {
      itemName = translateCosmetic("crowns", c.name);
    } else {
      itemName = translateCosmetic("territory_patterns.pattern", c.name);
    }
    // Every palette of a pattern shares one name, so say which colour is short.
    if (resolved.colorPalette !== null) {
      itemName = translateText("inventory.selected_cosmetic_variant", {
        name: itemName,
        variant: translateCosmetic(
          "territory_patterns.color_palette",
          resolved.colorPalette.name,
        ),
      });
    }
    return {
      currency: currencyName,
      shortfall: price - balance,
      item: itemName,
      // Only plutonium can be topped up; caps are dismiss-only.
      canTopUp: method === "hard",
    };
  }

  const cosmeticType = resolved.type as
    | "pattern"
    | "skin"
    | "flag"
    | "crown"
    | "effect";
  const success = await purchaseWithCurrency(
    cosmeticType,
    c.name,
    method,
    colorPaletteName,
  );
  if (!success) {
    await showInGameAlert(translateText("store.purchase_failed"));
    return;
  }
  await showInGameAlert(
    translateText("store.purchase_success", { name: c.name }),
  );
  invalidateUserMe();
  window.location.reload();
}

/**
 * Buys a cosmetic pack (plutonium only). Mirrors the single-cosmetic currency
 * flow: a local balance pre-check surfaces the insufficient-funds dialog
 * before any request; a success reloads so every granted item shows as owned.
 */
async function purchasePack(
  pack: CosmeticPack,
  method: PaymentMethod,
): Promise<PurchaseResult> {
  if (method !== "hard") {
    console.error("purchaseCosmetic: packs are only sold for hard currency");
    return;
  }
  const userMe = await getUserMe();
  if (userMe === false) {
    await showInGameAlert(translateText("store.login_required"));
    return;
  }
  const insufficient = (balance: number): InsufficientCurrency => ({
    currency: translateText("cosmetics.hard"),
    shortfall: pack.priceHard - balance,
    item: pack.displayName,
    canTopUp: true,
  });
  const balance = userMe.player.currency?.hard ?? 0;
  if (balance < pack.priceHard) {
    return insufficient(balance);
  }

  const result = await purchaseCosmeticPack(pack.name);
  if (result.ok) {
    await showInGameAlert(
      translateText("store.purchase_success", { name: pack.displayName }),
    );
    invalidateUserMe();
    window.location.reload();
    return;
  }
  switch (result.code) {
    case "insufficient_balance": {
      // The balance moved since the pre-check: re-read it for the shortfall.
      invalidateUserMe();
      const fresh = await getUserMe();
      return insufficient(
        fresh === false ? 0 : (fresh.player.currency?.hard ?? 0),
      );
    }
    case "debt":
      await showInGameAlert(
        translateText("store.pack_debt", { debt: result.debt }),
      );
      return;
    case "already_owned":
      // Either a genuine conflict or a retry of a purchase that did go
      // through: both mean the local ownership state is stale, so refetch.
      await showInGameAlert(
        translateText("store.pack_already_owned", {
          items: result.ownedFlareNames.map(flareDisplayName).join(", "),
        }),
      );
      invalidateUserMe();
      window.location.reload();
      return;
    case "unavailable":
      await showInGameAlert(translateText("store.pack_unavailable"));
      return;
    default:
      await showInGameAlert(translateText("store.purchase_failed"));
      return;
  }
}

/**
 * The translated name of the cosmetic a flare refers to: "<type>:<name>",
 * or "pattern:<name>:<palette>" for a coloured pattern ("Camo (Crimson)").
 */
function flareDisplayName(flare: string): string {
  const [type, name, palette] = flare.split(":");
  const prefix = {
    pattern: "territory_patterns.pattern",
    skin: "territory_patterns.pattern",
    flag: "flags",
    crown: "crowns",
    effect: "effects",
  }[type];
  if (!prefix || !name) return flare;
  const displayName = translateCosmetic(prefix, name);
  if (!palette) return displayName;
  return translateText("inventory.selected_cosmetic_variant", {
    name: displayName,
    variant: translateCosmetic("territory_patterns.color_palette", palette),
  });
}

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return hash.toString(36);
}

export async function fetchCosmetics(): Promise<Cosmetics | null> {
  if (__cosmetics !== null) {
    return __cosmetics;
  }
  const request = (async () => {
    try {
      const response = await fetch(`${getApiBase()}/cosmetics.json`);
      if (!response.ok) {
        console.error(`HTTP error! status: ${response.status}`);
        return null;
      }
      const result = CosmeticsSchema.safeParse(await response.json());
      if (!result.success) {
        console.error(`Invalid cosmetics: ${result.error.message}`);
        return null;
      }
      const patternKeys = Object.keys(result.data.patterns).sort();
      const hashInput = patternKeys.join(",");
      __cosmeticsHash = simpleHash(hashInput);
      __cosmeticsCache = result.data;
      return result.data;
    } catch (error) {
      console.error("Error getting cosmetics:", error);
      return null;
    }
  })();
  __cosmetics = request;
  void request.then((result) => {
    if (result === null && __cosmetics === request) {
      __cosmetics = null;
    }
  });
  return request;
}

export async function resolveFlagUrl(
  flagRef: string,
): Promise<string | undefined> {
  if (flagRef.startsWith("flag:")) {
    const key = flagRef.slice("flag:".length);
    const cosmetics = await fetchCosmetics();
    const flagData = cosmetics?.flags?.[key];
    return flagData?.url;
  }
  if (flagRef.startsWith("country:")) {
    const code = flagRef.slice("country:".length);
    return assetUrl(`flags/${code}.svg`);
  }
  return undefined;
}

export async function getCosmeticsHash(): Promise<string | null> {
  await fetchCosmetics();
  return __cosmeticsHash;
}

export function cosmeticRelationship(
  opts: {
    wildcardFlare: string;
    requiredFlare: string;
    priceSoft?: number;
    priceHard?: number;
    affiliateCode: string | null;
    itemAffiliateCode: string | null;
  },
  userMeResponse: UserMeResponse | false,
): "owned" | "purchasable" | "blocked" {
  const flares =
    userMeResponse === false ? [] : (userMeResponse.player.flares ?? []);

  if (flares.includes(opts.wildcardFlare)) {
    return "owned";
  }

  if (flares.includes(opts.requiredFlare)) {
    return "owned";
  }

  if (opts.affiliateCode !== opts.itemAffiliateCode) {
    return "blocked";
  }

  // Cosmetics are sold for currency only (USD checkout was removed).
  if (opts.priceSoft !== undefined || opts.priceHard !== undefined) {
    return "purchasable";
  }

  return "blocked";
}

export function patternRelationship(
  pattern: Pattern,
  colorPalette: { name: string; isArchived?: boolean } | null,
  userMeResponse: UserMeResponse | false,
  affiliateCode: string | null,
): "owned" | "purchasable" | "blocked" {
  if (colorPalette === null) {
    // For backwards compatibility only show non-colored patterns if they are owned.
    const flares =
      userMeResponse === false ? [] : (userMeResponse.player.flares ?? []);
    if (
      flares.includes("pattern:*") ||
      flares.includes(`pattern:${pattern.name}`)
    ) {
      return "owned";
    }
    return "blocked";
  }

  if (colorPalette.isArchived) {
    // Check ownership first — if owned, show it even if archived.
    const flares =
      userMeResponse === false ? [] : (userMeResponse.player.flares ?? []);
    if (
      flares.includes("pattern:*") ||
      flares.includes(`pattern:${pattern.name}:${colorPalette.name}`)
    ) {
      return "owned";
    }
    return "blocked";
  }

  return cosmeticRelationship(
    {
      wildcardFlare: "pattern:*",
      requiredFlare: `pattern:${pattern.name}:${colorPalette.name}`,
      priceSoft: pattern.priceSoft,
      priceHard: pattern.priceHard,
      affiliateCode,
      itemAffiliateCode: pattern.affiliateCode ?? null,
    },
    userMeResponse,
  );
}

export function flagRelationship(
  flag: Flag,
  userMeResponse: UserMeResponse | false,
  affiliateCode: string | null,
): "owned" | "purchasable" | "blocked" {
  return cosmeticRelationship(
    {
      wildcardFlare: "flag:*",
      requiredFlare: `flag:${flag.name}`,
      priceSoft: flag.priceSoft,
      priceHard: flag.priceHard,
      affiliateCode,
      itemAffiliateCode: flag.affiliateCode ?? null,
    },
    userMeResponse,
  );
}

export function crownRelationship(
  crown: Crown,
  userMeResponse: UserMeResponse | false,
  affiliateCode: string | null,
): "owned" | "purchasable" | "blocked" {
  return cosmeticRelationship(
    {
      wildcardFlare: "crown:*",
      requiredFlare: `crown:${crown.name}`,
      priceSoft: crown.priceSoft,
      priceHard: crown.priceHard,
      affiliateCode,
      itemAffiliateCode: crown.affiliateCode ?? null,
    },
    userMeResponse,
  );
}

export function skinRelationship(
  skin: Skin,
  userMeResponse: UserMeResponse | false,
  affiliateCode: string | null,
): "owned" | "purchasable" | "blocked" {
  return cosmeticRelationship(
    {
      wildcardFlare: "skin:*",
      requiredFlare: `skin:${skin.name}`,
      priceSoft: skin.priceSoft,
      priceHard: skin.priceHard,
      affiliateCode,
      itemAffiliateCode: skin.affiliateCode ?? null,
    },
    userMeResponse,
  );
}

export function effectRelationship(
  effect: Effect,
  userMeResponse: UserMeResponse | false,
  affiliateCode: string | null,
): "owned" | "purchasable" | "blocked" {
  return cosmeticRelationship(
    {
      wildcardFlare: "effect:*",
      requiredFlare: `effect:${effect.name}`,
      priceSoft: effect.priceSoft,
      priceHard: effect.priceHard,
      affiliateCode,
      itemAffiliateCode: effect.affiliateCode ?? null,
    },
    userMeResponse,
  );
}

/** The flare a pack item's purchase grants, e.g. "pattern:camo:red". */
export function packItemFlare(item: CosmeticPackItem): string {
  const base = `${item.type}:${item.name}`;
  return item.colorPalette ? `${base}:${item.colorPalette}` : base;
}

/**
 * The resolved entry a pack item refers to, or undefined if its cosmetic is
 * no longer in the catalog. A pattern item is the entry for its palette —
 * the "pattern:<key>:<palette>" one, or the uncoloured "pattern:<key>" one
 * when the item names no palette — since that is the flare the pack grants.
 */
export function findPackItem(
  item: CosmeticPackItem,
  candidates: readonly ResolvedCosmetic[],
): ResolvedCosmetic | undefined {
  return candidates.find(
    (r) =>
      r.type === item.type &&
      r.cosmetic?.name === item.name &&
      (item.type !== "pattern" ||
        r.key.split(":")[2] === (item.colorPalette ?? undefined)),
  );
}

/**
 * The pack's items the player already owns — by the item's own flare or the
 * type wildcard. Any owned item blocks buying the pack (the server answers
 * 409; there is no partial grant), so callers use this to explain why.
 */
export function ownedPackItems(
  pack: CosmeticPack,
  userMeResponse: UserMeResponse | false,
): CosmeticPackItem[] {
  const flares =
    userMeResponse === false ? [] : (userMeResponse.player.flares ?? []);
  return pack.items.filter(
    (item) =>
      flares.includes(packItemFlare(item)) || flares.includes(`${item.type}:*`),
  );
}

export function cosmeticPackRelationship(
  pack: CosmeticPack,
  userMeResponse: UserMeResponse | false,
  affiliateCode: string | null,
): "owned" | "purchasable" | "blocked" {
  if (pack.items.length === 0) return "blocked";
  const owned = ownedPackItems(pack, userMeResponse).length;
  if (owned === pack.items.length) return "owned";
  // Pack revenue isn't attributed to affiliates: hidden in affiliate mode.
  if (affiliateCode !== null) return "blocked";
  // Partially owned packs can't be bought (see ownedPackItems).
  if (owned > 0) return "blocked";
  return pack.priceHard > 0 ? "purchasable" : "blocked";
}

export type ResolvedCosmetic = {
  type:
    | "pattern"
    | "skin"
    | "flag"
    | "crown"
    | "effect"
    | "pack"
    | "cosmeticPack"
    | "subscription";
  cosmetic:
    | Pattern
    | Skin
    | Flag
    | Crown
    | Effect
    | Pack
    | CosmeticPack
    | Subscription
    | null;
  colorPalette: ColorPalette | null;
  relationship: "owned" | "purchasable" | "blocked";
  /** Unique key for selection/identity, e.g. "pattern:hearts:red" or "skin:mountain" */
  key: string;
  /** For effects only: the effectType (also the catalog's outer key). */
  effectType?: string;
  /**
   * For cosmetic packs only: the pack's items resolved against this catalog,
   * in pack order. An item whose cosmetic is no longer in the catalog is
   * skipped (the server still sells whatever remains in the pack).
   */
  packItems?: ResolvedCosmetic[];
};

/**
 * Resolves all cosmetics into a flat display-ready list with relationship
 * status and resolved color palettes. Callers can filter by relationship.
 */
export function resolveCosmetics(
  cosmetics: Cosmetics | null,
  userMeResponse: UserMeResponse | false,
  affiliateCode: string | null,
): ResolvedCosmetic[] {
  if (!cosmetics) return [];
  const result: ResolvedCosmetic[] = [];

  // Default pattern (always owned)
  result.push({
    type: "pattern",
    cosmetic: null,
    colorPalette: null,
    relationship: "owned",
    key: "pattern:default",
  });

  // Patterns × color palettes
  for (const [patternKey, pattern] of Object.entries(cosmetics.patterns)) {
    const colorPalettes = [...(pattern.colorPalettes ?? []), null];
    for (const cp of colorPalettes) {
      const rel = patternRelationship(
        pattern,
        cp,
        userMeResponse,
        affiliateCode,
      );
      const resolvedPalette = cp
        ? (cosmetics.colorPalettes?.[cp.name] ?? null)
        : null;
      const key = cp
        ? `pattern:${patternKey}:${cp.name}`
        : `pattern:${patternKey}`;
      result.push({
        type: "pattern",
        cosmetic: pattern,
        colorPalette: resolvedPalette,
        relationship: rel,
        key,
      });
    }
  }

  // Flags
  for (const [flagKey, flag] of Object.entries(cosmetics.flags)) {
    const rel = flagRelationship(flag, userMeResponse, affiliateCode);
    result.push({
      type: "flag",
      cosmetic: flag,
      colorPalette: null,
      relationship: rel,
      key: `flag:${flagKey}`,
    });
  }

  // Crowns
  for (const [crownKey, crown] of Object.entries(cosmetics.crowns ?? {})) {
    const rel = crownRelationship(crown, userMeResponse, affiliateCode);
    result.push({
      type: "crown",
      cosmetic: crown,
      colorPalette: null,
      relationship: rel,
      key: `crown:${crownKey}`,
    });
  }

  // Skins (image-based territory cosmetics). No separate "default" entry —
  // the pattern default doubles as "no skin": selecting it clears both.
  for (const [skinKey, skin] of Object.entries(cosmetics.skins ?? {})) {
    const rel = skinRelationship(skin, userMeResponse, affiliateCode);
    result.push({
      type: "skin",
      cosmetic: skin,
      colorPalette: null,
      relationship: rel,
      key: `skin:${skinKey}`,
    });
  }

  // Effects (boat-trail wakes, etc.) — a cosmetic category like skins/flags.
  // Catalog is nested: effects[effectType][effectName]. We carry effectType (the
  // outer key, which each effect also stores) on the resolved item.
  for (const [effectType, byName] of Object.entries(cosmetics.effects ?? {})) {
    for (const [effectKey, effect] of Object.entries(byName ?? {})) {
      const rel = effectRelationship(effect, userMeResponse, affiliateCode);
      result.push({
        type: "effect",
        cosmetic: effect,
        colorPalette: null,
        relationship: rel,
        key: `effect:${effectType}:${effectKey}`,
        effectType,
      });
    }
  }

  // Packs
  for (const [packKey, pack] of Object.entries(cosmetics.currencyPacks ?? {})) {
    const rel = pack.product ? "purchasable" : "blocked";
    result.push({
      type: "pack",
      cosmetic: pack,
      colorPalette: null,
      relationship: rel,
      key: `pack:${packKey}`,
    });
  }

  // Cosmetic packs. Items reference cosmetics resolved above (findPackItem).
  for (const [packKey, pack] of Object.entries(cosmetics.packs ?? {})) {
    const packItems = pack.items.flatMap((item) => {
      const found = findPackItem(item, result);
      return found ? [found] : [];
    });
    result.push({
      type: "cosmeticPack",
      cosmetic: pack,
      colorPalette: null,
      relationship: cosmeticPackRelationship(
        pack,
        userMeResponse,
        affiliateCode,
      ),
      key: `cosmeticPack:${packKey}`,
      packItems,
    });
  }

  // Subscriptions
  const flares =
    userMeResponse === false ? [] : (userMeResponse.player.flares ?? []);
  const currentSubTier =
    userMeResponse === false
      ? null
      : (userMeResponse.player.subscription?.tier ?? null);
  for (const [subKey, sub] of Object.entries(cosmetics.subscriptions ?? {})) {
    const key = `subscription:${subKey}`;
    const isCurrent = subKey === currentSubTier || flares.includes(key);
    const rel: ResolvedCosmetic["relationship"] = isCurrent
      ? "owned"
      : sub.product
        ? "purchasable"
        : "blocked";
    result.push({
      type: "subscription",
      cosmetic: sub,
      colorPalette: null,
      relationship: rel,
      key,
    });
  }

  return result;
}

/**
 * Groups resolved cosmetics so that colour-palette variants of the same pattern
 * collapse into a single entry. Returns an array of groups in first-seen order
 */
export function groupCosmeticVariants(
  items: ResolvedCosmetic[],
): ResolvedCosmetic[][] {
  const groups: ResolvedCosmetic[][] = [];
  const patternGroupByName = new Map<string, number>();
  for (const item of items) {
    if (item.type === "pattern" && item.cosmetic !== null) {
      const name = item.cosmetic.name;
      const existing = patternGroupByName.get(name);
      if (existing !== undefined) {
        groups[existing].push(item);
        continue;
      }
      patternGroupByName.set(name, groups.length);
    }
    groups.push([item]);
  }
  return groups;
}

export function resolvedToPlayerPattern(
  resolved: ResolvedCosmetic,
): PlayerPattern | null {
  if (resolved.type !== "pattern") return null;
  const c = resolved.cosmetic;
  if (c === null) return null;
  return {
    name: c.name,
    patternData: (c as Pattern).pattern,
    colorPalette: resolved.colorPalette ?? undefined,
  };
}

// `verified` is passed in rather than looked up: the caller has already
// resolved what name the player is joining under (see resolvePlayerName), and
// the badge has to agree with that exact decision. Reading it back out of the
// DOM here was the same missing seam.
export async function getPlayerCosmeticsRefs(
  opts: { verified?: boolean } = {},
): Promise<PlayerCosmeticRefs> {
  const userSettings = new UserSettings();
  // Resolve the profile first: getUserMe activates the per-player cosmetics
  // scope (UserSettings.setPlayerId), which must happen before selections are
  // read below.
  await getUserMe();
  const cosmetics = await fetchCosmetics();
  let pattern: PlayerPattern | null =
    userSettings.getSelectedPatternName(cosmetics);

  if (pattern) {
    const userMe = await getUserMe();
    if (userMe) {
      const flareName =
        pattern.colorPalette?.name === undefined
          ? `pattern:${pattern.name}`
          : `pattern:${pattern.name}:${pattern.colorPalette.name}`;
      const flares = userMe.player.flares ?? [];
      const hasWildcard = flares.includes("pattern:*");
      if (!hasWildcard && !flares.includes(flareName)) {
        pattern = null;
      }
    }
    if (pattern === null) {
      userSettings.setSelectedPatternName(undefined);
    }
  }

  let flag = userSettings.getFlag();
  if (flag?.startsWith("flag:")) {
    const key = flag.slice("flag:".length);
    const flagData = cosmetics?.flags?.[key];
    if (!flagData) {
      // Only clear if cosmetics loaded successfully but the key is missing
      if (cosmetics) {
        flag = null;
      }
    } else {
      const userMe = await getUserMe();
      if (!userMe) {
        flag = null;
      } else {
        const flares = userMe.player.flares ?? [];
        const hasWildcard = flares.includes("flag:*");
        if (!hasWildcard && !flares.includes(`flag:${flagData.name}`)) {
          flag = null;
        }
      }
    }
  }
  if (flag === null) {
    userSettings.clearFlag();
  }

  let skinName = userSettings.getSelectedSkinName() ?? undefined;
  if (skinName) {
    const skin = cosmetics?.skins?.[skinName];
    if (cosmetics && !skin) {
      // Cosmetics loaded but the saved skin no longer exists.
      skinName = undefined;
    } else if (skin) {
      const userMe = await getUserMe();
      if (userMe) {
        const flares = userMe.player.flares ?? [];
        const hasWildcard = flares.includes("skin:*");
        if (!hasWildcard && !flares.includes(`skin:${skin.name}`)) {
          skinName = undefined;
        }
      }
    }
    if (skinName === undefined) {
      userSettings.setSelectedPatternName(undefined);
    }
  }

  let crownName = userSettings.getSelectedCrownName() ?? undefined;
  if (crownName) {
    const crown = cosmetics?.crowns?.[crownName];
    if (cosmetics && !crown) {
      // Cosmetics loaded but the saved crown no longer exists.
      crownName = undefined;
    } else if (crown) {
      const userMe = await getUserMe();
      if (userMe) {
        const flares = userMe.player.flares ?? [];
        const hasWildcard = flares.includes("crown:*");
        if (!hasWildcard && !flares.includes(`crown:${crown.name}`)) {
          crownName = undefined;
        }
      }
    }
    if (crownName === undefined) {
      userSettings.setSelectedCrownName(undefined);
    }
  }

  // Effects: a per-slot map (slot -> effect name). A slot is the effectType for
  // trails and the nukeType for nuke explosions (see effectTypeForSlot). Drop any
  // entry whose effect no longer exists, doesn't fit the slot, or the user can't
  // access. Like skins/flags/patterns above, a selection is kept (and left to the
  // server to validate) when cosmetics or userMe fail to load.
  const selectedEffects = userSettings.getSelectedEffects();
  const effects: Record<string, string> = {};
  for (const [slot, name] of Object.entries(selectedEffects)) {
    const effect = findEffectForSlot(cosmetics, slot, name);
    if (cosmetics && !effect) {
      userSettings.setSelectedEffectName(slot, undefined);
      continue;
    }
    if (effect) {
      const userMe = await getUserMe();
      if (userMe) {
        const flares = userMe.player.flares ?? [];
        const hasWildcard = flares.includes("effect:*");
        if (!hasWildcard && !flares.includes(`effect:${effect.name}`)) {
          userSettings.setSelectedEffectName(slot, undefined);
          continue;
        }
      }
    }
    effects[slot] = name;
  }

  return {
    flag: flag ?? undefined,
    patternName: pattern?.name ?? undefined,
    patternColorPaletteName: pattern?.colorPalette?.name ?? undefined,
    skinName,
    crownName,
    effects: Object.keys(effects).length > 0 ? effects : undefined,
    verified: opts.verified ? true : undefined,
  };
}

export async function getPlayerCosmetics(
  opts: { verified?: boolean } = {},
): Promise<PlayerCosmetics> {
  const refs = await getPlayerCosmeticsRefs(opts);
  const cosmetics = await fetchCosmetics();

  const result: PlayerCosmetics = {};

  if (refs.flag) {
    result.flag = await resolveFlagUrl(refs.flag);
  }

  const devPattern = new UserSettings().getDevOnlyPattern();

  if (devPattern) {
    result.pattern = {
      name: devPattern.name,
      patternData: devPattern.patternData,
      colorPalette: devPattern.colorPalette,
    };
  } else if (refs.patternName && cosmetics) {
    const pattern = cosmetics.patterns[refs.patternName];

    if (pattern) {
      result.pattern = {
        name: refs.patternName,
        patternData: pattern.pattern,
        colorPalette: refs.patternColorPaletteName
          ? cosmetics.colorPalettes?.[refs.patternColorPaletteName]
          : undefined,
      };
    }
  }

  if (refs.skinName && cosmetics) {
    const skin = cosmetics.skins?.[refs.skinName];
    if (skin) {
      result.skin = { name: refs.skinName, url: skin.url };
    }
  }

  const devCrown = new UserSettings().getDevOnlyCrown();

  if (devCrown) {
    result.crown = { name: "dev_crown", url: devCrown };
  } else if (refs.crownName && cosmetics) {
    const crown = cosmetics.crowns?.[refs.crownName];
    if (crown) {
      result.crown = { name: refs.crownName, url: crown.url };
    }
  }

  if (refs.effects && cosmetics) {
    const effects: Record<string, PlayerEffect> = {};
    for (const [slot, name] of Object.entries(refs.effects)) {
      const effect = findEffectForSlot(cosmetics, slot, name);
      if (effect) {
        effects[slot] = { name: effect.name, effectType: effect.effectType };
      }
    }
    if (Object.keys(effects).length > 0) result.effects = effects;
  }

  if (refs.verified) {
    result.verified = true;
  }

  return result;
}

export function translateCosmetic(prefix: string, name: string): string {
  const translation = translateText(`${prefix}.${name}`);
  if (translation.startsWith(prefix)) {
    return name
      .split("_")
      .filter((word) => word.length > 0)
      .map((word) => word[0].toUpperCase() + word.substring(1))
      .join(" ");
  }
  return translation;
}
