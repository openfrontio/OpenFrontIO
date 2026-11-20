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

// A CSS background can't report a failed load, so each image is preloaded
// first and only used once it has loaded: until then, and for good if it
// fails, the element keeps today's look exactly.
type LoadState = "loading" | "loaded" | "failed";
const loadStates = new Map<string, LoadState>();
const waiting = new Map<string, Set<() => void>>();

// The background's image path once its image has loaded, else null. Starts
// the load on first ask; `onLoaded` runs once it has, so the caller can
// re-render (not on failure: nothing changes then).
export function loadedCardBackgroundUrl(
  name: string | undefined,
  cosmetics: Cosmetics | null,
  onLoaded: () => void,
): string | null {
  const url = cardBackgroundUrl(name, cosmetics);
  if (url === null) return null;
  const state = loadStates.get(url);
  if (state === "loaded") return url;
  if (state === "failed") return null;
  let callbacks = waiting.get(url);
  if (callbacks === undefined) {
    callbacks = new Set();
    waiting.set(url, callbacks);
  }
  callbacks.add(onLoaded);
  if (state === undefined && typeof Image !== "undefined") {
    loadStates.set(url, "loading");
    const img = new Image();
    const settle = (result: LoadState) => {
      loadStates.set(url, result);
      const toCall = waiting.get(url);
      waiting.delete(url);
      if (result === "loaded") for (const cb of toCall ?? []) cb();
    };
    img.onload = () => settle("loaded");
    img.onerror = () => settle("failed");
    img.decoding = "async";
    img.src = assetUrl(url);
  }
  return null;
}

// Tests only: forget every image's load state.
export function resetCardBackdropLoadsForTests(): void {
  loadStates.clear();
  waiting.clear();
}

// Dark enough over the brightest art for the white name, troop and gold text
// to read as well as on today's flat fill.
export const STILL_BACKDROP_SHADE =
  "linear-gradient(90deg, rgba(8,15,30,0.82) 0%, rgba(8,15,30,0.62) 60%, rgba(8,15,30,0.48) 100%)";

// The current player's lobby tag is marked by a blue fill
// (`.player-tag.current-player`); over art, that blue goes on top as a tint
// so the tag stays clearly theirs.
export const CURRENT_PLAYER_TINT =
  "linear-gradient(rgba(14,165,233,0.32), rgba(14,165,233,0.32))";

// The CSS background layers: the shade over the art (and the tint over both).
export function stillBackdropLayers(url: string, current = false): string {
  // Quoted, so a stray quote, backslash or newline can't end the url().
  const src = assetUrl(url).replace(/["\\\n\r]/g, (c) => `\\${c}`);
  const tint = current ? `${CURRENT_PLAYER_TINT}, ` : "";
  return `${tint}${STILL_BACKDROP_SHADE}, url("${src}")`;
}

// Inline CSS for an element whose own background becomes the art: cropped like
// `cover` to the centre band of the 2800×400 image, under the shade. Being a
// background, it changes nothing about the element's size or children.
export function stillBackdropStyle(url: string, current = false): string {
  return (
    `background-image: ${stillBackdropLayers(url, current)};` +
    " background-size: cover; background-position: center;"
  );
}
