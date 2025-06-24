import { z } from "zod/v4";
import { GameConfigSchema } from "./Schemas";

export const CreateGameConfigSchema = GameConfigSchema.or(
  z
    .object({})
    .strict()
    .transform((val) => undefined),
);

export const CreateGameInputSchema = z.object({
  config: CreateGameConfigSchema,
  startTime: z.number().optional(),
});
export type CreateGameInput = z.infer<typeof CreateGameInputSchema>;

export const GameInputSchema = GameConfigSchema.partial();
