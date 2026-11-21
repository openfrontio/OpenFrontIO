// The DOM-free entry of @openfront/cosmetic-preview
// (`@openfront/cosmetic-preview/checks`): the card background schema and
// checks, for a host's server to re-check what its page already checked.
// Nothing here may import the renderer, CSS or anything that needs a
// document.

import {
  type LayerAnimation,
  LayerAnimationSchema,
} from "@openfront/shared/CardBackgroundAnimation";
import {
  type CardBackgroundFiles,
  type CardIssue,
  checkCardBackground as checkCardBackgroundFiles,
  checkLayerSources,
  isCatalogueLayerSrc,
} from "@openfront/shared/CardBackgroundChecks";
import { z } from "zod/v4";

export {
  CARD_ART_HEIGHT,
  CARD_ART_WIDTH,
  isCatalogueLayerSrc,
  MAX_LAYERS,
  MAX_SET_BYTES,
} from "@openfront/shared/CardBackgroundChecks";

// Unlike the game's schema, this entry also requires each layer's src to be
// a relative catalogue path (a PNG's path or file name): what it checks is
// stored and sent on, never a browser's blob: preview. The game's schema
// stays as it is, because the previewer draws layers from blob: URLs with it.

/**
 * The game's checks, plus a `layer_src` error for each layer whose src isn't
 * a relative catalogue path. Check with the srcs that will be stored.
 */
export function checkCardBackground(
  files: CardBackgroundFiles,
  animation: unknown,
): CardIssue[] {
  const issues = checkCardBackgroundFiles(files, animation);
  const sources = checkLayerSources(animation);
  if (sources.length === 0) return issues;
  // Errors before warnings, as the game's checks order them.
  const firstWarning = issues.findIndex((i) => i.level === "warning");
  const at = firstWarning === -1 ? issues.length : firstWarning;
  return [...issues.slice(0, at), ...sources, ...issues.slice(at)];
}

export type CardAnimationResult =
  | { ok: true; animation: LayerAnimation }
  | { ok: false; error: string };

/** Parse a layer animation with the game's own schema. */
export function parseCardAnimation(input: unknown): CardAnimationResult {
  const parsed = LayerAnimationSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: z.prettifyError(parsed.error) };
  }
  const bad = parsed.data.layers.findIndex((l) => !isCatalogueLayerSrc(l.src));
  if (bad !== -1) {
    return {
      ok: false,
      error: `layer ${bad + 1} src must be a relative path to a PNG, like /cosmetics/card-backgrounds/bg_name_fx-pulse.png`,
    };
  }
  return { ok: true, animation: parsed.data };
}
