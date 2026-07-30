import { z } from "zod";
import { base64urlToUuid } from "./Base64";
import { ClanTagSchema } from "./Schemas";
import { BigIntStringSchema, PlayerStatsSchema } from "./StatsSchemas";
import { Difficulty, GameMode, RankedType } from "./game/Game";

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
  provider: z.string().optional(),
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

export const SteamUserSchema = z.object({
  steamId: z.string(),
  personaName: z.string().nullable(),
  avatarUrl: z.string().nullable(),
});
export type SteamUser = z.infer<typeof SteamUserSchema>;

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

// Whether a pre-rendered account username belongs to a verified player
// (premium/indefinite bare-name claim holder). The server renders everyone
// else as "base.suffix" and bases can never contain dots
// (AccountUsernameSchema), so a dotless name IS the bare display — no
// dedicated flag needed on list endpoints. TEMPORARY#### server renames are
// bare too but aren't a chosen name, so they don't get the badge (matches
// the verified-name play toggle's eligibility rule).
export function isVerifiedUsername(
  username: string | null | undefined,
): boolean {
  return (
    typeof username === "string" &&
    !username.includes(".") &&
    !isTemporaryUsername(username)
  );
}

export const UserMeResponseSchema = z.object({
  user: z.object({
    discord: DiscordUserSchema.optional(),
    google: GoogleUserSchema.optional(),
    email: z.string().optional(),
    steam: SteamUserSchema.optional(),
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

// Custom tribe names — text names a player buys with hard currency that get
// assigned to bots ("tribes") in real games. Names go live right away; review
// is post-hoc. Status is the backend moderation state: `pending` (bought,
// not yet reviewed) or `live` (reviewed, kept), both in rotation; `rejected`
// (taken down before review) or `revoked` (taken down after). The UI collapses
// these to active vs. rejected. The wire serializes bigints as strings, so
// `id` stays a string.
export const TribeNameStatusSchema = z.enum([
  "pending",
  "live",
  "rejected",
  "revoked",
]);
export type TribeNameStatus = z.infer<typeof TribeNameStatusSchema>;

export const TribeNameSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  status: TribeNameStatusSchema,
  // Player-facing explanation, set only when a mod rejects/revokes the name.
  reviewReason: z.string().nullable(),
  // Count of unexpired boosts. The in-game draw weight is 1 + activeBoosts,
  // so this + 1 is the multiplier to display. Optional for older responses.
  activeBoosts: z.coerce.number().optional(),
  // When the NEXT unexpired boost lapses (activeBoosts next drops);
  // null when unboosted. Deliberately a plain string, not
  // z.iso.datetime(): the API has served raw pg text here
  // ("2026-08-23 18:04:11+00"), and a strict format check on a
  // display-only date fails the whole list parse. The renderer guards
  // unparseable values.
  boostExpiresAt: z.string().nullable().optional(),
});
export type TribeName = z.infer<typeof TribeNameSchema>;

// GET /users/@me/tribe_names. Prices live in cosmetics.json
// (tribeNames.priceHard) — this endpoint only serves the player's names.
export const GetMyTribeNamesResponseSchema = z.object({
  names: z.array(TribeNameSchema),
});
export type GetMyTribeNamesResponse = z.infer<
  typeof GetMyTribeNamesResponseSchema
>;

// POST /users/@me/tribe_names response (201). The name starts `pending`
// today, but accept any status — a stricter literal would fail the parse
// (and show "purchase failed") after the player was already charged.
export const PostTribeNameResponseSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  status: TribeNameStatusSchema,
  pricePaid: z.string(),
});
export type PostTribeNameResponse = z.infer<typeof PostTribeNameResponseSchema>;

// POST /users/@me/tribe_names/:id/boosts response (201). Ids and pricePaid
// are stringified bigints. Boost state (activeBoosts/boostExpiresAt) is
// deliberately absent — re-fetch the name list after a purchase instead of
// reconstructing it client-side.
export const PostTribeBoostResponseSchema = z.object({
  id: z.string(),
  customTribeNameId: z.string(),
  expiresAt: z.iso.datetime(),
  pricePaid: z.string(),
});
export type PostTribeBoostResponse = z.infer<
  typeof PostTribeBoostResponseSchema
>;

// GET /leaderboard/tribes?page=N — public, ranked by rolling 30-day player
// reach. Pages are 1-based, 50 per page, capped at page 2 (top 100); the
// response carries no total or hasMore, so a full page is the only signal
// that another one may exist.
export const TribeLeaderboardEntrySchema = z.object({
  // Absolute across pages: page 2 starts at rank 51.
  rank: z.number(),
  name: z.string(),
  gamesAppeared: z.number(),
  // Impressions, NOT distinct players — one player who saw the name in
  // three games counts three times. Never label this "people seen by".
  playerReach: z.number(),
  // The buyer, same pair the ranked board exposes: the public id to link a
  // profile with, and the account display name (null when they've never set
  // one — fall back to the public id, which is what <player-name> does).
  ownerPublicId: z.string(),
  ownerUsername: z.string().nullable(),
  // Count of unexpired boosts — same predicate and name as the owner-facing
  // field on GET /users/@me/tribe_names above, so it matches what the owner
  // sees (display multiplier = this + 1). A "now" snapshot behind the board's
  // 1h cache, not a window aggregate. Required, so the client must deploy
  // after the API serves it (infra#486; its v2 cache key means every response
  // from that deploy carries the field).
  activeBoosts: z.coerce.number(),
});
export type TribeLeaderboardEntry = z.infer<typeof TribeLeaderboardEntrySchema>;

export const TribeLeaderboardResponseSchema = z.object({
  windowDays: z.number(),
  // Inclusive YYYY-MM-DD bounds of the window. Plain strings rather than
  // z.iso.date(): they are display-only, and a strict format check on a
  // date field would fail the whole board parse if the wire format wobbles
  // the way boostExpiresAt's did above. The renderer guards what it can't
  // read and drops the caption.
  start: z.string(),
  end: z.string(),
  tribes: TribeLeaderboardEntrySchema.array(),
});
export type TribeLeaderboardResponse = z.infer<
  typeof TribeLeaderboardResponseSchema
>;

// GET /public/tribe/:name — the public stats page for one custom tribe name.
// No auth; the name goes URL-encoded in the path and lookup is case- and
// whitespace-insensitive (the response carries the canonical display form).
// Responses are live, unlike the leaderboard's ~1h cache, so small
// discrepancies between this and the board are expected. 404 means unknown,
// rejected/revoked, or owner banned — indistinguishable on purpose. A name
// with no game appearances yet is a 200 with zeroed figures, not a 404.
export const TribeStatsFiguresSchema = z.object({
  gamesAppeared: z.number(),
  // Impressions, NOT distinct players (see TribeLeaderboardEntry.playerReach):
  // display as "appeared in games with N players", never "seen by N people".
  playerReach: z.number(),
});

export const TribeStatsResponseSchema = z.object({
  // Canonical display name.
  name: z.string(),
  // The buyer, same pair the tribes leaderboard exposes; ownerUsername is
  // null when they never set one — fall back to the public id.
  ownerPublicId: z.string(),
  ownerUsername: z.string().nullable(),
  // Unexpired boosts; display multiplier = this + 1, same convention as
  // TribeNameSchema.activeBoosts. Coerced for the same wire tolerance.
  activeBoosts: z.coerce.number(),
  lifetime: TribeStatsFiguresSchema,
  // Same rolling window the tribes leaderboard ranks by, so these figures
  // match the board. Bounds are plain strings, not z.iso.date(), for the
  // same display-only tolerance as TribeLeaderboardResponse's.
  window: TribeStatsFiguresSchema.extend({
    days: z.number(),
    start: z.string(),
    end: z.string(),
  }),
});
export type TribeStatsResponse = z.infer<typeof TribeStatsResponseSchema>;

export const PlayerStatsLeafSchema = z.object({
  wins: BigIntStringSchema,
  losses: BigIntStringSchema,
  total: BigIntStringSchema,
  stats: PlayerStatsSchema,
  recentGames: z
    .array(
      z.object({
        gameId: BigIntStringSchema,
        won: z.boolean(),
      }),
    )
    .optional(),
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
  // Account username, pre-rendered by the server (bare base or "base.suffix").
  // null = the player never set one. Render `username ?? publicId`; never
  // parse it — compare players by publicId only. Optional so responses from
  // an API without the field still parse.
  username: z.string().nullable().optional(),
  stats: PlayerStatsTreeSchema,
  // Clans this player belongs to, tag-ordered. Optional so responses from an
  // API without the field still parse (→ no clans shown).
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
  // Account username (null = never set). The leaderboard displays this or
  // the playerId.
  accountUsername: z.string().nullable(),
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
  // Account username (null = never set). The client displays
  // `accountUsername ?? public_id`.
  accountUsername: z.string().nullable(),
});
export type RankedLeaderboardEntry = z.infer<
  typeof RankedLeaderboardEntrySchema
>;

export const RankedLeaderboardResponseSchema = z.object({
  [RankedType.OneVOne]: RankedLeaderboardEntrySchema.array(),
  // Each ranked type is its own ladder, ranked independently: a player can
  // appear on both with a different elo and rank. Defaulted because an API
  // deployment that predates the 2v2 ladder omits the key entirely.
  [RankedType.TwoVTwo]: RankedLeaderboardEntrySchema.array().default([]),
});
export type RankedLeaderboardResponse = z.infer<
  typeof RankedLeaderboardResponseSchema
>;

export const FriendEntrySchema = z.object({
  publicId: z.string(),
  // Account username (null = never set), always the other party's. Render
  // `username ?? publicId`; identify players by publicId only.
  username: z.string().nullable().optional(),
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

// https-only URL: a plain URL check would accept javascript:/http: URLs, and these flow
// into href/src, so restrict the scheme (the config is served, but this fails an injected
// entry closed rather than rendering it).
const HttpsUrlSchema = z.url({ protocol: /^https$/ });

// One verified-live stream in the homepage streaming features. Produced only by the
// API's cron (Twitch Helix; YouTube RSS + videos.list) and served by GET /streams.json.
// `channel` is the login/handle used to derive the watch URL when `url` is absent;
// image/link fields are validated so a malformed entry fails the feed closed.
//
// `startedAt` is required on purpose. It can only come from a live lookup, so a payload
// built from static config cannot satisfy this schema — which means an API still serving
// the older {enabled, channels} shape fails validation and falls back to "show nothing",
// rather than being mistaken for a current one. Liveness is never decided on the client.
export const LiveStreamSchema = z.object({
  platform: z.enum(["twitch", "youtube"]),
  // Login/handle as it appears in the watch URL (twitch.tv/<login>, youtube.com/@handle).
  // One conservative charset for both platforms — no slashes, queries, or whitespace — so
  // an entry can't smuggle path/query segments into the derived URL.
  channel: z
    .string()
    .min(1)
    .max(100)
    .regex(/^@?[A-Za-z0-9._-]+$/, "invalid channel handle"),
  displayName: z.string().min(1).max(100),
  title: z.string().max(200).optional(),
  viewers: z.number().int().nonnegative().default(0),
  avatarUrl: HttpsUrlSchema.optional(),
  url: HttpsUrlSchema.optional(),
  startedAt: z.iso.datetime(),
});
export type LiveStream = z.infer<typeof LiveStreamSchema>;

// The single served feed (GET /streams.json). `featured` is the embed candidate list in
// admin priority order; `live` is the "Streaming Now" list sorted by viewers.
//
// There is no `enabled` flag: an empty array means "show nothing". An overloaded toggle
// is exactly what made the old payload ambiguous — it meant "configured" in one API
// version and "live" in the next, with an identical shape. `verifiedAt` is when the API
// built the feed, so the client can refuse one the edge served long after the cron died.
export const StreamsFeedSchema = z.object({
  verifiedAt: z.iso.datetime(),
  featured: z.array(LiveStreamSchema).default([]),
  live: z.array(LiveStreamSchema).default([]),
});
export type StreamsFeed = z.infer<typeof StreamsFeedSchema>;
