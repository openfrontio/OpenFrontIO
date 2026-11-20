import { GameMapType, GameType } from "@openfront/engine-api/game/GameTypes";
import { GameConfigSchema } from "@openfront/engine-api/Schemas";
import { z } from "zod";

// `pool` points joiners at other lobbies, so only the authenticated admin-bot
// route (which parses GameConfigSchema directly) may set one. Stock maps only:
// a Custom map's files come with a scenario start, which a lobby can't carry
// yet.
export const CreateGameInputSchema = GameConfigSchema.omit({ pool: true })
  .extend({ gameMap: z.enum(GameMapType) })
  .or(
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
