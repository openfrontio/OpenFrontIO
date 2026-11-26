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
  type LayerSrcOptions,
} from "@openfront/shared/CardBackgroundChecks";
import { z } from "zod/v4";

export {
  CARD_ART_HEIGHT,
  CARD_ART_WIDTH,
  isCatalogueLayerSrc,
  MAX_LAYERS,
  MAX_SET_BYTES,
} from "@openfront/shared/CardBackgroundChecks";
export type { LayerSrcOptions } from "@openfront/shared/CardBackgroundChecks";
// The card check types, as the package root also exports them, so a server
// can import everything it needs from this entry.
export type {
  CardBackgroundFiles,
  CardCheckImage,
  CardEffect,
  CardIssue,
  CardIssueCode,
} from "./cardCheckTypes";

// Unlike the game's schema, this entry also requires each layer's src to be
// a catalogue PNG (a relative path, a file name, or an https:// link from an
// origin in `allowedLayerHosts`, under /cosmetics/): what it checks is
// stored and sent on, never a browser's blob: preview. The game's schema
// stays as it is, because the previewer draws layers from blob: URLs with it.

/**
 * The game's checks, plus a `layer_src` error for each layer whose src isn't
 * a catalogue PNG path, or an https:// link allowed by `options`. Check with
 * the srcs that will be stored.
 *
 * On a server, take each file's `type` from the bytes received (sniff the
 * magic number), never from the browser's File.type: that comes from the
 * file name, so a renamed file would pass as a PNG.
 */
export function checkCardBackground(
  files: CardBackgroundFiles,
  animation: unknown,
  options: LayerSrcOptions = {},
): CardIssue[] {
  const issues = checkCardBackgroundFiles(files, animation);
  const sources = checkLayerSources(animation, options);
  if (sources.length === 0) return issues;
  // Errors before warnings, as the game's checks order them.
  const firstWarning = issues.findIndex((i) => i.level === "warning");
  const at = firstWarning === -1 ? issues.length : firstWarning;
  return [...issues.slice(0, at), ...sources, ...issues.slice(at)];
}

/** A layer animation as the game's schema accepts it. */
export type CardLayerAnimation = LayerAnimation;

export type CardAnimationResult =
  | { ok: true; animation: LayerAnimation }
  | { ok: false; error: string };

/**
 * Parse a layer animation with the game's own schema, and check each layer's
 * src as checkCardBackground does.
 */
export function parseCardAnimation(
  input: unknown,
  options: LayerSrcOptions = {},
): CardAnimationResult {
  const parsed = LayerAnimationSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: z.prettifyError(parsed.error) };
  }
  const bad = parsed.data.layers.findIndex(
    (l) => !isCatalogueLayerSrc(l.src, options),
  );
  if (bad !== -1) {
    return {
      ok: false,
      error: `layer ${bad + 1} src must be a PNG at a relative path, like /cosmetics/card-backgrounds/bg_name_fx-pulse.png, or an https:// link to one under /cosmetics/ on an allowed host`,
    };
  }
  return { ok: true, animation: parsed.data };
}
