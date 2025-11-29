import { z } from "zod";
import { base64urlToUuid } from "./Base64";
import { BigIntStringSchema, PlayerStatsSchema } from "./StatsSchemas";
import { Difficulty, GameMapType, GameMode, GameType } from "./game/Game";

export const RefreshResponseSchema = z.object({
  token: z.string(),
});
export type RefreshResponse = z.infer<typeof RefreshResponseSchema>;

export const TokenPayloadSchema = z.object({
  jti: z.string(),
  sub: z
    .string()
    .refine(
      (val) => {
        const uuid = base64urlToUuid(val);
        return !!uuid;
      },
      {
        message: "Invalid base64-encoded UUID",
      },
    )
    .transform((val) => {
      const uuid = base64urlToUuid(val);
      if (!uuid) throw new Error("Invalid base64 UUID");
      return uuid;
    }),
  iat: z.number(),
  iss: z.string(),
  aud: z.string(),
  exp: z.number(),
});
export type TokenPayload = z.infer<typeof TokenPayloadSchema>;

export const DiscordUserSchema = z.object({
  id: z.string(),
  avatar: z.string().nullable(),
  username: z.string(),
  global_name: z.string().nullable(),
  discriminator: z.string(),
});
export type DiscordUser = z.infer<typeof DiscordUserSchema>;

export const UserMeResponseSchema = z.object({
  user: z.object({
    discord: DiscordUserSchema.optional(),
    email: z.string().optional(),
  }),
  player: z.object({
    publicId: z.string(),
    roles: z.string().array().optional(),
    flares: z.string().array().optional(),
  }),
});
export type UserMeResponse = z.infer<typeof UserMeResponseSchema>;

export const PlayerStatsLeafSchema = z.object({
  wins: BigIntStringSchema,
  losses: BigIntStringSchema,
  total: BigIntStringSchema,
  stats: PlayerStatsSchema,
});
export type PlayerStatsLeaf = z.infer<typeof PlayerStatsLeafSchema>;

export const PlayerStatsTreeSchema = z.partialRecord(
  z.enum(GameType),
  z.partialRecord(
    z.enum(GameMode),
    z.partialRecord(z.enum(Difficulty), PlayerStatsLeafSchema),
  ),
);
export type PlayerStatsTree = z.infer<typeof PlayerStatsTreeSchema>;

export const PlayerGameSchema = z.object({
  gameId: z.string(),
  start: z.iso.datetime(),
  mode: z.enum(GameMode),
  type: z.enum(GameType),
  map: z.enum(GameMapType),
  difficulty: z.enum(Difficulty),
  clientId: z.string().optional(),
});
export type PlayerGame = z.infer<typeof PlayerGameSchema>;

export const PlayerProfileSchema = z.object({
  createdAt: z.iso.datetime(),
  user: DiscordUserSchema.optional(),
  games: PlayerGameSchema.array(),
  stats: PlayerStatsTreeSchema,
});
export type PlayerProfile = z.infer<typeof PlayerProfileSchema>;

export const ClanLeaderboardEntrySchema = z.object({
  clanTag: z.string(),
  games: z.number(),
  wins: z.number(),
  losses: z.number(),
  playerSessions: z.number(),
  weightedWins: z.number(),
  weightedLosses: z.number(),
  weightedWLRatio: z.number(),
});
export type ClanLeaderboardEntry = z.infer<typeof ClanLeaderboardEntrySchema>;

export const ClanLeaderboardResponseSchema = z.object({
  start: z.iso.datetime(),
  end: z.iso.datetime(),
  clans: ClanLeaderboardEntrySchema.array(),
});
export type ClanLeaderboardResponse = z.infer<
  typeof ClanLeaderboardResponseSchema
>;
