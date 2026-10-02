/**
 * A player's slot in the renderer's palette textures: territory and border
 * colours, territory pattern, and cosmetic effects. The live game
 * (WebGLFrameBuilder) and replays (src/client/replay) fill the same
 * textures, so both write them here.
 */

import type { Colord } from "colord";
import { base64url } from "jose";
import {
  findEffect,
  isTrailEffect,
  TRAIL_EFFECT_TYPES,
  type Cosmetics,
} from "../../../../core/CosmeticSchemas";
import { decodePatternData } from "../../../../core/PatternDecoder";
import type { PlayerCosmetics } from "../../../../core/Schemas";
import type { SpiralParams } from "../../frame/SpiralTrails";
import {
  getPaletteSize,
  MAX_TRAIL_COLORS,
  RAILROAD_EFFECT_BLOCK,
  STRUCTURES_EFFECT_BLOCK,
  TRAIN_EFFECT_BLOCK,
  WARSHIP_EFFECT_BLOCK,
} from "./ColorUtils";
import {
  EFFECT_ENTRY_FLOATS,
  packEffectEntry,
  parseEffectColors,
  type PaletteEffectAttributes,
} from "./EffectPalette";

/** Player slots, indexed by smallID. */
export const PALETTE_SIZE = getPaletteSize();

/** Territory fill alpha. */
const FILL_ALPHA = 150 / 255;

/**
 * The effect palette's blocks, in the order the shaders read them
 * (rows block·MAX_TRAIL_COLORS …): trail.frag.glsl picks block 0
 * (transportShipTrail) or 1 (nukeTrail) from the trail tile's nuke bit,
 * structure.frag.glsl reads block 2, unit.frag.glsl blocks 3 (warship) and
 * 4 (train), railroad.frag.glsl block 5. nukeExplosion is not palette-styled;
 * it renders through the FX pass.
 */
export const PALETTE_EFFECT_TYPES = [
  ...TRAIL_EFFECT_TYPES,
  "structures",
  "warship",
  "train",
  "railroad",
] as const;
export type PaletteEffectType = (typeof PALETTE_EFFECT_TYPES)[number];

// Reordering TRAIL_EFFECT_TYPES (CosmeticSchemas) or moving the other blocks
// would silently swap effect colours, so these fail the build if the
// shader-coupled order ever drifts.
const _TRAIL_BLOCKS: readonly ["transportShipTrail", "nukeTrail"] =
  TRAIL_EFFECT_TYPES;
void _TRAIL_BLOCKS;
const _STRUCTURES_BLOCK_IS_2: 2 = STRUCTURES_EFFECT_BLOCK;
void _STRUCTURES_BLOCK_IS_2;
const _WARSHIP_BLOCK_IS_3: 3 = WARSHIP_EFFECT_BLOCK;
void _WARSHIP_BLOCK_IS_3;
const _TRAIN_BLOCK_IS_4: 4 = TRAIN_EFFECT_BLOCK;
void _TRAIN_BLOCK_IS_4;
const _RAILROAD_BLOCK_IS_5: 5 = RAILROAD_EFFECT_BLOCK;
void _RAILROAD_BLOCK_IS_5;

/** Territory fill (translucent) and border colours. */
export function writePaletteEntry(
  palette: Float32Array,
  smallID: number,
  fill: Colord,
  border: Colord,
): void {
  const f = fill.toRgb();
  const fillOff = smallID * 4;
  palette[fillOff] = f.r / 255;
  palette[fillOff + 1] = f.g / 255;
  palette[fillOff + 2] = f.b / 255;
  palette[fillOff + 3] = FILL_ALPHA;

  const b = border.toRgb();
  const borderOff = PALETTE_SIZE * 4 + smallID * 4;
  palette[borderOff] = b.r / 255;
  palette[borderOff + 1] = b.g / 255;
  palette[borderOff + 2] = b.b / 255;
  palette[borderOff + 3] = 1;
}

/** A player's territory pattern, or none (clearing an earlier one). */
export function writePatternEntry(
  meta: Float32Array,
  data: Uint8Array,
  smallID: number,
  pattern: PlayerCosmetics["pattern"],
): void {
  const metaOff = smallID * 4;
  meta.fill(0, metaOff, metaOff + 4);
  if (!pattern?.patternData) return;
  try {
    const decoded = decodePatternData(pattern.patternData, base64url.decode);
    const numBytes = (decoded.width * decoded.height + 7) >> 3;
    if (numBytes > 1024) return;
    data.set(decoded.bytes.subarray(3, 3 + numBytes), smallID * 1024);
    meta[metaOff] = 1; // hasPattern
    meta[metaOff + 1] = decoded.width;
    meta[metaOff + 2] = decoded.height;
    meta[metaOff + 3] = decoded.scale;
  } catch (e) {
    console.warn("Failed to decode territory pattern", e);
  }
}

/**
 * A player's equipped catalog effect for a palette-styled effect type, or
 * undefined when none is equipped or the catalog entry isn't of that shape.
 */
export function catalogEffectAttributes(
  catalog: Cosmetics,
  effects: PlayerCosmetics["effects"],
  effectType: PaletteEffectType,
): PaletteEffectAttributes | undefined {
  const selected = effects?.[effectType];
  if (!selected) return undefined;
  const effect = findEffect(catalog, effectType, selected.name);
  if (!effect || effect.effectType !== effectType) return undefined;
  // Narrows attributes to trail attrs (structures/warship/train/railroad
  // share the shape).
  if (
    !isTrailEffect(effect) &&
    effect.effectType !== "structures" &&
    effect.effectType !== "warship" &&
    effect.effectType !== "train" &&
    effect.effectType !== "railroad"
  ) {
    return undefined;
  }
  return effect.attributes;
}

/**
 * Write one packed effect entry (packEffectEntry's layout, or zeros for
 * `null`: no effect, so the shaders fall back to the player colour) into
 * block `block` of the effect palette. Returns whether anything changed, so
 * a caller can re-upload only when needed.
 */
export function writeEffectEntry(
  effectPalette: Float32Array,
  smallID: number,
  block: number,
  entry: Float32Array | null,
): boolean {
  const rowBase = block * MAX_TRAIL_COLORS;
  let changed = false;
  for (let r = 0; r < MAX_TRAIL_COLORS; r++) {
    const off = ((rowBase + r) * PALETTE_SIZE + smallID) * 4;
    for (let i = 0; i < 4; i++) {
      const value = entry === null ? 0 : entry[r * 4 + i];
      if (effectPalette[off + i] !== value) {
        effectPalette[off + i] = value;
        changed = true;
      }
    }
  }
  return changed;
}

/** Where a player's spiral nuke trail goes (the view's SpiralTrails). */
export interface SpiralSink {
  setNukeTrailSpiral(smallID: number, params: SpiralParams): void;
  clearNukeTrailSpiral(smallID: number): void;
}

const effectEntryScratch = new Float32Array(EFFECT_ENTRY_FLOATS);

/**
 * Write every effect block of a player's slot in the effect palette, and
 * set or clear their spiral nuke trail. `attrsFor` gives the effect of each
 * type, or undefined for none (the shaders then use the player colour).
 * Returns whether the palette changed.
 */
export function writePlayerEffects(
  effectPalette: Float32Array,
  smallID: number,
  attrsFor: (
    effectType: PaletteEffectType,
  ) => PaletteEffectAttributes | undefined,
  spirals: SpiralSink,
): boolean {
  let changed = false;
  PALETTE_EFFECT_TYPES.forEach((effectType, block) => {
    const attrs = attrsFor(effectType);
    if (effectType === "nukeTrail") {
      // Spiral vortexes render as ribbon geometry (SpiralRibbonPass). The
      // colours are parsed here so a list that doesn't parse at all falls
      // back to the plain stamped trail instead of an uncoloured vortex.
      const colors =
        attrs?.type === "spiral" ? parseEffectColors(attrs.colors) : [];
      if (attrs?.type === "spiral" && colors.length > 0) {
        spirals.setNukeTrailSpiral(smallID, {
          radius: attrs.radius,
          strands: attrs.strands,
          rotationSpeed: attrs.rotationSpeed,
          colors,
        });
      } else {
        spirals.clearNukeTrailSpiral(smallID);
      }
    }
    let entry: Float32Array | null = null;
    if (attrs !== undefined) {
      packEffectEntry(attrs, effectEntryScratch);
      entry = effectEntryScratch;
    }
    if (writeEffectEntry(effectPalette, smallID, block, entry)) changed = true;
  });
  return changed;
}
