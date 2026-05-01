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
} from "../core/CosmeticSchemas";
import {
  PlayerCosmeticRefs,
  PlayerCosmetics,
  PlayerPattern,
} from "../core/Schemas";
import { UserSettings } from "../core/game/UserSettings";
import {
  createCheckoutSession,
  getApiBase,
  getUserMe,
  invalidateUserMe,
  purchaseWithCurrency,
} from "./Api";
import { translateText } from "./Utils";

export const TEMP_FLARE_OFFSET = 1 * 60 * 1000; // 1 minute

let __cosmetics: Promise<Cosmetics | null> | null = null;
let __cosmeticsHash: string | null = null;

export type PaymentMethod = "dollar" | "hard" | "soft";

export async function purchaseCosmetic(
  resolved: ResolvedCosmetic,
  method: PaymentMethod,
): Promise<void> {
  if (!resolved.cosmetic) return;
  const c = resolved.cosmetic;
  const colorPaletteName = resolved.colorPalette?.name;

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

  // Currency purchase (hard or soft)
  const price = method === "hard" ? (c.priceHard ?? 0) : (c.priceSoft ?? 0);
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
      itemAffiliateCode: pattern.affiliateCode,
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
      itemAffiliateCode: flag.affiliateCode,
    },
    userMeResponse,
  );
}

export type ResolvedCosmetic = {
  type: "pattern" | "flag" | "pack";
  cosmetic: Pattern | Flag | Pack | null;
  colorPalette: ColorPalette | null;
  relationship: "owned" | "purchasable" | "blocked";
  /** Unique key for selection/identity, e.g. "pattern:hearts:red" or "flag:cool_flag" */
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

  return {
    flag: flag ?? undefined,
    patternName: pattern?.name ?? undefined,
    patternColorPaletteName: pattern?.colorPalette?.name ?? undefined,
  };
}

export async function getPlayerCosmetics(): Promise<PlayerCosmetics> {
  const refs = await getPlayerCosmeticsRefs();
  const cosmetics = await fetchCosmetics();

  const result: PlayerCosmetics = {};

  if (refs.flag) {
    result.flag = await resolveFlagUrl(refs.flag);
  }

  if (refs.patternName && cosmetics) {
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
  } else {
    const devPattern = new UserSettings().getDevOnlyPattern();

    if (devPattern) {
      result.pattern = {
        name: devPattern.name,
        patternData: devPattern.patternData,
        colorPalette: devPattern.colorPalette,
      };
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
