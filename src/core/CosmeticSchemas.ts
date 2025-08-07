import { z } from "zod/v4";
import { RequiredPatternSchema } from "./Schemas";

export const ProductSchema = z.object({
  productId: z.string(),
  priceId: z.string(),
  price: z.string(),
});

const PatternSchema = z.object({
  name: z.string(),
  pattern: RequiredPatternSchema,
  product: ProductSchema.nullable(),
});

// Schema for resources/cosmetics/cosmetics.json
export const CosmeticsSchema = z.object({
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
export type Cosmetics = z.infer<typeof CosmeticsSchema>;
export type Pattern = z.infer<typeof PatternSchema>;
export type Product = z.infer<typeof ProductSchema>;
