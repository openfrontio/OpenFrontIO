import { html, TemplateResult } from "lit";
import type { TrackFlare } from "../../core/ApiSchemas";
import type { ResolvedCosmetic } from "../Cosmetics";

// A track flare's cosmetic, the way the store shows it: its preview, its name
// and what kind of cosmetic it is. For the prestige confirmation's
// rank-exclusive tile.
export interface FlareCosmeticView {
  name: string;
  // "Flag", "Nuke Explosion Effect", ...; empty when it isn't known.
  typeLabel: string;
  preview: TemplateResult;
}

// The catalog item a flare unlocks. A cosmetic's flare is "<type>:<name>"
// ("pattern:<name>:<palette>" for a coloured pattern), which is also the
// catalog's key for it, except an effect's: the catalog keys those by their
// effect type too ("effect:<effectType>:<name>").
export function findFlareCosmetic(
  items: readonly ResolvedCosmetic[],
  flareName: string,
): ResolvedCosmetic | null {
  for (const item of items) {
    if (item.cosmetic === null) continue;
    const flare =
      item.type === "effect"
        ? `effect:${item.key.split(":").slice(2).join(":")}`
        : item.key;
    if (flare === flareName) return item;
  }
  return null;
}

// The cosmetic's own name when the catalog doesn't have it: "solar_corona"
// reads "Solar Corona".
function plainName(name: string): string {
  return name
    .split("_")
    .filter((word) => word.length > 0)
    .map((word) => word[0].toUpperCase() + word.substring(1))
    .join(" ");
}

function fallbackPreview(url: string | null | undefined): TemplateResult {
  if (url) {
    return html`<img
      src=${url}
      alt=""
      class="h-full w-full object-contain"
      draggable="false"
    />`;
  }
  return html`<svg
    viewBox="0 0 24 24"
    width="40"
    height="40"
    aria-hidden="true"
  >
    <path
      fill="var(--tier)"
      d="M12 2l2.4 6.6L21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.4z"
    />
  </svg>`;
}

/**
 * What the flare itself says about its cosmetic, before (or without) the
 * catalog: the name from the flare, no type, and its own image or a sparkle.
 * Null when the flare isn't a cosmetic.
 */
export function plainFlareCosmetic(
  flare: TrackFlare,
): FlareCosmeticView | null {
  const cosmetic = flare.cosmetic ?? null;
  if (cosmetic === null) return null;
  return {
    name: plainName(cosmetic.name),
    typeLabel: "",
    preview: fallbackPreview(cosmetic.url),
  };
}

/**
 * Describes the cosmetic a flare unlocks, from the cosmetics catalog when it
 * has the item, else from what the flare itself says. Null when the flare
 * isn't a cosmetic. The catalog and the preview components are loaded on
 * demand: most confirmations have no exclusive tile.
 */
export async function describeFlareCosmetic(
  flare: TrackFlare,
): Promise<FlareCosmeticView | null> {
  const cosmetic = flare.cosmetic ?? null;
  if (cosmetic === null) return null;
  let resolved: ResolvedCosmetic | null = null;
  let presentation: typeof import("./CosmeticPresentation") | null = null;
  try {
    const [catalog, pres] = await Promise.all([
      import("../Cosmetics"),
      import("./CosmeticPresentation"),
      import("./CosmeticPreview"),
    ]);
    presentation = pres;
    const cosmetics = await catalog.fetchCosmetics();
    resolved = findFlareCosmetic(
      catalog.resolveCosmetics(cosmetics, false, null),
      flare.flareName,
    );
  } catch (err) {
    console.warn("describeFlareCosmetic: catalog unavailable", err);
  }
  if (resolved === null || presentation === null) {
    return plainFlareCosmetic(flare);
  }
  return {
    name: presentation.cosmeticSelectionLabel(resolved),
    typeLabel: presentation.cosmeticTypeLabel(resolved),
    preview: html`<cosmetic-preview
      class="block h-full w-full"
      .resolved=${resolved}
      size="card"
    ></cosmetic-preview>`,
  };
}
