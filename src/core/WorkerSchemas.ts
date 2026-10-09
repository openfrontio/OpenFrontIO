import { z } from "zod";
import { GameType } from "./game/Game";
import { GameConfigSchema } from "./Schemas";

// `pool` points joiners at other lobbies, so only the authenticated admin-bot
// route (which parses GameConfigSchema directly) may set one.
export const CreateGameInputSchema = GameConfigSchema.omit({ pool: true }).or(
  z
    .object({})
    .strict()
    .transform((val) => undefined),
);

export type CreateGameInput = z.infer<typeof CreateGameInputSchema>;

// create_game only makes private lobbies. An empty body parses to undefined,
// which createGame fills in with its defaults (a private game).
export function isPrivateGameInput(input: CreateGameInput): boolean {
  return input === undefined || input.gameType === GameType.Private;
}

export const GameInputSchema = GameConfigSchema.partial();
