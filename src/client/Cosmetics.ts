import { UserMeResponse } from "../core/ApiSchemas";
import {
  ColorPalette,
  Cosmetics,
  CosmeticsSchema,
  Pattern,
} from "../core/CosmeticSchemas";
import {
  PlayerCosmeticRefs,
  PlayerCosmetics,
  PlayerPattern,
} from "../core/Schemas";
import { UserSettings } from "../core/game/UserSettings";
import { createCheckoutSession, getApiBase, getUserMe } from "./Api";

export const TEMP_FLARE_OFFSET = 1 * 60 * 1000; // 1 minute

export async function handlePurchase(
  pattern: Pattern,
  colorPalette: ColorPalette | null,
) {
  if (pattern.product === null) {
    alert("This pattern is not available for purchase.");
    return;
  }

  const url = await createCheckoutSession(
    pattern.product.priceId,
    colorPalette?.name ?? null,
  );
  if (url === false) {
    alert("Failed to create checkout session.");
    return;
  }

  // Redirect to Stripe checkout
  window.location.href = url;
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
