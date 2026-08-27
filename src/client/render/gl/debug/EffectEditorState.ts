/**
 * Effect-editor state and its conversion into catalog-shaped cosmetic
 * attributes. Pure (no DOM / lil-gui) so it can be unit-tested; the folder
 * built in EffectEditor.ts binds lil-gui controllers to these objects.
 */

import {
  type EffectAttributesFor,
  type EffectType,
  NUKE_EXPLOSION_TYPES,
  NukeExplosionAttributesSchema,
  type NukeExplosionType,
  StructuresEffectAttributesSchema,
  TrailEffectAttributesSchema,
} from "../../../../core/CosmeticSchemas";

/** Max colors a slot can carry — the effect palette holds 8 rows per block. */
export const EFFECT_EDITOR_MAX_COLORS = 8;

/**
 * Attribute `type` options per effect slot. Mirrors the catalog schemas,
 * except that `spiral` (which the shared trail schema allows) is only
 * offered for nuke trails — the vortex renders as ribbon geometry that the
 * renderer builds for nukes only (see SpiralTrails); ship trails would just
 * fall back to their territory color.
 */
export const EFFECT_EDITOR_TYPES: Record<EffectType, readonly string[]> = {
  transportShipTrail: ["gradient", "transition"],
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
    type: EFFECT_EDITOR_TYPES[effectType][0],
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
export function slotAttributes(
  effectType: EffectType,
  s: EffectSlotState,
): EffectAttributesFor<EffectType> | null {
  const colors = s.colors.slice(
    0,
    Math.min(Math.max(Math.round(s.colorCount), 0), EFFECT_EDITOR_MAX_COLORS),
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
  if (!parsed.success) return null;
  return parsed.data as EffectAttributesFor<EffectType>;
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
