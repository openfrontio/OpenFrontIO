import { assetUrl } from "src/core/AssetUrls";
import { UserMeResponse } from "../core/ApiSchemas";
import {
  ColorPalette,
  Cosmetics,
  CosmeticsSchema,
  Flag,
  Pack,
  Pattern,
  Product,
  Skin,
  Subscription,
} from "../core/CosmeticSchemas";
import {
  PlayerCosmeticRefs,
  PlayerCosmetics,
  PlayerPattern,
} from "../core/Schemas";
import { UserSettings } from "../core/game/UserSettings";
import {
  changeSubscriptionTier,
  createCheckoutSession,
  getApiBase,
  getUserMe,
  invalidateUserMe,
  purchaseWithCurrency,
} from "./Api";
import { translateText } from "./Utils";

export const TEMP_FLARE_OFFSET = 1 * 60 * 1000; // 1 minute

// Subscriptions are not ready yet — flip to true to show them in the store
// and on the account/profile modal.
export const SUBSCRIPTIONS_ENABLED = false;

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

export async function purchaseCosmetic(
  resolved: ResolvedCosmetic,
  method: PaymentMethod,
): Promise<void> {
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
        alert(translateText("store.already_subscribed"));
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
      const confirmed = window.confirm(
        translateText(confirmKey, { tier: targetName }),
      );
      if (!confirmed) return;

      const ok = await changeSubscriptionTier(sub.name);
      if (!ok) {
        alert(translateText("store.change_tier_failed"));
        return;
      }
      alert(translateText("store.change_tier_success", { tier: targetName }));
      window.location.reload();
      return;
    }
  }

  if (method === "dollar") {
    if (!c.product) {
      alert(translateText("store.checkout_failed"));
      return;
    }
    const url = await createCheckoutSession(
      c.product.priceId,
      colorPaletteName,
    );
    if (url === false) {
      alert(translateText("store.checkout_failed"));
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
    alert(translateText("store.login_required"));
    return;
  }
  const balance =
    method === "hard"
      ? (userMe.player.currency?.hard ?? 0)
      : (userMe.player.currency?.soft ?? 0);
  if (balance < price) {
    alert(translateText("store.not_enough_currency"));
    if (method === "hard") {
      // Send the user to the packs tab so they can top up plutonium.
      window.location.hash = "#modal=store&tab=packs";
    }
    return;
  }

  const cosmeticType = resolved.type as "pattern" | "skin" | "flag";
  const success = await purchaseWithCurrency(
    cosmeticType,
    c.name,
    method,
    colorPaletteName,
  );
  if (!success) {
    alert(translateText("store.purchase_failed"));
    return;
  }
  alert(translateText("store.purchase_success", { name: c.name }));
  invalidateUserMe();
  window.location.reload();
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
  __cosmetics = (async () => {
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
      const hashInput = patternKeys
        .map((k) => k + (result.data.patterns[k].product ? "sale" : ""))
        .join(",");
      __cosmeticsHash = simpleHash(hashInput);
      __cosmeticsCache = result.data;
      return result.data;
    } catch (error) {
      console.error("Error getting cosmetics:", error);
      return null;
    }
  })();
  return __cosmetics;
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
    product: Product | null;
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

  // Purchasable if any purchase method is available
  if (opts.priceSoft !== undefined || opts.priceHard !== undefined) {
    return "purchasable";
  }

  if (opts.product === null) {
    return "blocked";
  }

  return "purchasable";
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
      product: pattern.product,
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
      product: flag.product,
      priceSoft: flag.priceSoft,
      priceHard: flag.priceHard,
      affiliateCode,
      itemAffiliateCode: flag.affiliateCode ?? null,
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
      product: skin.product,
      priceSoft: skin.priceSoft,
      priceHard: skin.priceHard,
      affiliateCode,
      itemAffiliateCode: skin.affiliateCode ?? null,
    },
    userMeResponse,
  );
}

export type ResolvedCosmetic = {
  type: "pattern" | "skin" | "flag" | "pack" | "subscription";
  cosmetic: Pattern | Skin | Flag | Pack | Subscription | null;
  colorPalette: ColorPalette | null;
  relationship: "owned" | "purchasable" | "blocked";
  /** Unique key for selection/identity, e.g. "pattern:hearts:red" or "skin:mountain" */
  key: string;
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

export async function getPlayerCosmeticsRefs(): Promise<PlayerCosmeticRefs> {
  const userSettings = new UserSettings();
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

  return {
    flag: flag ?? undefined,
    patternName: pattern?.name ?? undefined,
    patternColorPaletteName: pattern?.colorPalette?.name ?? undefined,
    skinName,
  };
}

export async function getPlayerCosmetics(): Promise<PlayerCosmetics> {
  const refs = await getPlayerCosmeticsRefs();
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
