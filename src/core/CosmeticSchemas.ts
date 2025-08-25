import { z } from "zod";
import { RequiredPatternSchema } from "./Schemas";

export const ProductSchema = z.object({
  price: z.string(),

  priceId: z.string(),
  productId: z.string(),
});

const PatternSchema = z.object({
  name: z.string(),
  pattern: RequiredPatternSchema,
  product: ProductSchema.nullable(),
});

// Schema for resources/cosmetics/cosmetics.json
export const CosmeticsSchema = z.object({
  flag: z
    .object({
      color: z.record(
        z.string(),
        z.object({
          color: z.string(),
          flares: z.string().array().optional(),
          name: z.string(),
        }),
      ),
      layers: z.record(
        z.string(),
        z.object({
          flares: z.string().array().optional(),
          name: z.string(),
        }),
      ),
    })
    .optional(),
  patterns: z.record(z.string(), PatternSchema),
});
export type Cosmetics = z.infer<typeof CosmeticsSchema>;
export type Pattern = z.infer<typeof PatternSchema>;
export type Product = z.infer<typeof ProductSchema>;
