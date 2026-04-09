import { z } from "zod";
import { base64urlToUuid } from "./Base64";
import { ClanTagSchema } from "./Schemas";
import { BigIntStringSchema, PlayerStatsSchema } from "./StatsSchemas";
import { Difficulty, GameMode, GameType, RankedType } from "./game/Game";

function stripClanTagFromUsername(username: string): string {
  return username.replace(/^\s*\[[a-zA-Z0-9]{2,5}\]\s*/u, "").trim();
}

// Historical leaderboard rows can include legacy usernames
// that predate current strict join-time validation rules.
const LeaderboardUsernameSchema = z
  .string()
  .transform(stripClanTagFromUsername)
  .pipe(z.string().min(1).max(64));
const RequiredClanTagSchema = ClanTagSchema.unwrap();

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

const SingleplayerMapAchievementSchema = z.object({
  mapName: z.string(),
  difficulty: z.enum(Difficulty),
});

export const UserMeResponseSchema = z.object({
  user: z.object({
    discord: DiscordUserSchema.optional(),
    email: z.string().optional(),
  }),
  player: z.object({
    publicId: z.string(),
    roles: z.string().array().optional(),
    flares: z.string().array().optional(),
    achievements: z.object({
      singleplayerMap: z.array(SingleplayerMapAchievementSchema),
    }),
    leaderboard: z
      .object({
        oneVone: z
          .object({
            elo: z.number().optional(),
          })
          .optional(),
      })
      .optional(),
    clans: z
      .array(
        z.object({
          tag: RequiredClanTagSchema,
          name: z.string(),
          role: z.enum(["leader", "officer", "member"]),
          joinedAt: z.iso.datetime(),
        }),
      )
      .optional(),
    clanRequests: z
      .array(
        z.object({
          tag: RequiredClanTagSchema,
          name: z.string(),
          createdAt: z.iso.datetime(),
        }),
      )
      .optional(),
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

const GameModeStatsSchema = z.partialRecord(
  z.enum(GameMode),
  z.partialRecord(z.enum(Difficulty), PlayerStatsLeafSchema),
);

export const PlayerStatsTreeSchema = z.object({
  Singleplayer: GameModeStatsSchema.optional(),
  Public: GameModeStatsSchema.optional(),
  Private: GameModeStatsSchema.optional(),
  Ranked: z.partialRecord(z.enum(RankedType), PlayerStatsLeafSchema).optional(),
});
export type PlayerStatsTree = z.infer<typeof PlayerStatsTreeSchema>;

export const PlayerGameSchema = z.object({
  gameId: z.string(),
  start: z.iso.datetime(),
  mode: z.enum(GameMode),
  type: z.enum(GameType),
  map: z.string(),
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
  clanTag: RequiredClanTagSchema,
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

export const PlayerLeaderboardEntrySchema = z.object({
  rank: z.number(),
  playerId: z.string(),
  username: LeaderboardUsernameSchema,
  clanTag: RequiredClanTagSchema.nullable().optional(),
  flag: z.string().optional(),
  elo: z.number(),
  games: z.number(),
  wins: z.number(),
  losses: z.number(),
  winRate: z.number(),
});
export type PlayerLeaderboardEntry = z.infer<
  typeof PlayerLeaderboardEntrySchema
>;

export const PlayerLeaderboardResponseSchema = z.object({
  players: PlayerLeaderboardEntrySchema.array(),
});
export type PlayerLeaderboardResponse = z.infer<
  typeof PlayerLeaderboardResponseSchema
>;

export const RankedLeaderboardEntrySchema = z.object({
  rank: z.number(),
  elo: z.number(),
  peakElo: z.number().nullable(),
  wins: z.number(),
  losses: z.number(),
  total: z.number(),
  public_id: z.string(),
  user: DiscordUserSchema.nullable().optional(),
  username: LeaderboardUsernameSchema,
  clanTag: RequiredClanTagSchema.nullable().optional(),
});
export type RankedLeaderboardEntry = z.infer<
  typeof RankedLeaderboardEntrySchema
>;

export const RankedLeaderboardResponseSchema = z.object({
  [RankedType.OneVOne]: RankedLeaderboardEntrySchema.array(),
});
export type RankedLeaderboardResponse = z.infer<
  typeof RankedLeaderboardResponseSchema
>;

export const NewsItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  url: z.string().nullable().optional(),
  type: z.enum(["tournament", "tutorial", "announcement"]).or(z.string()),
});
export type NewsItem = z.infer<typeof NewsItemSchema>;

// ── Clan schemas ───────────────────────────────────────────────────

export const ClanInfoSchema = z.object({
  name: z.string(),
  tag: RequiredClanTagSchema,
  description: z.string(),
  isOpen: z.boolean(),
  createdAt: z.string(),
  memberCount: z.number(),
});
export type ClanInfo = z.infer<typeof ClanInfoSchema>;

export const ClanBrowseResponseSchema = z.object({
  results: ClanInfoSchema.array(),
  total: z.number(),
  page: z.number(),
  limit: z.number(),
});
export type ClanBrowseResponse = z.infer<typeof ClanBrowseResponseSchema>;

export const ClanMemberSchema = z.object({
  role: z.enum(["leader", "officer", "member"]),
  joinedAt: z.string(),
  publicId: z.string().nullable(),
});
export type ClanMember = z.infer<typeof ClanMemberSchema>;

export const ClanMembersResponseSchema = z.object({
  results: ClanMemberSchema.array(),
  total: z.number(),
  page: z.number(),
  limit: z.number(),
  pendingRequests: z.number().optional(),
});
export type ClanMembersResponse = z.infer<typeof ClanMembersResponseSchema>;

export const ClanJoinRequestSchema = z.object({
  publicId: z.string(),
  createdAt: z.string(),
});
export type ClanJoinRequest = z.infer<typeof ClanJoinRequestSchema>;

export const ClanRequestsResponseSchema = z.object({
  results: ClanJoinRequestSchema.array(),
  total: z.number(),
  page: z.number(),
  limit: z.number(),
});
export type ClanRequestsResponse = z.infer<typeof ClanRequestsResponseSchema>;

export const ClanStatsSchema = z.object({
  clanTag: z.string(),
  games: z.number(),
  wins: z.number(),
  losses: z.number(),
  teamTypeWL: z.record(
    z.string(),
    z.object({ wl: z.tuple([z.number(), z.number()]) }),
  ),
});
export type ClanStats = z.infer<typeof ClanStatsSchema>;
