/**
 * EffectPalette — packs a catalog effect into one entry of the per-player
 * effect-palette texture (RGBA32F, PALETTE_SIZE × MAX_TRAIL_COLORS·blocks).
 *
 * Single source of truth for the layout the shaders read (trail.frag.glsl,
 * structure.frag.glsl, unit.frag.glsl, railroad.frag.glsl): row r of an
 * entry holds color r in RGB (zero past the color list), and the alpha
 * channel of rows 0..3 carries [colorCount, styleId, scalar0, scalar1] with
 * styleId 0 = gradient (colorSize, movementSpeed), 1 = transition
 * (frequency), 2 = spiral (rotationSpeed). Used by the in-game
 * WebGLFrameBuilder and the store's cosmetic preview so both encode the
 * same catalog attributes the same way.
 */

import { colord } from "colord";
import type {
  StructuresEffectAttributes,
  TrailEffectAttributes,
} from "../../../../core/CosmeticSchemas";
import { MAX_TRAIL_COLORS } from "./ColorUtils";

/** Catalog attributes of every effect that renders through the effect palette. */
export type PaletteEffectAttributes =
  | TrailEffectAttributes
  | StructuresEffectAttributes;

/** Floats in one packed entry: MAX_TRAIL_COLORS rows × RGBA. */
export const EFFECT_ENTRY_FLOATS = MAX_TRAIL_COLORS * 4;

/**
 * Catalog color strings → 0..1 RGB triples. Unparseable entries are dropped
 * (so a fully bad list degrades to "no effect") and the list is capped at
 * the palette's row count.
 */
export function parseEffectColors(
  colors: readonly string[],
): [number, number, number][] {
  return colors
    .map((s) => colord(s))
    .filter((c) => c.isValid())
    .slice(0, MAX_TRAIL_COLORS)
    .map((c) => {
      const { r, g, b } = c.toRgb();
      return [r / 255, g / 255, b / 255];
    });
}

/** Write the packed entry for `attrs` into `out` (EFFECT_ENTRY_FLOATS floats). */
export function packEffectEntry(
  attrs: PaletteEffectAttributes,
  out: Float32Array,
): void {
  const colors = parseEffectColors(attrs.colors);
  let styleId: number;
  let scalar0: number;
  let scalar1: number;
  if (attrs.type === "transition") {
    styleId = 1;
    scalar0 = attrs.frequency;
    scalar1 = 0;
  } else if (attrs.type === "spiral") {
    styleId = 2;
    scalar0 = attrs.rotationSpeed;
    scalar1 = 0;
  } else {
    styleId = 0;
    scalar0 = attrs.colorSize;
    scalar1 = attrs.movementSpeed;
  }
  const alphas = [colors.length, styleId, scalar0, scalar1];
  for (let r = 0; r < MAX_TRAIL_COLORS; r++) {
    const off = r * 4;
    const c = colors[r];
    out[off] = c ? c[0] : 0;
    out[off + 1] = c ? c[1] : 0;
    out[off + 2] = c ? c[2] : 0;
    out[off + 3] = alphas[r] ?? 0;
  }
}
