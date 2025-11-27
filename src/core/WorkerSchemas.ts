import { z } from "zod";
import { GameConfigSchema } from "./Schemas";

export const StartGameSchema = z.object({
  hostPersistentID: z.string().uuid().optional(),
});

export const CreateGameInputSchema = GameConfigSchema.or(
  StartGameSchema.strict(),
);

export const GameInputSchema =
  GameConfigSchema.partial().merge(StartGameSchema);

export type GameConfig = z.infer<typeof GameConfigSchema>;
