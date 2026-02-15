import { z } from "zod";

export const PublicGameModifiersSchema = z.object({
  isCompact: z.boolean().optional().default(false),
  isRandomSpawn: z.boolean().optional().default(false),
  isCrowded: z.boolean().optional().default(false),
  startingGold: z.number().int().min(0).optional(),
});

export const GameConfigSchema = z.object({
  gameMap: z.string(),
  gameType: z.string().optional().default("unknown"),
  gameMode: z.string().optional().default("unknown"),
  maxPlayers: z.number().int().min(1).optional(),
  bots: z.number().int().min(0).optional(),
  difficulty: z.string().optional(),
  playerTeams: z.union([z.number().int().positive(), z.string()]).optional(),
  gameMapSize: z.string().optional(),
  publicGameModifiers: PublicGameModifiersSchema.optional(),
});

export const PublicGameInfoSchema = z.object({
  gameID: z.string().min(1),
  numClients: z.number().int().min(0),
  startsAt: z.number().int(),
  gameConfig: GameConfigSchema.optional(),
});

export const PublicGamesMessageSchema = z.object({
  serverTime: z.number().int(),
  games: z.array(PublicGameInfoSchema),
});

export const ProdLobbyInfoSchema = z.object({
  gameID: z.string().min(1),
  numClients: z.number().int().min(0),
  gameConfig: GameConfigSchema.optional(),
  msUntilStart: z.number().int().optional(),
  startsAt: z.number().int().optional(),
});

export const ProdLobbiesUpdateSchema = z.object({
  type: z.literal("lobbies_update"),
  data: z.object({
    lobbies: z.array(ProdLobbyInfoSchema),
    serverTime: z.number().int().optional(),
  }),
});

export const GameInfoResponseSchema = z.object({
  gameID: z.string(),
  clients: z
    .array(
      z.object({
        username: z.string(),
        clientID: z.string(),
      }),
    )
    .optional(),
  lobbyCreatorClientID: z.string().optional(),
  gameConfig: GameConfigSchema.optional(),
  startsAt: z.number().int().optional(),
  serverTime: z.number().int(),
});

export const ArchiveSummarySchema = z.object({
  info: z
    .object({
      players: z
        .array(
          z.object({
            username: z.string().optional(),
            clientID: z.string().optional(),
          }),
        )
        .optional(),
      lobbyCreatedAt: z.number().optional(),
      start: z.number().optional(),
      end: z.number().optional(),
      duration: z.number().optional(),
      winner: z
        .union([
          z.array(z.string()),
          z.object({
            username: z.string().optional(),
          }),
        ])
        .optional(),
    })
    .passthrough()
    .optional(),
});
