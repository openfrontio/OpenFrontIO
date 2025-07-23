import { z } from "zod";
import { GameConfigSchema } from "./Schemas";

export const CreateGameInputSchema = GameConfigSchema.or(
  z
    .object({})
    .strict()
    .transform((val) => undefined),
);

export const GameInputSchema = GameConfigSchema.partial();
