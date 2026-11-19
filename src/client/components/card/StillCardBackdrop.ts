import { assetUrl } from "@openfront/shared/AssetUrls";
import type { Cosmetics } from "@openfront/shared/CosmeticSchemas";

// A card background as a still backdrop behind text that isn't a card: the
// lobby name tag and the hover player summary. Never animated: these places
// sit beside a running game or lobby and must cost nothing per frame, so the
// effect layers (CardFx) are never loaded here.

// The equipped background's image path, or null when there is no background
// or the catalogue doesn't have it (not loaded yet, or the item was removed).
export function cardBackgroundUrl(
  name: string | undefined,
  cosmetics: Cosmetics | null,
): string | null {
  if (name === undefined || cosmetics === null) return null;
  return cosmetics.cardBackgrounds?.[name]?.url ?? null;
}

// Dark enough over the brightest art for the white name, troop and gold text
// to read as well as on today's flat fill.
export const STILL_BACKDROP_SHADE =
  "linear-gradient(90deg, rgba(8,15,30,0.82) 0%, rgba(8,15,30,0.62) 60%, rgba(8,15,30,0.48) 100%)";

// The CSS background layers: the shade over the art.
export function stillBackdropLayers(url: string): string {
  // Quoted, so a stray quote, backslash or newline can't end the url().
  const src = assetUrl(url).replace(/["\\\n\r]/g, (c) => `\\${c}`);
  return `${STILL_BACKDROP_SHADE}, url("${src}")`;
}

// Inline CSS for an element whose own background becomes the art: cropped like
// `cover` to the centre band of the 2800×400 image, under the shade. Being a
// background, it changes nothing about the element's size or children.
export function stillBackdropStyle(url: string): string {
  return (
    `background-image: ${stillBackdropLayers(url)};` +
    " background-size: cover; background-position: center;"
  );
}
