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

// "effects" is a cosmetic category alongside skins/flags. Each effect declares
// an `effectType` (the kind of thing it changes); the only type today is
// "transportShipTrail", whose visual config lives in `attributes`. New effect
// types are added by extending the EffectSchema union with another member.
export const EFFECT_TYPES = ["transportShipTrail"] as const;
export const EffectTypeSchema = z.enum(EFFECT_TYPES);

export const TransportShipTrailAttributesSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("solid"), color: z.string() }),
  z.object({ type: z.literal("rainbow") }),
  z.object({ type: z.literal("pulse"), color: z.string() }),
  z.object({
    type: z.literal("gradient"),
    color: z.string(),
    color2: z.string(),
  }),
]);

export const TransportShipTrailEffectSchema = CosmeticSchema.extend({
  effectType: z.literal("transportShipTrail"),
  attributes: TransportShipTrailAttributesSchema,
  url: z.string().optional(),
});

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
  effects: z.record(z.string(), EffectSchema).optional(),
  currencyPacks: z.record(z.string(), PackSchema).optional(),
  subscriptions: z.record(z.string(), SubscriptionSchema).optional(),
});

export const DefaultPattern = {
  name: "default",
  patternData: "AAAAAA",
  colorPalette: undefined,
} satisfies PlayerPattern;
