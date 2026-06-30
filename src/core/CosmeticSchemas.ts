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
// An effect cosmetic of any type — discriminated on effectType (today only
// transportShipTrail; gains a member per effectType).
export type Effect = z.infer<typeof EffectSchema>;
export type EffectType = z.infer<typeof EffectTypeSchema>;
export type TransportShipTrailAttributes = z.infer<
  typeof TransportShipTrailAttributesSchema
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
export const EFFECT_TYPES = ["transportShipTrail"] as const;
export const EffectTypeSchema = z.enum(EFFECT_TYPES);

// A boat trail is a gradient of one or more colors, cycled along the trail. The
// old solid/rainbow styles are just color lists now: solid = a single color,
// rainbow = the spectrum, gradient = two or more. The server only ships this
// "gradient" shape. Colors are unvalidated strings here; the renderer drops any
// it can't parse (and an empty list falls back to the player's territory color).
// `colorSize` is how wide each color band is, in tiles (larger = bigger bands);
// `movementSpeed` is how fast the bands scroll along the trail, in tiles per
// second (0 = static).
export const TransportShipTrailAttributesSchema = z.object({
  type: z.literal("gradient"),
  colors: z.array(z.string()),
  colorSize: z.number(),
  movementSpeed: z.number(),
});

const TransportShipTrailEffectSchema = CosmeticSchema.extend({
  effectType: z.literal("transportShipTrail"),
  attributes: TransportShipTrailAttributesSchema,
  url: z.string().optional(),
});

// Any catalog effect, discriminated on effectType. Add a member per effectType.
export const EffectSchema = z.discriminatedUnion("effectType", [
  TransportShipTrailEffectSchema,
]);

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
  // on it. Add a key per new effectType.
  effects: z
    .object({
      transportShipTrail: z
        .record(z.string(), TransportShipTrailEffectSchema)
        .optional(),
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
