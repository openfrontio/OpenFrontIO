import { z } from "zod";
import { RequiredPatternSchema } from "./Schemas";

export const ProductSchema = z.object({
  productId: z.string(),
  /* eslint-disable sort-keys */
  priceId: z.string(),
  price: z.string(),
  /* eslint-enable sort-keys */
});

const PatternSchema = z.object({
  name: z.string(),
  pattern: RequiredPatternSchema,
  product: ProductSchema.nullable(),
});

// Schema for resources/cosmetics/cosmetics.json
export const CosmeticsSchema = z.object({
  patterns: z.record(z.string(), PatternSchema),
  /* eslint-disable sort-keys */
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
export type Cosmetics = z.infer<typeof CosmeticsSchema>;
export type Pattern = z.infer<typeof PatternSchema>;
export type Product = z.infer<typeof ProductSchema>;
