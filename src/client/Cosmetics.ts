import { UserMeResponse } from "../core/ApiSchemas";
import { COSMETICS } from "../core/CosmeticSchemas";
import { getApiBase, getAuthHeader } from "./jwt";
import { translateText } from "./Utils";

interface StripeProduct {
  id: string;
  object: "product";
  active: boolean;
  created: number;
  description: string | null;
  images: string[];
  livemode: boolean;
  metadata: Record<string, string>;
  name: string;
  shippable: boolean | null;
  type: "good" | "service";
  updated: number;
  url: string | null;
  price: string;
  price_id: string;
}

export interface Pattern {
  name: string;
  key: string;
  roles: string[];
  price?: string;
  priceId?: string;
  lockedReason?: string;
  notShown?: boolean;
}

export async function patterns(
  userMe: UserMeResponse | null,
): Promise<Pattern[]> {
  const patterns: Pattern[] = Object.entries(COSMETICS.patterns).map(
    ([key, patternData]) => {
      return {
        name: patternData.name,
        key,
        roles: patternData.role_group
          ? (COSMETICS.role_groups[patternData.role_group] ?? [])
          : [],
      };
    },
  );

  const products = await listAllProducts();
  patterns.forEach((pattern) => {
    addRestrictions(pattern, userMe, products);
  });
  return patterns;
}

function addRestrictions(
  pattern: Pattern,
  userMe: UserMeResponse | null,
  products: Map<string, StripeProduct>,
) {
  if (userMe === null) {
    if (products.has(`pattern:${pattern.name}`)) {
      // Purchasable (flare-gated) patterns are shown as disabled
      pattern.lockedReason = translateText("territory_patterns.blocked.login");
    } else {
      // Role-gated patterns are not shown
      pattern.notShown = true;
    }
    return;
  }
  const flares = userMe.player.flares ?? [];
  if (
    flares.includes("pattern:*") ||
    flares.includes(`pattern:${pattern.name}`)
  ) {
    // Pattern is unlocked by flare
    return;
  }

  const myRoles = userMe.player.roles ?? [];
  if (
    pattern.roles.some((authorizedRole) => myRoles.includes(authorizedRole))
  ) {
    // Pattern is unlocked by role
    return;
  }

  const product = products.get(`pattern:${pattern.name}`);
  if (product) {
    pattern.price = product.price;
    pattern.priceId = product.price_id;
    pattern.lockedReason = translateText("territory_patterns.blocked.purchase");
    return;
  }

  // Pattern is locked by role group and not purchasable, don't show it.
  pattern.notShown = true;
}

export async function handlePurchase(priceId: string) {
  try {
    const response = await fetch(
      `${getApiBase()}/stripe/create-checkout-session`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          authorization: getAuthHeader(),
        },
        body: JSON.stringify({
          priceId: priceId,
          successUrl: `${window.location.origin}?purchase=success`,
          cancelUrl: `${window.location.origin}?purchase=cancel`,
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const { url } = await response.json();

    // Redirect to Stripe checkout
    window.location.href = url;
  } catch (error) {
    console.error("Purchase error:", error);
    alert("Something went wrong. Please try again later.");
  }
}

// Returns a map of flare -> product
export async function listAllProducts(): Promise<Map<string, StripeProduct>> {
  try {
    const response = await fetch(`${getApiBase()}/stripe/products`);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const products = (await response.json()) as StripeProduct[];
    const productMap = new Map<string, StripeProduct>();
    products.forEach((product) => {
      productMap.set(product.metadata.flare, product);
    });
    return productMap;
  } catch (error) {
    console.error("Failed to fetch products:", error);
    return new Map();
  }
}
