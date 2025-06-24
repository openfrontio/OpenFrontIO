import { z } from "zod/v4";
import cosmetics_json from "../../resources/cosmetics/cosmetics.json" with { type: "json" };
import { RequiredPatternSchema } from "./Schemas";

// Schema for resources/cosmetics/cosmetics.json
export const CosmeticsSchema = z.object({
  role_groups: z.record(z.string(), z.string().array().min(1)),
  patterns: z.record(
    RequiredPatternSchema,
    z.object({
      name: z.string(),
      role_group: z.string().optional(),
    }),
  ),
});
export type Cosmetics = z.infer<typeof CosmeticsSchema>;
export const COSMETICS: Cosmetics = CosmeticsSchema.parse(cosmetics_json);
