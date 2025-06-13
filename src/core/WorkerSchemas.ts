import { z } from "zod/v4";
import { GameConfigSchema } from "./Schemas";

export const CreateGameInputSchema = GameConfigSchema.or(
  z
    .object({})
    .strict()
    .transform((val) => undefined),
);

export const GameInputSchema = GameConfigSchema.partial();
