import { z } from "zod";
import { base64urlToUuid } from "./Base64";
import { ClanTagSchema } from "./Schemas";
import { BigIntStringSchema, PlayerStatsSchema } from "./StatsSchemas";
import { Difficulty, GameMode, RankedType } from "./game/Game";

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
  role: z
    .enum(["root", "admin", "mod", "flagged", "banned"])
    // In case new roles are added in the future.
    .or(z.string())
    .optional(),
});
export type TokenPayload = z.infer<typeof TokenPayloadSchema>;

export const ADMIN_ROLES = ["admin", "root"] as const;
export function isAdminRole(role: string | null | undefined): boolean {
  return role === "admin" || role === "root";
}

export const DiscordUserSchema = z.object({
  id: z.string(),
  avatar: z.string().nullable(),
  username: z.string(),
  global_name: z.string().nullable(),
  discriminator: z.string(),
});
export type DiscordUser = z.infer<typeof DiscordUserSchema>;

export const GoogleUserSchema = z.object({
  email: z.string(),
});
export type GoogleUser = z.infer<typeof GoogleUserSchema>;

const SingleplayerMapAchievementSchema = z.object({
  mapName: z.string(),
  difficulty: z.enum(Difficulty),
});

// An unclaimed subscription reward from GET /users/@me. `id` and `amount` are
// stringified bigints — keep them as strings (amount can in principle exceed
// Number.MAX_SAFE_INTEGER). `reason` is open-ended server-side; fall back to
// `note` for unknown values rather than exhausting on an enum.
export const RewardSchema = z.object({
  id: z.string(),
  currencyType: z.enum(["soft", "hard"]),
  amount: z.string(),
  reason: z.string(),
  note: z.string().nullable(),
});
export type Reward = z.infer<typeof RewardSchema>;

const CurrencyBalancesSchema = z.object({
  soft: z.coerce.number(),
  hard: z.coerce.number(),
});

// POST /rewards/:rewardId/claim and /rewards/claim-all both return the
// post-claim balances so the UI can update without re-fetching /users/@me.
export const ClaimRewardResponseSchema = z.object({
  currency: CurrencyBalancesSchema,
});
export type ClaimRewardResponse = z.infer<typeof ClaimRewardResponseSchema>;

export const ClaimAllRewardsResponseSchema = z.object({
  claimed: z.array(z.object({ id: z.string() })),
  currency: CurrencyBalancesSchema,
});
export type ClaimAllRewardsResponse = z.infer<
  typeof ClaimAllRewardsResponseSchema
>;

// Account-username lifecycle. `unclaimed`: no bare-name reservation (default).
// `claimed`: reservation held but subscription lapsed — the suffix shows again
// and a grace deadline runs. `premium`: subscribed, bare display. `indefinite`:
// admin-locked bare display. Statuses change server-side without client action
// (Stripe webhooks, admin edits) — re-fetch /users/@me rather than caching.
export const UsernameStatusSchema = z.enum([
  "unclaimed",
  "claimed",
  "premium",
  "indefinite",
]);
export type UsernameStatus = z.infer<typeof UsernameStatusSchema>;

// When a player subscribes while someone else exclusively holds their bare
// name, the server renames them to TEMPORARY#### and clears their cooldown so
// the rename is free. Detect it to prompt for a real name.
export function isTemporaryUsername(base: string | null | undefined): boolean {
  return typeof base === "string" && /^TEMPORARY\d{4}$/.test(base);
}

export const UserMeResponseSchema = z.object({
  user: z.object({
    discord: DiscordUserSchema.optional(),
    google: GoogleUserSchema.optional(),
    email: z.string().optional(),
  }),
  player: z.object({
    publicId: z.string(),
    adfree: z.boolean(),
    // True when the player's active subscription tier exempts them from the
    // free-ranked-play limits.
    unlimitedRanked: z.boolean(),
    // True when the player may list a custom lobby publicly. The API decides
    // which subscriptions/grants confer this.
    canCreatePublicLobbies: z.boolean(),
    // Account username (custom-usernames). All optional so responses from an
    // API without the feature still parse; absent means the same as never set.
    // `username` is the server-resolved DISPLAY form — the bare base for an
    // entitled claim holder, otherwise "base.suffix". Render it as-is; never
    // assemble base + discriminator client-side. The discriminator is exactly
    // 4 digits and may have leading zeros — keep it a string.
    username: z.string().nullable().optional(),
    usernameBase: z.string().nullable().optional(),
    usernameDiscriminator: z.string().nullable().optional(),
    usernameStatus: UsernameStatusSchema.optional(),
    // Only non-null in `claimed`: when the exclusive right to the bare name
    // becomes takeable by another subscriber. A past date means "at risk",
    // not "lost" — it stays set until the name is actually taken.
    usernameClaimExpiresAt: z.iso.datetime().nullable().optional(),
    // When the player may next self-rename. May be in the past — past or
    // null both mean a rename is allowed.
    nextUsernameChangeAt: z.iso.datetime().nullable().optional(),
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
        twoVtwo: z
          .object({
            elo: z.number().optional(),
          })
          .optional(),
      })
      .optional(),
    currency: CurrencyBalancesSchema.optional(),
    // Unclaimed rewards — NOT included in `currency` balances until claimed.
    rewards: RewardSchema.array().optional(),
    clans: z
      .array(
        z.object({
          tag: RequiredClanTagSchema,
          name: z.string(),
          role: z.enum(["leader", "officer", "member"]),
          joinedAt: z.iso.datetime(),
          memberCount: z.number().int().min(1),
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
    friends: z.array(z.string()),
    subscription: z
      .object({
        tier: z.string(),
        status: z.string(),
        currentPeriodEnd: z.coerce.date().nullable(),
        cancelAtPeriodEnd: z.boolean(),
      })
      .nullable(),
    // Marketing-email consent state (client-driven consent). `consented` is the
    // player's current decision; `hasEmail` is whether a verified contact email
    // exists to subscribe. Optional so an older API without the field is treated
    // as "no consent UI".
    marketingConsent: z
      .object({
        consented: z.enum(["approved", "denied", "no_response"]),
        hasEmail: z.boolean(),
      })
      .optional(),
  }),
});
export type UserMeResponse = z.infer<typeof UserMeResponseSchema>;
export type UserSubscription = NonNullable<
  NonNullable<UserMeResponse["player"]["subscription"]>
>;

// PUT /users/@me/username success payload. `username` is the resolved display
// form (safe for optimistic UI). The suffix is re-rolled on every rename and
// the response carries the fresh 30-day cooldown.
export const PutUsernameResponseSchema = z.object({
  username: z.string(),
  base: z.string(),
  discriminator: z.string(),
  usernameStatus: UsernameStatusSchema,
  nextUsernameChangeAt: z.iso.datetime().nullable(),
});
export type PutUsernameResponse = z.infer<typeof PutUsernameResponseSchema>;

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

export const PlayerProfileSchema = z.object({
  createdAt: z.iso.datetime(),
  user: DiscordUserSchema.optional(),
  stats: PlayerStatsTreeSchema,
});
export type PlayerProfile = z.infer<typeof PlayerProfileSchema>;

// Mode buckets for GET /public/player/:publicId/games — mirrors the clan
// game-history filter (see ClanGameFilter). Resolved server-side off the
// games join (mode / ranked_type / player_teams).
export const PlayerGameModeFilters = ["ffa", "team", "hvn", "ranked"] as const;
export const PlayerGameModeFilterSchema = z.enum(PlayerGameModeFilters);
export type PlayerGameModeFilter = z.infer<typeof PlayerGameModeFilterSchema>;

// Game-type split — orthogonal to the mode filter. Matches games.type.
export const PlayerGameTypeFilters = [
  "public",
  "private",
  "singleplayer",
] as const;
export const PlayerGameTypeFilterSchema = z.enum(PlayerGameTypeFilters);
export type PlayerGameTypeFilter = z.infer<typeof PlayerGameTypeFilterSchema>;

// "incomplete" covers games with no recorded winner (winnerType IS NULL).
export const PlayerGameResultSchema = z.enum([
  "victory",
  "defeat",
  "incomplete",
]);
export type PlayerGameResult = z.infer<typeof PlayerGameResultSchema>;

export const PublicPlayerGameSchema = z.object({
  gameId: z.string(),
  start: z.iso.datetime(),
  durationSeconds: z.number().int().nonnegative(),
  map: z.string().trim(),
  mode: z.string(),
  type: z.string(),
  playerTeams: z.string().nullable(),
  rankedType: z.string(),
  result: PlayerGameResultSchema,
  totalPlayers: z.number().int().nonnegative().nullable(),
  username: z.string(),
  clanTag: z.string().nullable(),
});
export type PublicPlayerGame = z.infer<typeof PublicPlayerGameSchema>;

export const PublicPlayerGamesResponseSchema = z.object({
  results: PublicPlayerGameSchema.array(),
  // Opaque continuation token. Round-trip verbatim as the `cursor` query
  // parameter to fetch the next page; never construct or parse it. `null`
  // means the server has no more rows to serve.
  nextCursor: z.string().nullable(),
});
export type PublicPlayerGamesResponse = z.infer<
  typeof PublicPlayerGamesResponseSchema
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

export const FriendEntrySchema = z.object({
  publicId: z.string(),
  createdAt: z.iso.datetime(),
});
export type FriendEntry = z.infer<typeof FriendEntrySchema>;

export const FriendRequestsResponseSchema = z.object({
  incoming: FriendEntrySchema.array(),
  outgoing: FriendEntrySchema.array(),
});
export type FriendRequestsResponse = z.infer<
  typeof FriendRequestsResponseSchema
>;

export const FriendsListResponseSchema = z.object({
  results: FriendEntrySchema.array(),
  total: z.number(),
  page: z.number(),
  limit: z.number(),
});
export type FriendsListResponse = z.infer<typeof FriendsListResponseSchema>;

export const SendFriendRequestResponseSchema = z.object({
  status: z.enum(["requested", "accepted"]),
});
export type SendFriendRequestResponse = z.infer<
  typeof SendFriendRequestResponseSchema
>;

export const NewsItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().optional(),
  descriptionTranslationKey: z.string().optional(),
  url: z.string().nullable().optional(),
  type: z.enum(["tournament", "tutorial", "announcement"]).or(z.string()),
});
export type NewsItem = z.infer<typeof NewsItemSchema>;
