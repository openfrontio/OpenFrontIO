import { base64url } from "jose";
import { z } from "zod/v4";
import { decodePatternData } from "./PatternDecoder";
import { PlayerPattern } from "./Schemas";

export type Cosmetics = z.infer<typeof CosmeticsSchema>;
export type Pattern = z.infer<typeof PatternSchema>;
export type Flag = z.infer<typeof FlagSchema>;
export type Skin = z.infer<typeof SkinSchema>;
export type Pack = z.infer<typeof PackSchema>;
export type Subscription = z.infer<typeof SubscriptionSchema>;
// An effect cosmetic of any type — discriminated on effectType (today
// transportShipTrail + nukeTrail + nukeExplosion + structures; gains a member
// per effectType).
export type Effect = z.infer<typeof EffectSchema>;
export type EffectType = z.infer<typeof EffectTypeSchema>;
// Shared by every trail effectType (transportShipTrail, nukeTrail, …).
export type TrailEffectAttributes = z.infer<typeof TrailEffectAttributesSchema>;
// Attributes of a nuke-explosion effect (a detonation FX, not a trail).
export type NukeExplosionAttributes = z.infer<
  typeof NukeExplosionAttributesSchema
>;
// Attributes of a structures effect (recolors structure icons, not a trail).
export type StructuresEffectAttributes = z.infer<
  typeof StructuresEffectAttributesSchema
>;
export type PatternName = z.infer<typeof CosmeticNameSchema>;
export type Product = z.infer<typeof ProductSchema>;
export type ColorPalette = z.infer<typeof ColorPaletteSchema>;
export type PatternData = z.infer<typeof PatternDataSchema>;

export const ProductSchema = z.object({
  productId: z.string(),
  priceId: z.string(),
  price: z.string(),
});

export const CosmeticNameSchema = z
  .string()
  .regex(/^[a-z0-9_]+$/)
  .max(32);

export const PatternDataSchema = z
  .string()
  .max(1403)
  .base64url()
  .refine(
    (val) => {
      try {
        decodePatternData(val, base64url.decode);
        return true;
      } catch (e) {
        if (e instanceof Error) {
          console.error(JSON.stringify(e.message, null, 2));
        } else {
          console.error(String(e));
        }
        return false;
      }
    },
    {
      message: "Invalid pattern",
    },
  );

export const ColorPaletteSchema = z.object({
  name: z.string(),
  primaryColor: z.string(),
  secondaryColor: z.string(),
});

const CosmeticSchema = z.object({
  name: CosmeticNameSchema,
  affiliateCode: z.string().nullable().optional(),
  product: ProductSchema.nullable(),
  priceSoft: z.number().optional(),
  priceHard: z.number().optional(),
  artist: z.string().optional(),
  rarity: z
    .enum(["common", "uncommon", "rare", "epic", "legendary"])
    .or(z.string()),
});

export const PatternSchema = CosmeticSchema.extend({
  pattern: PatternDataSchema,
  colorPalettes: z
    .object({
      name: z.string(),
      isArchived: z.boolean(),
    })
    .array()
    .optional(),
});

export const FlagSchema = CosmeticSchema.extend({
  url: z.string(),
});

export const SkinSchema = CosmeticSchema.extend({
  url: z.string(),
});

// "effects" is a cosmetic category alongside skins/flags. The catalog is nested
// effects[effectType][effectName], and each effect also carries an effectType
// field matching its outer key (so an Effect can stand alone / discriminate).
// effectTypes are listed explicitly in CosmeticsSchema so each type's attributes
// stay precisely typed; an effectType the client doesn't list is dropped at parse
// (the UI only handles EFFECT_TYPES), so a new server-side effectType never fails
// the whole cosmetics parse.
export const EFFECT_TYPES = [
  "transportShipTrail",
  "nukeTrail",
  "nukeExplosion",
  "structures",
] as const;
export const EffectTypeSchema = z.enum(EFFECT_TYPES);

// The subset of effect types that render as trails through the shared trail
// palette (their attributes are TrailEffectAttributes; block order matches
// trail.frag.glsl — transportShipTrail=0, nukeTrail=1). nukeExplosion is an
// effect type but NOT a trail: it's a detonation FX with its own attributes and
// renders through the FX shockwave pass, so it's excluded here.
export const TRAIL_EFFECT_TYPES = ["transportShipTrail", "nukeTrail"] as const;
export type TrailEffectType = (typeof TRAIL_EFFECT_TYPES)[number];

// A trail effect, discriminated on `type`. Shared by every trail effectType
// (transport-ship trails, nuke trails, …) — the attributes are the same; only
// the unit whose trail they color differs.
//  - "gradient": the colors form a spatial gradient banded along the trail.
//    `colorSize` = band width in tiles (larger = bigger bands); `movementSpeed`
//    = how fast the bands scroll, in tiles/sec (0 = static).
//  - "transition": the whole trail is one color at a time, cross-fading through
//    the color list over time. `frequency` = color changes per second.
// solid = a single-color list; rainbow = the spectrum as a gradient. Colors are
// unvalidated strings here; the renderer drops any it can't parse (and an empty
// list falls back to the player's territory color).
export const TrailEffectAttributesSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("gradient"),
    colors: z.array(z.string()),
    colorSize: z.number(),
    movementSpeed: z.number(),
  }),
  z.object({
    type: z.literal("transition"),
    colors: z.array(z.string()),
    frequency: z.number(),
  }),
]);

// The bomb a nuke-explosion effect applies to. The store/selection UI groups
// nukeExplosion effects into one tab per type. Enum, so an effect for a bomb
// this client doesn't know is dropped by lenientRecord (not rendered wrong).
export const NUKE_EXPLOSION_TYPES = ["atom", "hydro", "mirvWarhead"] as const;
export type NukeExplosionType = (typeof NUKE_EXPLOSION_TYPES)[number];

// A nuke-explosion effect — a detonation FX, not a trail. `type` picks the
// visual (an expanding "shockwave" ring, or a firework burst of twinkling
// "sparkles") and `nukeType` the bomb; a value this client can't render is
// dropped by lenientRecord instead of rendering wrong. Shared knobs:
// `colors` is the palette; size (final effect width in tiles), speed (tiles/s
// the width grows), thickness (ring band thickness — or average sparkle size,
// glints vary ±50% around it — in tiles), and transitionSpeed (palette
// colors/s) drive the animation. Sparkles also take density — roughly how
// many sparkles the burst contains. size, thickness, and density must be
// positive — a non-positive value hits undefined shader behavior, so the
// entry is dropped like the enums; the renderer clamps speed and density.
export const NukeExplosionAttributesSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("shockwave"),
    nukeType: z.enum(NUKE_EXPLOSION_TYPES),
    colors: z.array(z.string()),
    size: z.number().positive(),
    speed: z.number(),
    thickness: z.number().positive(),
    transitionSpeed: z.number(),
  }),
  z.object({
    type: z.literal("sparkles"),
    nukeType: z.enum(NUKE_EXPLOSION_TYPES),
    colors: z.array(z.string()),
    size: z.number().positive(),
    speed: z.number(),
    thickness: z.number().positive(),
    transitionSpeed: z.number(),
    density: z.number().positive(),
  }),
]);

const TransportShipTrailEffectSchema = CosmeticSchema.extend({
  effectType: z.literal("transportShipTrail"),
  attributes: TrailEffectAttributesSchema,
  url: z.string().optional(),
});

const NukeTrailEffectSchema = CosmeticSchema.extend({
  effectType: z.literal("nukeTrail"),
  attributes: TrailEffectAttributesSchema,
  url: z.string().optional(),
});

const NukeExplosionEffectSchema = CosmeticSchema.extend({
  effectType: z.literal("nukeExplosion"),
  attributes: NukeExplosionAttributesSchema,
  url: z.string().optional(),
});

// Structures-effect attributes, discriminated on `type`. Structurally the
// same shapes as the trail attributes today, but structures are not trails —
// separate schema, and the spatial semantics differ:
//  - "gradient": the palette spans each structure icon's diagonal once (a
//    visible gradient across the shape), sliding one full cycle every
//    colorSize · 4 · count / movementSpeed seconds (the trail-equivalent pace).
//  - "transition": the whole icon is one color at a time, cross-fading through
//    the list. `frequency` = color changes per second.
// Colors are unvalidated strings; the renderer drops any it can't parse (and
// an empty list leaves the structure on its normal player color).
export const StructuresEffectAttributesSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("gradient"),
    colors: z.array(z.string()),
    colorSize: z.number(),
    movementSpeed: z.number(),
  }),
  z.object({
    type: z.literal("transition"),
    colors: z.array(z.string()),
    frequency: z.number(),
  }),
]);

// Recolors the owner's structures (city, port, factory, defense post, SAM,
// silo) with gradient / transition styles. Shown while the owner's territory
// is hovered; structures otherwise keep their normal player colors.
const StructuresEffectSchema = CosmeticSchema.extend({
  effectType: z.literal("structures"),
  attributes: StructuresEffectAttributesSchema,
  url: z.string().optional(),
});

// Any catalog effect, discriminated on effectType. Add a member per effectType.
export const EffectSchema = z.discriminatedUnion("effectType", [
  TransportShipTrailEffectSchema,
  NukeTrailEffectSchema,
  NukeExplosionEffectSchema,
  StructuresEffectSchema,
]);

/**
 * True for effects that render through the shared trail palette (their
 * attributes are TrailEffectAttributes). Narrows the Effect union so callers can
 * treat `attributes` as trail attributes; a nukeExplosion (or any future
 * non-trail effect) returns false.
 */
export function isTrailEffect(
  effect: Effect,
): effect is Extract<Effect, { effectType: TrailEffectType }> {
  return (TRAIL_EFFECT_TYPES as readonly string[]).includes(effect.effectType);
}

/** Narrows an Effect to a nuke-explosion effect (exposes its nukeType). */
export function isNukeExplosionEffect(
  effect: Effect,
): effect is Extract<Effect, { effectType: "nukeExplosion" }> {
  return effect.effectType === "nukeExplosion";
}

/**
 * A player selects one effect per "slot". A slot is the effectType itself for
 * per-type effects (transportShipTrail, nukeTrail, structures) and the
 * nukeType for nuke explosions (atom, hydro, mirvWarhead) — so a player can
 * equip a distinct explosion per bomb. Returns the effectType a slot resolves
 * to for catalog lookup, or undefined for an unknown/stale slot (e.g. a bare
 * "nukeExplosion" key from before the per-nukeType split).
 */
export function effectTypeForSlot(slot: string): EffectType | undefined {
  if ((NUKE_EXPLOSION_TYPES as readonly string[]).includes(slot)) {
    return "nukeExplosion";
  }
  if (
    (EFFECT_TYPES as readonly string[]).includes(slot) &&
    slot !== "nukeExplosion"
  ) {
    return slot as EffectType;
  }
  return undefined;
}

/**
 * Whether `effect` may occupy selection `slot`: the slot's effectType matches,
 * and for a nuke-explosion slot the effect's nukeType matches the slot (so an
 * atom effect can only sit in the atom slot, etc.).
 */
export function effectMatchesSlot(effect: Effect, slot: string): boolean {
  if (effect.effectType !== effectTypeForSlot(slot)) return false;
  if (isNukeExplosionEffect(effect)) return effect.attributes.nukeType === slot;
  return true;
}

/**
 * Resolve a selection slot + effect name against the catalog: look up the
 * slot's effectType (effectTypeForSlot) and require the found effect to fit
 * the slot (effectMatchesSlot). Returns undefined for an unknown slot, a
 * missing effect, or a slot mismatch.
 */
export function findEffectForSlot(
  cosmetics: Cosmetics | null | undefined,
  slot: string,
  name: string,
): Effect | undefined {
  const effectType = effectTypeForSlot(slot);
  const effect = effectType
    ? findEffect(cosmetics, effectType, name)
    : undefined;
  return effect && effectMatchesSlot(effect, slot) ? effect : undefined;
}

// Slots put nukeType and effectType names in one flat string namespace
// (effectTypeForSlot disambiguates by list membership), so the two enums must
// stay disjoint — a nukeType named like an effectType would silently hijack
// that slot. This guard fails the build if they ever collide.
type _SlotCollision = Extract<NukeExplosionType, EffectType>;
const _SLOT_NAMESPACES_DISJOINT: _SlotCollision extends never ? true : false =
  true;
void _SLOT_NAMESPACES_DISJOINT;

/**
 * A record that drops entries failing `schema` instead of failing the whole
 * parse. Used for the effect catalog: a newer effect the server ships before
 * this client is updated to understand it is skipped rather than taking patterns,
 * flags, and skins down with it.
 */
function lenientRecord<T extends z.ZodType>(schema: T) {
  return z.record(z.string(), z.unknown()).transform((rec) => {
    const out: Record<string, z.infer<T>> = {};
    for (const [key, value] of Object.entries(rec)) {
      const parsed = schema.safeParse(value);
      if (parsed.success) out[key] = parsed.data;
    }
    return out;
  });
}

export const PackSchema = CosmeticSchema.extend({
  displayName: z.string(),
  currency: z.enum(["hard", "soft"]),
  amount: z.number().int().positive(),
  bonusAmount: z.number().int().nonnegative(),
});

export const SubscriptionSchema = CosmeticSchema.extend({
  description: z.string(),
  priceMonthly: z.number(),
  dailySoftCurrency: z.number(),
  dailyHardCurrency: z.number(),
});

// Schema for resources/cosmetics/cosmetics.json
export const CosmeticsSchema = z.object({
  colorPalettes: z.record(z.string(), ColorPaletteSchema).optional(),
  patterns: z.record(z.string(), PatternSchema),
  flags: z.record(z.string(), FlagSchema),
  skins: z.record(z.string(), SkinSchema).optional(),
  // Grouped by effectType. Each effect also carries its own effectType (matching
  // this outer key) so an Effect stands alone and EffectSchema can discriminate
  // on it. Add a key per new effectType. Forward-compat: a brand-new effectType
  // key is ignored (z.object strips keys it doesn't list), and lenientRecord
  // extends that to new entries under a known effectType (a dropped effect just
  // degrades to "no effect" — the trail keeps its territory color).
  effects: z
    .object({
      transportShipTrail: lenientRecord(
        TransportShipTrailEffectSchema,
      ).optional(),
      nukeTrail: lenientRecord(NukeTrailEffectSchema).optional(),
      nukeExplosion: lenientRecord(NukeExplosionEffectSchema).optional(),
      structures: lenientRecord(StructuresEffectSchema).optional(),
    })
    .optional(),
  currencyPacks: z.record(z.string(), PackSchema).optional(),
  subscriptions: z.record(z.string(), SubscriptionSchema).optional(),
});

/**
 * Resolve an effect in the nested catalog (effects[effectType][effectKey]). The
 * catalog object key is normally identical to the effect's `name`, but selection
 * and ownership flares are both name-based, so fall back to a `name`-field search
 * when the object key differs. Without this fallback a catalog whose key !== name
 * would make the effect silently unselectable (the selected name never resolves).
 */
export function findEffect(
  cosmetics: Cosmetics | null | undefined,
  effectType: string,
  name: string,
): Effect | undefined {
  // effects is keyed by the known effectTypes; index it by an arbitrary runtime
  // string (a selection/ref may name a type this client doesn't list).
  const byType = cosmetics?.effects as
    | Record<string, Record<string, Effect>>
    | undefined;
  const byName = byType?.[effectType];
  if (!byName) return undefined;
  return byName[name] ?? Object.values(byName).find((e) => e.name === name);
}

export const DefaultPattern = {
  name: "default",
  patternData: "AAAAAA",
  colorPalette: undefined,
} satisfies PlayerPattern;
