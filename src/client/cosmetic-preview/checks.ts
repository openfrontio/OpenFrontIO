// The DOM-free entry of @openfront/cosmetic-preview
// (`@openfront/cosmetic-preview/checks`): the card background schema and
// checks, for a host's server to re-check what its page already checked.
// Nothing here may import the renderer, CSS or anything that needs a
// document.

import {
  type LayerAnimation,
  LayerAnimationSchema,
} from "@openfront/shared/CardBackgroundAnimation";
import { z } from "zod/v4";

export {
  CARD_ART_HEIGHT,
  CARD_ART_WIDTH,
  checkCardBackground,
  MAX_LAYERS,
  MAX_SET_BYTES,
} from "@openfront/shared/CardBackgroundChecks";

export type CardAnimationResult =
  | { ok: true; animation: LayerAnimation }
  | { ok: false; error: string };

/** Parse a layer animation with the game's own schema. */
export function parseCardAnimation(input: unknown): CardAnimationResult {
  const parsed = LayerAnimationSchema.safeParse(input);
  return parsed.success
    ? { ok: true, animation: parsed.data }
    : { ok: false, error: z.prettifyError(parsed.error) };
}
