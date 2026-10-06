import { GameConfigSchema } from "@openfront/engine-api/Schemas";
import { z } from "zod";

// `pool` points joiners at other lobbies, so only the authenticated admin-bot
// route (which parses GameConfigSchema directly) may set one.
export const CreateGameInputSchema = GameConfigSchema.omit({ pool: true }).or(
  z
    .object({})
    .strict()
    .transform((val) => undefined),
);

export const GameInputSchema = GameConfigSchema.partial();
