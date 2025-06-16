import { z } from "zod";

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

export type Cosmetic = z.infer<typeof CosmeticsSchema>;
