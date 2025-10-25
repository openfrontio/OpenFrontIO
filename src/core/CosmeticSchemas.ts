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

export const ProductSchema = z.object({
  productId: z.string(),
  priceId: z.string(),
  price: z.string(),
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

const imageFile = z
  .string()
  .regex(/\.(png|webp|jpg|jpeg|gif)$/i, "Invalid image extension");
const audioFile = z
  .string()
  .regex(/\.(ogg|mp3|wav|m4a)$/i, "Invalid audio extension");

const ImageAssetNode: z.ZodType<any> = z.lazy(() =>
  z.union([imageFile, z.record(z.string(), ImageAssetNode)]),
);
const AudioAssetNode: z.ZodType<any> = z.lazy(() =>
  z.union([audioFile, z.record(z.string(), AudioAssetNode)]),
);

export const CosmeticManifestSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    assets: z
      .object({
        structure: z.record(z.string(), ImageAssetNode).optional(),
        sprites: z.record(z.string(), ImageAssetNode).optional(),
        audio: z.record(z.string(), AudioAssetNode).optional(),
      })
      .strict(),
  })
  .strict();
export type CosmeticManifest = z.infer<typeof CosmeticManifestSchema>;
