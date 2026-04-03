import { base64url } from "jose";
import { z } from "zod/v4";
import { decodePatternData } from "./PatternDecoder";
import { PlayerPattern } from "./Schemas";

export type Cosmetics = z.infer<typeof CosmeticsSchema>;
export type Pattern = z.infer<typeof PatternSchema>;
export type PatternName = z.infer<typeof PatternNameSchema>;
export type Product = z.infer<typeof ProductSchema>;
export type ColorPalette = z.infer<typeof ColorPaletteSchema>;
export type PatternData = z.infer<typeof PatternDataSchema>;
export type WalletCurrency = z.infer<typeof WalletCurrencySchema>;
export type WalletPrice = z.infer<typeof WalletPriceSchema>;

const NonNegativeBigIntSchema = z.preprocess((val) => {
  if (typeof val === "string" && /^\d+$/.test(val)) return BigInt(val);
  if (typeof val === "number" && Number.isSafeInteger(val) && val >= 0) {
    return BigInt(val);
  }
  if (typeof val === "bigint" && val >= 0) return val;
  return val;
}, z.bigint().nonnegative());

export const WalletCurrencySchema = z.enum(["premium", "standard"]);

export const WalletPriceSchema = z.object({
  currency: WalletCurrencySchema,
  amount: NonNegativeBigIntSchema,
});

export const ProductSchema = z
  .object({
    productId: z.string().optional(),
    priceId: z.string().optional(),
    price: z.string().optional(),
    walletPrice: WalletPriceSchema.optional(),
  })
  .superRefine((product, ctx) => {
    if (product.walletPrice) {
      return;
    }

    if (product.productId && product.priceId && product.price) {
      return;
    }

    ctx.addIssue({
      code: "custom",
      message: "Product must define wallet pricing or Stripe checkout data",
    });
  });

export const PatternNameSchema = z
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

export const PatternSchema = z.object({
  name: PatternNameSchema,
  pattern: PatternDataSchema,
  colorPalettes: z
    .object({
      name: z.string(),
      isArchived: z.boolean(),
    })
    .array()
    .optional(),
  affiliateCode: z.string().nullable(),
  product: ProductSchema.nullable(),
});

// Schema for resources/cosmetics/cosmetics.json
export const CosmeticsSchema = z.object({
  colorPalettes: z.record(z.string(), ColorPaletteSchema).optional(),
  patterns: z.record(z.string(), PatternSchema),
  flag: z
    .object({
      layers: z.record(
        z.string(),
        z.object({
          name: z.string(),
          flares: z.array(z.string()).optional(),
        }),
      ),
      color: z.record(
        z.string(),
        z.object({
          color: z.string(),
          name: z.string(),
          flares: z.array(z.string()).optional(),
        }),
      ),
    })
    .optional(),
});

export const DefaultPattern = {
  name: "default",
  patternData: "AAAAAA",
  colorPalette: undefined,
} satisfies PlayerPattern;
