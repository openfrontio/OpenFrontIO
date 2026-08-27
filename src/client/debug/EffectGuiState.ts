/**
 * Effect-editor state and its conversion into catalog-shaped cosmetic
 * attributes. Pure (no DOM / lil-gui) so it can be unit-tested; the panel in
 * EffectGui.ts binds lil-gui controllers to these objects.
 */

import {
  type EffectType,
  NUKE_EXPLOSION_TYPES,
  NukeExplosionAttributesSchema,
  type NukeExplosionType,
  StructuresEffectAttributesSchema,
  TrailEffectAttributesSchema,
} from "../../core/CosmeticSchemas";
import type { EffectOverrideAttributes } from "../WebGLFrameBuilder";

/** Max colors a slot can carry — the effect palette holds 8 rows per block. */
export const EFFECT_GUI_MAX_COLORS = 8;

/** Attribute `type` options per effect slot (mirrors the catalog schemas). */
export const EFFECT_GUI_TYPES: Record<EffectType, readonly string[]> = {
  transportShipTrail: ["gradient", "transition", "spiral"],
  nukeTrail: ["gradient", "transition", "spiral"],
  structures: ["gradient", "transition"],
  warship: ["gradient", "transition"],
  nukeExplosion: ["shockwave", "sparkles", "embers"],
};

/**
 * One slot's editable state. Every attribute of every `type` lives here so
 * lil-gui can bind a controller per field; `slotAttributes` picks the ones
 * the current `type` uses. Colors are "#rrggbb" strings like the catalog.
 */
export interface EffectSlotState {
  enabled: boolean;
  type: string;
  nukeType: NukeExplosionType;
  colorCount: number;
  colors: string[];
  // gradient
  colorSize: number;
  movementSpeed: number;
  // transition
  frequency: number;
  // spiral
  radius: number;
  strands: number;
  rotationSpeed: number;
  // nuke explosion
  size: number;
  speed: number;
  thickness: number;
  transitionSpeed: number;
  density: number;
}

export function defaultSlotState(effectType: EffectType): EffectSlotState {
  return {
    enabled: false,
    type: EFFECT_GUI_TYPES[effectType][0],
    nukeType: NUKE_EXPLOSION_TYPES[0],
    colorCount: 2,
    colors: [
      "#ff4dd2",
      "#4dd2ff",
      "#ffffff",
      "#ffb84d",
      "#b84dff",
      "#4dff88",
      "#ff4d4d",
      "#ffff4d",
    ],
    colorSize: 4,
    movementSpeed: 10,
    frequency: 1,
    radius: 6,
    strands: 3,
    rotationSpeed: 4,
    size: 210,
    speed: 140,
    thickness: 4,
    transitionSpeed: 0,
    density: 300,
  };
}

/** The attribute fields shown for a given slot + type (for show/hide). */
export function fieldsForType(
  effectType: EffectType,
  type: string,
): ReadonlySet<keyof EffectSlotState> {
  const base: (keyof EffectSlotState)[] = ["colorCount", "colors"];
  if (effectType === "nukeExplosion") {
    base.push("nukeType", "size", "speed", "thickness", "transitionSpeed");
    if (type !== "shockwave") base.push("density");
    return new Set(base);
  }
  if (type === "transition") base.push("frequency");
  else if (type === "spiral") base.push("radius", "strands", "rotationSpeed");
  else base.push("colorSize", "movementSpeed");
  return new Set(base);
}

/**
 * The catalog attributes described by a slot's state, validated through the
 * cosmetic schema so what the editor applies is exactly what the catalog
 * would accept. Returns null when the state doesn't validate (e.g. a
 * non-positive size) or the type isn't valid for the slot.
 */
export function slotAttributes<T extends EffectType>(
  effectType: T,
  s: EffectSlotState,
): EffectOverrideAttributes[T] | null {
  const colors = s.colors.slice(
    0,
    Math.min(Math.max(Math.round(s.colorCount), 0), EFFECT_GUI_MAX_COLORS),
  );
  let candidate: unknown;
  if (effectType === "nukeExplosion") {
    candidate = {
      type: s.type,
      nukeType: s.nukeType,
      colors,
      size: s.size,
      speed: s.speed,
      thickness: s.thickness,
      transitionSpeed: s.transitionSpeed,
      ...(s.type === "shockwave" ? {} : { density: s.density }),
    };
  } else if (s.type === "transition") {
    candidate = { type: s.type, colors, frequency: s.frequency };
  } else if (s.type === "spiral") {
    candidate = {
      type: s.type,
      colors,
      radius: s.radius,
      strands: s.strands,
      rotationSpeed: s.rotationSpeed,
    };
  } else {
    candidate = {
      type: s.type,
      colors,
      colorSize: s.colorSize,
      movementSpeed: s.movementSpeed,
    };
  }
  const schema =
    effectType === "nukeExplosion"
      ? NukeExplosionAttributesSchema
      : effectType === "structures" || effectType === "warship"
        ? StructuresEffectAttributesSchema
        : TrailEffectAttributesSchema;
  const parsed = schema.safeParse(candidate);
  return parsed.success ? (parsed.data as EffectOverrideAttributes[T]) : null;
}

/** A catalog-entry fragment for the slot, ready to paste into cosmetics. */
export function catalogSnippet(
  effectType: EffectType,
  s: EffectSlotState,
): string | null {
  const attributes = slotAttributes(effectType, s);
  if (!attributes) return null;
  return JSON.stringify({ effectType, attributes }, null, 2);
}
