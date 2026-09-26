// What a host app may ask the cosmetic preview to show.
//
// The preview library (see index.ts) renders CosmeticRenderCanvas — the
// store's own preview component — so the one thing this module does is turn a
// request into the ResolvedCosmetic that component already knows how to draw.
// It deliberately speaks in cosmetics (a pattern, a skin, an effect), never in
// render modes: the mapping from a cosmetic to a CosmeticPreviewConfig lives in
// CosmeticRenderCanvas.buildPreviewConfig, and duplicating it here is exactly
// the drift this library exists to end (openfrontio/opendash#74).
//
// Every field is validated with the catalogue's own schemas, so the preview
// accepts precisely what the store could sell and nothing else.

import { z } from "zod";
import {
  EffectSchema,
  PatternDataSchema,
  type Effect,
  type Pattern,
  type Skin,
} from "../../core/CosmeticSchemas";
import type { ResolvedCosmetic } from "../Cosmetics";

const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);

// A submission's pattern need not be in the catalogue yet: that is the point of
// previewing it. So a pattern is its raw data plus the two colours to paint it
// in; without colours, the store's own default applies.
const PatternRequest = z.object({
  type: z.literal("pattern"),
  pattern: PatternDataSchema,
  colors: z.tuple([HexColor, HexColor]).optional(),
});

const SkinRequest = z.object({
  type: z.literal("skin"),
  // The renderer loads this into a WebGL texture, so its host must allow CORS.
  url: z.url({ protocol: /^https$/ }),
});

const EffectRequest = z.object({
  type: z.literal("effect"),
  effect: EffectSchema,
});

export const PreviewRequestSchema = z.discriminatedUnion("type", [
  PatternRequest,
  SkinRequest,
  EffectRequest,
]);
export type PreviewRequest = z.infer<typeof PreviewRequestSchema>;

export type PreviewRequestResult =
  | { ok: true; request: PreviewRequest }
  | { ok: false; error: string };

export function parsePreviewRequest(input: unknown): PreviewRequestResult {
  const parsed = PreviewRequestSchema.safeParse(input);
  return parsed.success
    ? { ok: true, request: parsed.data }
    : { ok: false, error: z.prettifyError(parsed.error) };
}

// Placeholder name for a cosmetic that has none of its own. Never shown.
const PREVIEW_NAME = "preview";

// The request as the store component expects it. `relationship` only affects
// store chrome the preview never draws.
export function toResolvedCosmetic(req: PreviewRequest): ResolvedCosmetic {
  if (req.type === "pattern") {
    const cosmetic: Pattern = {
      name: PREVIEW_NAME,
      pattern: req.pattern,
      product: null,
      rarity: "common",
    };
    return {
      type: "pattern",
      cosmetic,
      colorPalette: req.colors
        ? {
            name: PREVIEW_NAME,
            primaryColor: req.colors[0],
            secondaryColor: req.colors[1],
          }
        : null,
      relationship: "owned",
      key: `pattern:${PREVIEW_NAME}`,
    };
  }
  if (req.type === "skin") {
    const cosmetic: Skin = {
      name: PREVIEW_NAME,
      url: req.url,
      product: null,
      rarity: "common",
    };
    return {
      type: "skin",
      cosmetic,
      colorPalette: null,
      relationship: "owned",
      key: `skin:${PREVIEW_NAME}`,
    };
  }
  const effect: Effect = req.effect;
  return {
    type: "effect",
    cosmetic: effect,
    colorPalette: null,
    relationship: "owned",
    // CosmeticRenderCanvas reads the key to tell a MIRV from a single nuke.
    key: `effect:${effect.effectType}:${effect.name}`,
    effectType: effect.effectType,
  };
}
