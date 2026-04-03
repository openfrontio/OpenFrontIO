import { UserMeResponse } from "../core/ApiSchemas";
import {
  ColorPalette,
  Cosmetics,
  CosmeticsSchema,
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
  hasLinkedAccount,
  purchasePatternWithWallet,
  requestUserMeRefresh,
} from "./Api";
import { renderNumber, translateText } from "./Utils";

export const TEMP_FLARE_OFFSET = 1 * 60 * 1000; // 1 minute

export async function handlePurchase(
  pattern: Pattern,
  colorPalette: ColorPalette | null,
) {
  if (pattern.product === null) {
    alert(translateText("territory_patterns.purchase_unavailable"));
    return;
  }

  const walletPrice = pattern.product.walletPrice;
  if (walletPrice) {
    const result = await purchasePatternWithWallet({
      patternName: pattern.name,
      colorPaletteName: colorPalette?.name ?? null,
      currency: walletPrice.currency,
      amount: walletPrice.amount,
    });

    if (!result.ok) {
      switch (result.reason) {
        case "insufficient_balance":
          alert(
            walletPrice.currency === "premium"
              ? translateText("territory_patterns.insufficient_premium")
              : translateText("territory_patterns.insufficient_standard"),
          );
          return;
        case "unauthorized":
          alert(translateText("territory_patterns.sign_in_to_purchase"));
          return;
        case "unavailable":
          alert(translateText("territory_patterns.purchase_unavailable"));
          return;
        default:
          alert(translateText("territory_patterns.purchase_failed"));
          return;
      }
    }

    requestUserMeRefresh(true);
    return;
  }

  if (!pattern.product.priceId) {
    alert(translateText("territory_patterns.purchase_unavailable"));
    return;
  }

  const url = await createCheckoutSession(
    pattern.product.priceId,
    colorPalette?.name ?? null,
  );
  if (url === false) {
    alert(translateText("territory_patterns.purchase_failed"));
    return;
  }

  // Redirect to Stripe checkout
  window.location.href = url;
}

export function getProductPurchaseLabel(product: Product): string {
  if (product.walletPrice?.currency === "premium") {
    return translateText("territory_patterns.buy_with_premium");
  }
  if (product.walletPrice?.currency === "standard") {
    return translateText("territory_patterns.buy_with_standard");
  }
  return translateText("territory_patterns.purchase");
}

export function getProductPriceLabel(product: Product): string | null {
  if (product.walletPrice) {
    return renderNumber(product.walletPrice.amount);
  }
  return product.price ?? null;
}

export function getProductPriceAccentClass(product: Product): string {
  if (product.walletPrice?.currency === "premium") {
    return "text-amber-200";
  }
  if (product.walletPrice?.currency === "standard") {
    return "text-sky-200";
  }
  return "text-white/60";
}

export function getPatternPurchaseState(
  pattern: Pattern,
  userMeResponse: UserMeResponse | false,
): {
  purchaseDisabled: boolean;
  purchaseReason: string | null;
} {
  if (!hasLinkedAccount(userMeResponse)) {
    return {
      purchaseDisabled: true,
      purchaseReason: translateText("territory_patterns.sign_in_to_purchase"),
    };
  }

  const walletPrice = pattern.product?.walletPrice;
  if (!walletPrice) {
    return {
      purchaseDisabled: false,
      purchaseReason: null,
    };
  }

  const balance = userMeResponse.player.balances?.[walletPrice.currency] ?? 0n;
  if (balance >= walletPrice.amount) {
    return {
      purchaseDisabled: false,
      purchaseReason: null,
    };
  }

  return {
    purchaseDisabled: true,
    purchaseReason:
      walletPrice.currency === "premium"
        ? translateText("territory_patterns.insufficient_premium")
        : translateText("territory_patterns.insufficient_standard"),
  };
}

let __cosmetics: Promise<Cosmetics | null> | null = null;
let __cosmeticsHash: string | null = null;

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

export async function getCosmeticsHash(): Promise<string | null> {
  await fetchCosmetics();
  return __cosmeticsHash;
}

export function patternRelationship(
  pattern: Pattern,
  colorPalette: { name: string; isArchived?: boolean } | null,
  userMeResponse: UserMeResponse | false,
  affiliateCode: string | null,
): "owned" | "purchasable" | "blocked" {
  const flares =
    userMeResponse === false ? [] : (userMeResponse.player.flares ?? []);
  if (flares.includes("pattern:*")) {
    return "owned";
  }

  if (colorPalette === null) {
    // For backwards compatibility only show non-colored patterns if they are owned.
    if (flares.includes(`pattern:${pattern.name}`)) {
      return "owned";
    }
    return "blocked";
  }

  const requiredFlare = `pattern:${pattern.name}:${colorPalette.name}`;

  if (flares.includes(requiredFlare)) {
    return "owned";
  }

  if (pattern.product === null) {
    // We don't own it and it's not for sale, so don't show it.
    return "blocked";
  }

  if (colorPalette?.isArchived) {
    // We don't own the color palette, and it's archived, so don't show it.
    return "blocked";
  }

  if (affiliateCode !== pattern.affiliateCode) {
    // Pattern is for sale, but it's not the right store to show it on.
    return "blocked";
  }

  // Patterns is for sale, and it's the right store to show it on.
  return "purchasable";
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

  return {
    flag: userSettings.getFlag(),
    color: userSettings.getSelectedColor() ?? undefined,
    patternName: pattern?.name ?? undefined,
    patternColorPaletteName: pattern?.colorPalette?.name ?? undefined,
  };
}

export async function getPlayerCosmetics(): Promise<PlayerCosmetics> {
  const refs = await getPlayerCosmeticsRefs();
  const cosmetics = await fetchCosmetics();

  const result: PlayerCosmetics = {};

  if (refs.flag) {
    result.flag = refs.flag;
  }

  if (refs.color) {
    result.color = { color: refs.color };
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
  }

  return result;
}
