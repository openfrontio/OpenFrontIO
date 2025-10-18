import { UserMeResponse } from "../core/ApiSchemas";
import {
  ColorPalette,
  Cosmetics,
  CosmeticsSchema,
  Pattern,
} from "../core/CosmeticSchemas";
import { getApiBase, getAuthHeader } from "./jwt";
import { getPersistentID } from "./Main";

export async function handlePurchase(
  pattern: Pattern,
  colorPalette: ColorPalette | null,
) {
  if (pattern.product === null) {
    alert("This pattern is not available for purchase.");
    return;
  }

  const response = await fetch(
    `${getApiBase()}/stripe/create-checkout-session`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        authorization: getAuthHeader(),
        "X-Persistent-Id": await getPersistentID(),
      },
      body: JSON.stringify({
        priceId: pattern.product.priceId,
        hostname: window.location.origin,
        colorPaletteName: colorPalette?.name,
      }),
    },
  );

  if (!response.ok) {
    console.error(
      `Error purchasing pattern:${response.status} ${response.statusText}`,
    );
    if (response.status === 401) {
      alert("You are not logged in. Please log in to purchase a pattern.");
    } else {
      alert("Something went wrong. Please try again later.");
    }
    return;
  }

  const { url } = await response.json();

  // Redirect to Stripe checkout
  window.location.href = url;
}

export async function fetchCosmetics(): Promise<Cosmetics | null> {
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
    return result.data;
  } catch (error) {
    console.error("Error getting cosmetics:", error);
    return null;
  }
}

export function patternRelationship(
  pattern: Pattern,
  colorPalette: { name: string; isArchived?: boolean } | null,
  userMeResponse: UserMeResponse | null,
  affiliateCode: string | null,
): "owned" | "purchasable" | "blocked" {
  const flares = userMeResponse?.player.flares ?? [];
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
