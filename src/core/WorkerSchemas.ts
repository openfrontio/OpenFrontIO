import { z } from "zod";
import { GameConfigSchema } from "./Schemas";

export const CreateGameInputSchema = z
  .object({
    gameConfig: GameConfigSchema,
    nextGameConfig: GameConfigSchema.optional(),
  })
  .or(GameConfigSchema)
  .or(
    z
      .object({})
      .strict()
      .transform((val) => undefined),
  );

export const GameInputSchema = GameConfigSchema.partial();
