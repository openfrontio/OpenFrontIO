import { z } from "zod";

// Schema for resources/cosmetics/cosmetics.json
export const CosmeticsSchema = z.object({
  role_group: z.record(z.string(), z.string().array()).optional(),
  pattern: z.record(
    z.string(),
    z.object({
      pattern: z.string().base64(),
      role_group: z.string().array().optional(),
    }),
  ),
});

export type Cosmetics = z.infer<typeof CosmeticsSchema>;
