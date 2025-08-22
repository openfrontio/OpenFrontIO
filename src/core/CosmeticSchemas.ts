import { base64url } from "jose";
import { z } from "zod/v4";
import { PatternDecoder } from "./PatternDecoder";

export type Cosmetics = z.infer<typeof CosmeticsSchema>;
export type Pattern = z.infer<typeof PatternInfoSchema>;
export type PatternName = z.infer<typeof PatternNameSchema>;
export type Product = z.infer<typeof ProductSchema>;

export const ProductSchema = z.object({
  productId: z.string(),
  /* eslint-disable sort-keys */
  priceId: z.string(),
  price: z.string(),
  /* eslint-enable sort-keys */
});

export const PatternNameSchema = z
  .string()
  .regex(/^[a-z0-9_]+$/)
  .max(32);

export const PatternSchema = z
  .string()
  .max(1403)
  .base64url()
  .refine(
    (val) => {
      try {
        new PatternDecoder(val, base64url.decode);
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

export const PatternInfoSchema = z.object({
  name: PatternNameSchema,
  pattern: PatternSchema,
  product: ProductSchema.nullable(),
});

// Schema for resources/cosmetics/cosmetics.json
export const CosmeticsSchema = z.object({
  /* eslint-disable sort-keys */
  patterns: z.record(z.string(), PatternInfoSchema),
  flag: z
    .object({
      layers: z.record(
        z.string(),
        z.object({
          name: z.string(),
          flares: z.string().array().optional(),
        }),
      ),
      color: z.record(
        z.string(),
        z.object({
          color: z.string(),
          name: z.string(),
          flares: z.string().array().optional(),
        }),
      ),
    })
    .optional(),
  /* eslint-enable sort-keys */
});
