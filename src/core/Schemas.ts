import quickChatData from "resources/QuickChat.json";
import { z } from "zod";
import { zb } from "../../zbin";
import {
  ColorPaletteSchema,
  CosmeticNameSchema,
  EffectTypeSchema,
  PatternDataSchema,
} from "./CosmeticSchemas";
import type { GameEvent } from "./EventBus";
import {
  AllPlayers,
  Difficulty,
  Duos,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
  HumansVsNations,
  MAX_UPGRADE_AMOUNT,
  Quads,
  RankedType,
  Trios,
  UnitType,
} from "./game/Game";
import { ArchivedPlayerStatsSchema, PlayerStatsSchema } from "./StatsSchemas";
import { flattenedEmojiTable, LOBBY_LABEL_MAX } from "./Util";

export type GameID = string;
export type ClientID = string;

export type Intent =
  | SpawnIntent
  | AttackIntent
  | CancelAttackIntent
  | BoatAttackIntent
  | CancelBoatIntent
  | AllianceRequestIntent
  | AllianceRejectIntent
  | AllianceExtensionIntent
  | BreakAllianceIntent
  | TargetPlayerIntent
  | EmojiIntent
  | DonateGoldIntent
  | DonateTroopsIntent
  | BuildUnitIntent
  | EmbargoIntent
  | QuickChatIntent
  | MoveWarshipIntent
  | MarkDisconnectedIntent
  | EmbargoAllIntent
  | UpgradeStructureIntent
  | DeleteUnitIntent
  | KickPlayerIntent
  | TogglePauseIntent
  | UpdateGameConfigIntent
  | ToggleGameStartTimer;

export type AttackIntent = z.infer<typeof AttackIntentSchema>;
export type CancelAttackIntent = z.infer<typeof CancelAttackIntentSchema>;
export type SpawnIntent = z.infer<typeof SpawnIntentSchema>;
export type BoatAttackIntent = z.infer<typeof BoatAttackIntentSchema>;
export type EmbargoAllIntent = z.infer<typeof EmbargoAllIntentSchema>;
export type CancelBoatIntent = z.infer<typeof CancelBoatIntentSchema>;
export type AllianceRequestIntent = z.infer<typeof AllianceRequestIntentSchema>;
export type AllianceRejectIntent = z.infer<typeof AllianceRejectIntentSchema>;
export type BreakAllianceIntent = z.infer<typeof BreakAllianceIntentSchema>;
export type TargetPlayerIntent = z.infer<typeof TargetPlayerIntentSchema>;
export type EmojiIntent = z.infer<typeof EmojiIntentSchema>;
export type DonateGoldIntent = z.infer<typeof DonateGoldIntentSchema>;
export type DonateTroopsIntent = z.infer<typeof DonateTroopIntentSchema>;
export type EmbargoIntent = z.infer<typeof EmbargoIntentSchema>;
export type BuildUnitIntent = z.infer<typeof BuildUnitIntentSchema>;
export type UpgradeStructureIntent = z.infer<
  typeof UpgradeStructureIntentSchema
>;
export type MoveWarshipIntent = z.infer<typeof MoveWarshipIntentSchema>;
export type QuickChatIntent = z.infer<typeof QuickChatIntentSchema>;
export type MarkDisconnectedIntent = z.infer<
  typeof MarkDisconnectedIntentSchema
>;
export type AllianceExtensionIntent = z.infer<
  typeof AllianceExtensionIntentSchema
>;
export type DeleteUnitIntent = z.infer<typeof DeleteUnitIntentSchema>;
export type KickPlayerIntent = z.infer<typeof KickPlayerIntentSchema>;
export type TogglePauseIntent = z.infer<typeof TogglePauseIntentSchema>;
export type UpdateGameConfigIntent = z.infer<
  typeof UpdateGameConfigIntentSchema
>;
export type ToggleGameStartTimer = z.infer<
  typeof ToggleGameStartTimerIntentSchema
>;

export type Turn = z.infer<typeof TurnSchema>;
export type GameConfig = z.infer<typeof GameConfigSchema>;

export type ClientMessage =
  | ClientSendWinnerMessage
  | ClientSendLiveStatsMessage
  | ClientPingMessage
  | ClientIntentMessage
  | ClientJoinMessage
  | ClientRejoinMessage
  | ClientLogMessage
  | ClientHashMessage
  | ClientSpectateMessage
  | ClientReportMessage;

export type ServerMessage =
  | ServerTurnMessage
  | ServerStartGameMessage
  | ServerPingMessage
  | ServerDesyncMessage
  | ServerPrestartMessage
  | ServerErrorMessage
  | ServerLobbyInfoMessage
  | ServerNewLobbyMessage;

export type ServerTurnMessage = z.infer<typeof ServerTurnMessageSchema>;
export type ServerStartGameMessage = z.infer<
  typeof ServerStartGameMessageSchema
>;
export type ServerPingMessage = z.infer<typeof ServerPingMessageSchema>;
export type ServerDesyncMessage = z.infer<typeof ServerDesyncSchema>;
export type ServerPrestartMessage = z.infer<typeof ServerPrestartMessageSchema>;
export type ServerErrorMessage = z.infer<typeof ServerErrorSchema>;
export type ServerLobbyInfoMessage = z.infer<
  typeof ServerLobbyInfoMessageSchema
>;
export type ServerNewLobbyMessage = z.infer<typeof ServerNewLobbyMessageSchema>;
export type ClientSendWinnerMessage = z.infer<typeof ClientSendWinnerSchema>;
export type ClientSendLiveStatsMessage = z.infer<
  typeof ClientSendLiveStatsSchema
>;
export type ClientReportMessage = z.infer<typeof ClientReportMessageSchema>;
export type ReportReason = z.infer<typeof ReportReasonSchema>;
export type PlayerReport = z.infer<typeof PlayerReportSchema>;
export type PlayerLiveStats = z.infer<typeof PlayerLiveStatsSchema>;
export type LiveStats = z.infer<typeof LiveStatsSchema>;
export type ClientPingMessage = z.infer<typeof ClientPingMessageSchema>;
export type ClientIntentMessage = z.infer<typeof ClientIntentMessageSchema>;
export type ClientJoinMessage = z.infer<typeof ClientJoinMessageSchema>;
export type ClientRejoinMessage = z.infer<typeof ClientRejoinMessageSchema>;
export type ClientLogMessage = z.infer<typeof ClientLogMessageSchema>;
export type ClientHashMessage = z.infer<typeof ClientHashSchema>;
export type ClientSpectateMessage = z.infer<typeof ClientSpectateMessageSchema>;

export type AllPlayersStats = z.infer<typeof AllPlayersStatsSchema>;
export type Player = z.infer<typeof PlayerSchema>;
export type PlayerCosmetics = z.infer<typeof PlayerCosmeticsSchema>;
export type PlayerCosmeticRefs = z.infer<typeof PlayerCosmeticRefsSchema>;
export type PlayerPattern = z.infer<typeof PlayerPatternSchema>;
export type PlayerColor = z.infer<typeof PlayerColorSchema>;
export type PlayerSkin = z.infer<typeof PlayerSkinSchema>;
export type PlayerCrown = z.infer<typeof PlayerCrownSchema>;
export type PlayerEffect = z.infer<typeof PlayerEffectSchema>;
export type GameStartInfo = z.infer<typeof GameStartInfoSchema>;
export type GameInfo = z.infer<typeof GameInfoSchema>;
export type PublicGames = z.infer<typeof PublicGamesSchema>;
export type PublicGameInfo = z.infer<typeof PublicGameInfoSchema>;
export type PublicGameType = z.infer<typeof PublicGameTypeSchema>;

export const PublicGameTypeSchema = z.enum([
  "ffa",
  "team",
  "special",
  "hosted",
]);

// Lobby types the master schedules from the map playlist. "hosted" is
// excluded: those are player-created private lobbies that a subscriber has
// listed publicly, and the host (not the master) controls their lifecycle.
// Derived from PublicGameTypeSchema so a new lobby type is scheduled by
// default and opting out is the explicit act.
export const ScheduledPublicGameTypeSchema = PublicGameTypeSchema.exclude([
  "hosted",
]);
export const SCHEDULED_PUBLIC_GAME_TYPES =
  ScheduledPublicGameTypeSchema.options;
export type ScheduledPublicGameType = z.infer<
  typeof ScheduledPublicGameTypeSchema
>;

// Cluster-wide cap on subscriber-listed (hosted) lobbies, to prevent listing
// spam. Workers reject listings past the cap; the master caps the broadcast
// and delists any overflow as the authoritative backstop.
export const MAX_HOSTED_LOBBIES = 10;

// How long a lobby may stay publicly listed before it starts automatically,
// so hosts can't sit on a listing indefinitely. Unlisting cancels the
// deadline; relisting starts a fresh one.
export const HOSTED_LOBBY_AUTO_START_MS = 5 * 60 * 1000;

// Featured lobbies get a longer window. A scheduled event announced ahead of
// time needs the listing to still be up when its audience arrives, and unlike a
// subscriber sitting on a listing the host is an authenticated admin bot. Only
// create_game can set it, so the ordinary deadline still governs every
// player-hosted lobby.
export const FEATURED_LOBBY_AUTO_START_MS = 10 * 60 * 1000;

// Labels are capped by CODE POINT, matching sanitizeLobbyLabel. z.string().max()
// counts UTF-16 code units, so it would reject a legal 48-emoji label (96 units)
// before the sanitiser ever saw it.
export const LobbyLabelSchema = z
  .string()
  .refine((v) => Array.from(v).length <= LOBBY_LABEL_MAX, {
    message: `label must be at most ${LOBBY_LABEL_MAX} characters`,
  });

// Accent applied to a featured lobby's row. A closed set, not free-form CSS:
// arbitrary styling in a shared list lets one lobby make every other row
// unreadable.
export const LobbyAccentSchema = z.enum(["gold", "blue", "green", "red"]);
export type LobbyAccent = z.infer<typeof LobbyAccentSchema>;

// Deliberately looser than MAX_USERNAME_LENGTH, which caps what the form will
// accept at 20. This schema also reads data at rest: it backs PlayerSchema,
// so every archived GameRecord embeds names written under the rules of its
// era. Lowering the bound doesn't rewrite those records — it makes them
// unparseable, which dead-ends replay links (JoinLobbyModal parses before the
// gitCommit check, so a failure never reaches the versioned-shell fallback)
// and share previews (GamePreviewBuilder). Widen freely; never narrow.
//
// The charset accepts everything AccountUsernameSchema can produce, hyphens
// included, so a verified account name is always representable on the wire —
// verified play skips free-form validation, so an unrepresentable name would
// reach the server and be closed with 1002.
//
// Letters and digits the in-game name renderer can actually draw, plus the
// punctuation a name may carry. This is what lets José, Müller, Renée and
// Bjørn keep their names instead of falling back to a generated one.
//
// The bound is U+00FF — the end of Latin-1 Supplement — and it is set by the
// renderer twice over. Do not raise it without changing the renderer first:
//
//  1. The string path is 8-bit end to end. `TextLayout` writes
//     `charCodes[i] = text.charCodeAt(i)` into a `Uint8Array`, `DataTextures`
//     uploads it as `R8UI`/`UNSIGNED_BYTE`, and `name.vert.glsl` uses the
//     byte directly as the glyph index. Anything above 255 silently truncates
//     mod 256: Ł (U+0141) would draw as "A", ā (U+0101) as a code-0 slot the
//     shader drops while still consuming a layout position.
//  2. The atlas has no glyphs up there anyway. Of the 128 Latin Extended-A
//     entries in `resources/atlases/msdf-atlas.json`, exactly three (Œ œ Ÿ)
//     have a real glyph; the other 125 point at .notdef. All 64 Latin-1
//     Supplement entries are real.
//
// `CHAR_RANGE = 384` in the name-pass sizes the metrics and kerning tables, so
// it looks like the limit and is not — it is an upper bound on ids the atlas
// file may contain, not on what the string path can carry.
//
// Deliberately NOT every codepoint below the bound: that would admit control
// characters, the C1 block, and HTML-significant punctuation. The ranges skip
// × (U+00D7) and ÷ (U+00F7), maths symbols sitting inside the Latin-1 letter
// block, and the ordinal/micro signs.
//
// Emoji are excluded on purpose and stay excluded: the renderer draws them as
// a separate icon beside the name, never inline, so an emoji in the name
// itself has no glyph at all.
//
// Regex source for the character class, not a finished pattern: the wire
// schema, the free-form form rule and the persona sanitiser all need the same
// set in different shapes, and a single source is what keeps them from
// drifting apart by hand (which is how the charsets got out of step before).
export const RENDERABLE_NAME_ALNUM =
  "a-zA-Z0-9\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u00FF";
export const RENDERABLE_NAME_CHARS = ` _.\\-${RENDERABLE_NAME_ALNUM}`;

/** One renderable character. Used per-codepoint by the persona sanitiser. */
export const RENDERABLE_NAME_CHAR_RE = new RegExp(
  `^[${RENDERABLE_NAME_CHARS}]$`,
  "u",
);

/** At least one letter or digit — punctuation alone is not a name. */
export const RENDERABLE_NAME_HAS_ALNUM_RE = new RegExp(
  `[${RENDERABLE_NAME_ALNUM}]`,
  "u",
);

// Requires at least one non-space so a name is never all padding.
export const UsernameSchema = z
  .string()
  .regex(new RegExp(`^(?=.*\\S)[${RENDERABLE_NAME_CHARS}]+$`, "u"))
  .min(3)
  .max(27);

export const ClanTagSchema = z
  .string()
  .regex(/^[a-zA-Z0-9]{2,5}$/)
  .nullable();

const ClientInfoSchema = z.object({
  clientID: z.string(),
  username: UsernameSchema,
  clanTag: ClanTagSchema,
  friends: z.array(z.string()).optional(),
  // Plays under their server-validated account name (blue check in the
  // lobby list). Never set on anonymized entries — the badge vouches for
  // the exact display name.
  verified: z.boolean().optional(),
  // Watching rather than playing. Listed like anyone else — a spectator sees the
  // lobby exactly as a player does — but not in the simulation.
  spectator: z.boolean().optional(),
  // Server-pinned team slot for matchmade team games, so the lobby's team
  // preview can honour the pins instead of re-deriving teams that the server
  // will overrule at start. Absent when the game isn't matchmade.
  teamIndex: zb.uint().optional(),
});

export const GameInfoSchema = z.object({
  gameID: z.string(),
  clients: z.array(ClientInfoSchema).optional(),
  lobbyCreatorClientID: z.string().optional(),
  startsAt: zb.uint().optional(),
  serverTime: zb.uint(),
  gameConfig: z.lazy(() => GameConfigSchema).optional(),
  publicGameType: PublicGameTypeSchema.optional(),
  // Private lobbies only: whether the lobby is publicly listed. Server-owned
  // (only /api/game/:id/listing sets it); carried in lobby info so the host
  // UI stays in sync when the server delists (whitelist enabled, duplicate
  // creator resolved by the master).
  listed: z.boolean().optional(),
  // Listed lobbies only: server timestamp when the lobby starts
  // automatically (hosts can't sit on a public listing indefinitely).
  autoStartAt: zb.uint().optional(),
  // Featured lobbies only (admin bot). Echoed back so the creating bot can
  // confirm the request took effect, the same way it checks `listed`.
  label: LobbyLabelSchema.optional(),
  accent: LobbyAccentSchema.optional(),
  featured: z.boolean().optional(),
});

// Browser-facing lobby info. Master/worker-internal fields (the creator hash
// used for the one-listed-lobby-per-creator check) live on
// InternalGameInfoSchema in IPCBridgeSchema.ts, so client payloads cannot
// carry them by construction.
export const PublicGameInfoSchema = z.object({
  gameID: z.string(),
  numClients: zb.uint(),
  startsAt: zb.uint().optional(),
  gameConfig: z.lazy(() => GameConfigSchema).optional(),
  publicGameType: PublicGameTypeSchema,
  // Featured lobbies only. Both optional so a client on an older build simply
  // renders the map name as it does today.
  label: LobbyLabelSchema.optional(),
  accent: LobbyAccentSchema.optional(),
  featured: z.boolean().optional(),
});

export const PublicGamesSchema = z.object({
  serverTime: zb.uint(),
  // partialRecord: every consumer already treats buckets as optional, and it
  // lets clients tolerate servers that don't send every lobby type.
  games: z.partialRecord(PublicGameTypeSchema, z.array(PublicGameInfoSchema)),
});

// Wire message sent from server to lobby WebSocket clients.
// "full" carries the complete snapshot; "counts" carries only the
// per-lobby player counts, which change far more often than the rest.
export const PublicLobbyFullSchema = z.object({
  type: z.literal("full"),
  serverTime: zb.uint(),
  games: z.partialRecord(PublicGameTypeSchema, z.array(PublicGameInfoSchema)),
});

export const PublicLobbyCountsSchema = z.object({
  type: z.literal("counts"),
  serverTime: zb.uint(),
  counts: z.record(z.string(), zb.uint()),
});

export const PublicLobbyMessageSchema = zb.discriminatedUnion("type", [
  PublicLobbyFullSchema,
  PublicLobbyCountsSchema,
]);

export type PublicLobbyMessage = z.infer<typeof PublicLobbyMessageSchema>;

export class LobbyInfoEvent implements GameEvent {
  constructor(
    public lobby: GameInfo,
    public myClientID: ClientID,
  ) {}
}

export interface ClientInfo {
  clientID: ClientID;
  username: string;
  clanTag: string | null;
  friends?: ClientID[];
  // Plays under their server-validated account name (blue check). Never set
  // on anonymized entries.
  verified?: boolean;
  // Watching rather than playing — listed like anyone else, but not in the
  // simulation.
  spectator?: boolean;
  // Server-pinned team slot for matchmade team games; absent when not matchmade.
  teamIndex?: number;
}
export enum LogSeverity {
  Debug = "DEBUG",
  Info = "INFO",
  Warn = "WARN",
  Error = "ERROR",
  Fatal = "FATAL",
}

//
// Utility types
//

// select: encoding an untagged union without one costs a zod safeParse per
// rejected candidate (~10 µs each) — real money on schemas embedded in every
// GameConfig on the wire. The candidate ORDER is the wire layout; only the
// picking got cheaper.
const TEAM_COUNT_PRESETS = [Duos, Trios, Quads, HumansVsNations] as const;
const TeamCountConfigSchema = zb.union(
  [
    zb.uint(),
    z.literal(Duos),
    z.literal(Trios),
    z.literal(Quads),
    z.literal(HumansVsNations),
  ],
  {
    select: (v) =>
      typeof v === "number"
        ? 0
        : TEAM_COUNT_PRESETS.indexOf(v as (typeof TEAM_COUNT_PRESETS)[number]) +
          1,
  },
);
export type TeamCountConfig = z.infer<typeof TeamCountConfigSchema>;

// Doomsday Clock (anti-stall). Below a rising share of the map a player (or, in
// team modes, their whole team) gets skulled and their troops drain to zero. The
// required share rises in discrete waves per the `speed` preset (see
// DoomsdayClock.ts). Only `enabled` and `speed` are wire-configurable; the
// drain/warn tuning lives in DOOMSDAY_CLOCK_DEFAULTS (Config.ts).
export const DoomsdayClockConfigSchema = z.object({
  enabled: z.boolean().optional(),
  speed: z.enum(["slow", "normal", "fast", "veryfast"]).optional(),
});

// Overtime (anti-stalemate). After startMinutes of game time the tile share
// required to win drops steadily from the 80% base at a fixed rate (see
// OVERTIME_DEFAULTS in Config.ts), so the leading side eventually crosses the
// shrinking bar and a stalled game is guaranteed to end. Only `enabled` and
// `startMinutes` are wire-configurable.
export const OvertimeConfigSchema = z.object({
  enabled: z.boolean().optional(),
  startMinutes: zb.uint({ min: 1, max: 120 }).optional(),
});

export const GameConfigSchema = z.object({
  gameMap: z.enum(GameMapType),
  difficulty: z.enum(Difficulty),
  donateGold: z.boolean(), // Configures donations to humans only
  donateTroops: z.boolean(), // Configures donations to humans only
  gameType: z.enum(GameType),
  gameMode: z.enum(GameMode),
  rankedType: z.enum(RankedType).optional(), // Only set for ranked games.
  gameMapSize: z.enum(GameMapSize),
  doomsdayClock: DoomsdayClockConfigSchema.optional(),
  overtime: OvertimeConfigSchema.optional(),
  publicGameModifiers: z
    .object({
      isCompact: z.boolean().optional(),
      isRandomSpawn: z.boolean().optional(),
      isCrowded: z.boolean().optional(),
      isHardNations: z.boolean().optional(),
      startingGold: zb.uint().optional(),
      goldMultiplier: zb.float({ min: 0.1, max: 1000 }).optional(),
      isAlliancesDisabled: z.boolean().optional(),
      isPortsDisabled: z.boolean().optional(),
      isNukesDisabled: z.boolean().optional(),
      isSAMsDisabled: z.boolean().optional(),
      isPeaceTime: z.boolean().optional(),
      isWaterNukes: z.boolean().optional(),
      isDoomsdayClock: z.boolean().optional(),
    })
    .optional(),
  nations: zb.union(
    [zb.uint({ min: 1, max: 400 }), z.enum(["default", "disabled"])],
    {
      select: (v) => (typeof v === "number" ? 0 : 1),
    },
  ),
  bots: zb.uint({ max: 400 }),
  infiniteGold: z.boolean(),
  infiniteTroops: z.boolean(),
  instantBuild: z.boolean(),
  disableNavMesh: z.boolean().optional(),
  disableAlliances: z.boolean().nullable().optional(),
  disableClanTags: z.boolean().optional(),
  // Opt-in live game stats reporting for the admin bot. Off by default and has
  // no UI — the admin bot sets it when creating tournament games, since it adds
  // per-client traffic. See LiveStatsController / GameServer.handleLiveStats.
  liveStatsEnabled: z.boolean().optional(),
  anonymizeNames: z.boolean().optional(),
  // While anonymizeNames is on, clientIDs the host has granted real-name
  // visibility to (e.g. casters / observers). Everyone else stays anonymized.
  nameReveals: z.string().array().optional(),
  // Like nameReveals but keyed by stable account publicId (for automated hosts
  // that only know publicIds at create_game); resolved to clientID at lookup.
  nameRevealPublicIds: z.string().array().max(200).optional(),
  waterNukes: z.boolean().nullable().optional(),
  randomSpawn: z.boolean(),
  maxPlayers: zb.uint().optional(),
  // OFM: allowlist of publicIds allowed to join (admin-only, see create_game).
  allowedPublicIds: z.array(z.string()).max(200).optional(),
  // Only accounts the API reports as trusted (users/@me `trustTier`) may join.
  // Enforced server-side at join (GameServer.joinClient); advertised in the
  // lobby browser so a card can show a lock. No host UI yet: set through
  // create_game / update_game_config.
  trusted: z.boolean().optional(),
  maxTimerValue: zb.uint({ min: 1, max: 120 }).nullable().optional(), // In minutes
  customAllianceDuration: zb.uint({ max: 15 }).nullable().optional(), // In minutes; 0 disables alliances
  startDelay: zb.uint({ max: 600 }).nullable().optional(), // In seconds
  spawnImmunityDuration: zb.uint().nullable().optional(), // In ticks
  disabledUnits: z.enum(UnitType).array().optional(),
  playerTeams: TeamCountConfigSchema.optional(),
  goldMultiplier: zb.float({ min: 0.1, max: 1000 }).nullable().optional(),
  startingGold: zb.uint({ max: 1000000000 }).nullable().optional(),
  hostCheats: z
    .object({
      infiniteGold: z.boolean().optional(),
      infiniteTroops: z.boolean().optional(),
      goldMultiplier: zb.float({ min: 0.1, max: 1000 }).nullable().optional(),
      startingGold: zb.uint({ max: 1000000000 }).nullable().optional(),
    })
    .optional(),
});

export const TeamSchema = z.string();

export const SafeString = z
  .string()
  .regex(
    /^([a-zA-Z0-9\s.,!?@#$%&*()\-_+=[\]{}|;:"'/\u00a9|\u00ae|[\u2000-\u3300]|\ud83c[\ud000-\udfff]|\ud83d[\ud000-\udfff]|\ud83e[\ud000-\udfff]|[üÜ])*$/u,
  )
  .max(1000);

export const PersistentIdSchema = z.uuid();
const JwtTokenSchema = z.jwt();
const TokenSchema = z
  .string()
  .refine(
    (v) =>
      PersistentIdSchema.safeParse(v).success ||
      JwtTokenSchema.safeParse(v).success,
    {
      message: "Token must be a valid UUID or JWT",
    },
  );

const EmojiSchema = zb.uint({ max: flattenedEmojiTable.length - 1 });

export const GAME_ID_REGEX = /^[A-Za-z0-9]{8}$/;

export const isValidGameID = (value: string): boolean =>
  GAME_ID_REGEX.test(value);

export const ID = z.string().regex(GAME_ID_REGEX);

// zbin dictionary for player clientIDs (see ZbinWire.ts): both peers seed it
// from GameStartInfo.players, so an in-game player id costs one byte on the
// binary wire. Validates exactly like ID; ids outside the roster (e.g.
// ADMIN_BOT_CLIENT_ID) encode inline via the escape byte.
export const CLIENT_ID_MAPPING = "clientId";
const MappedID = zb.mapped(CLIENT_ID_MAPPING, { regex: GAME_ID_REGEX });

export const AllPlayersStatsSchema = z.record(ID, PlayerStatsSchema);

export const QuickChatKeySchema = z.enum(
  Object.entries(quickChatData).flatMap(([category, entries]) =>
    entries.map((entry) => `${category}.${entry.key}`),
  ) as [string, ...string[]],
);

//
// Intents
//

export const AllianceExtensionIntentSchema = z.object({
  type: z.literal("allianceExtension"),
  recipient: MappedID,
});

export const AttackIntentSchema = z.object({
  type: z.literal("attack"),
  targetID: MappedID.nullable(),
  troops: zb.float({ min: 0 }).nullable(),
});

export const SpawnIntentSchema = z.object({
  type: z.literal("spawn"),
  // A TileRef indexes the typed-array terrain buffers, so it must be a
  // non-negative integer. Fractional refs silently corrupt those lookups.
  tile: zb.uint(),
});

export const BoatAttackIntentSchema = z.object({
  type: z.literal("boat"),
  // Not an int: troops are fractional throughout the sim (attackRatio *
  // troops(), combat attrition), and the client sends the raw float.
  troops: zb.float({ min: 0 }),
  dst: zb.uint(),
});

export const AllianceRequestIntentSchema = z.object({
  type: z.literal("allianceRequest"),
  recipient: MappedID,
});

export const AllianceRejectIntentSchema = z.object({
  type: z.literal("allianceReject"),
  requestor: MappedID,
});

export const BreakAllianceIntentSchema = z.object({
  type: z.literal("breakAlliance"),
  recipient: MappedID,
});

export const TargetPlayerIntentSchema = z.object({
  type: z.literal("targetPlayer"),
  target: MappedID,
});

export const EmojiIntentSchema = z.object({
  type: z.literal("emoji"),
  recipient: zb.union([MappedID, z.literal(AllPlayers)], {
    select: (v) => (v === AllPlayers ? 1 : 0),
  }),
  emoji: EmojiSchema,
});

export const EmbargoIntentSchema = z.object({
  type: z.literal("embargo"),
  targetID: MappedID,
  action: z.union([z.literal("start"), z.literal("stop")]),
});

export const EmbargoAllIntentSchema = z.object({
  type: z.literal("embargo_all"),
  action: z.union([z.literal("start"), z.literal("stop")]),
});

export const DonateGoldIntentSchema = z.object({
  type: z.literal("donate_gold"),
  recipient: MappedID,
  gold: zb.float({ min: 0 }).nullable(),
});

export const DonateTroopIntentSchema = z.object({
  type: z.literal("donate_troops"),
  recipient: MappedID,
  troops: zb.float({ min: 0 }).nullable(),
});

export const BuildUnitIntentSchema = z.object({
  type: z.literal("build_unit"),
  unit: z.enum(UnitType),
  tile: zb.uint(),
  rocketDirectionUp: z.boolean().optional(),
  amount: zb.uint({ min: 1, max: MAX_UPGRADE_AMOUNT }).optional(),
});

export const UpgradeStructureIntentSchema = z.object({
  type: z.literal("upgrade_structure"),
  unit: z.enum(UnitType),
  unitId: zb.uint(),
  amount: zb.uint({ min: 1, max: MAX_UPGRADE_AMOUNT }).optional(),
});

export const CancelAttackIntentSchema = z.object({
  type: z.literal("cancel_attack"),
  attackID: z.string(),
});

export const CancelBoatIntentSchema = z.object({
  type: z.literal("cancel_boat"),
  unitID: zb.uint(),
});

export const MoveWarshipIntentSchema = z.object({
  type: z.literal("move_warship"),
  unitIds: z.array(zb.int()).nonempty(),
  tile: zb.uint(),
});

export const DeleteUnitIntentSchema = z.object({
  type: z.literal("delete_unit"),
  unitId: zb.uint(),
});

export const QuickChatIntentSchema = z.object({
  type: z.literal("quick_chat"),
  recipient: MappedID,
  quickChatKey: QuickChatKeySchema,
  target: MappedID.optional(),
});

// Server-internal (rejected from clients). The player being marked is the
// intent's own sender, so the target rides the stamped `clientID` that
// StampedIntentSchema adds to every intent — declaring it here too would
// write the same key twice on the binary wire.
export const MarkDisconnectedIntentSchema = z.object({
  type: z.literal("mark_disconnected"),
  isDisconnected: z.boolean(),
});

export const KickPlayerIntentSchema = z.object({
  type: z.literal("kick_player"),
  // Either a live clientID (lobby / in-game kick) OR an account publicID, for
  // callers that identify a player by account rather than per-session clientID;
  // the server resolves the publicID to the live clientID. Exactly one is set.
  targetClientID: MappedID.optional(),
  targetPublicID: MappedID.optional(),
});

export const TogglePauseIntentSchema = z.object({
  type: z.literal("toggle_pause"),
  paused: z.boolean().default(false),
});

export const UpdateGameConfigIntentSchema = z.object({
  type: z.literal("update_game_config"),
  // zb.json: too rare and too config-shaped to deserve a binary layout —
  // rides the binary wire as length-prefixed JSON.
  config: zb.json(GameConfigSchema.partial()),
});

export const ToggleGameStartTimerIntentSchema = z.object({
  type: z.literal("toggle_game_start_timer"),
});

export const IntentSchema = z.discriminatedUnion("type", [
  AttackIntentSchema,
  CancelAttackIntentSchema,
  SpawnIntentSchema,
  MarkDisconnectedIntentSchema,
  BoatAttackIntentSchema,
  CancelBoatIntentSchema,
  AllianceRequestIntentSchema,
  AllianceRejectIntentSchema,
  BreakAllianceIntentSchema,
  TargetPlayerIntentSchema,
  EmojiIntentSchema,
  DonateGoldIntentSchema,
  DonateTroopIntentSchema,
  BuildUnitIntentSchema,
  UpgradeStructureIntentSchema,
  EmbargoIntentSchema,
  EmbargoAllIntentSchema,
  MoveWarshipIntentSchema,
  QuickChatIntentSchema,
  AllianceExtensionIntentSchema,
  DeleteUnitIntentSchema,
  KickPlayerIntentSchema,
  TogglePauseIntentSchema,
  UpdateGameConfigIntentSchema,
  ToggleGameStartTimerIntentSchema,
]);

// StampedIntent = Intent with server-stamped clientID (used in turns and execution)
export const StampedIntentSchema = zb.stamped(IntentSchema, {
  clientID: MappedID,
});
export type StampedIntent = Intent & { clientID: ClientID };

// Placeholder clientID stamped onto admin-bot intents (HTTP admin API). The bot
// is not a player, but toggle_pause — the one bot intent that reaches the turn
// queue — needs a valid clientID. Chosen so it can never collide with a real id:
// generateID() omits 0/l/I/O, and this contains I and O.
export const ADMIN_BOT_CLIENT_ID: ClientID = "ADMINBOT";

//
// Server utility types
//

export const TurnSchema = z.object({
  turnNumber: zb.uint(),
  intents: StampedIntentSchema.array(),
  // The hash of the game state at the end of the turn.
  hash: zb.float().nullable().optional(),
});

export const FlagName = z
  .string()
  .max(128)
  .refine(
    (val) => {
      if (val === undefined || val === "") return true;
      return val.startsWith("flag:") || val.startsWith("country:");
    },
    {
      message: "Invalid flag: must start with country: or flag:",
    },
  );

export const FlagSchema = z.string();

export const PlayerPatternSchema = z.object({
  name: CosmeticNameSchema,
  patternData: PatternDataSchema,
  colorPalette: ColorPaletteSchema.optional(),
});

export const PlayerColorSchema = z.object({
  color: z.string(),
});

// Refs contain cosmetics names, will be replaced by the actual
// content in the server
export const PlayerCosmeticRefsSchema = z.object({
  flag: FlagName.optional(),
  color: z.string().optional(),
  patternName: CosmeticNameSchema.optional(),
  patternColorPaletteName: z.string().optional(),
  skinName: CosmeticNameSchema.optional(),
  crownName: CosmeticNameSchema.optional(),
  // One selected effect per slot: key = slot (effectType for trails, nukeType for
  // nuke explosions — see effectTypeForSlot), value = effect name.
  effects: z.record(z.string(), CosmeticNameSchema).optional(),
  // The player claims to be playing under their verified account username
  // (renders the blue check next to the name). The game server keeps the
  // claim only when the join name exactly matches the account's resolved
  // display name from /users/@me (Worker join → verifiedBadgeAllowed).
  verified: z.boolean().optional(),
});

export const PlayerSkinSchema = z.object({
  name: CosmeticNameSchema,
  url: z.string(),
});

export const PlayerCrownSchema = z.object({
  name: CosmeticNameSchema,
  url: z.string(),
});

// A resolved effect is just an identity: which effect, of which type. Its
// attributes (the visual style) are resolved from the cosmetics catalog by
// (effectType, name), so this needs no per-type variants — a new effectType
// just becomes a new EFFECT_TYPES entry, no change here.
export const PlayerEffectSchema = z.object({
  name: CosmeticNameSchema,
  effectType: EffectTypeSchema,
});

// Server converts refs to the actual cosmetics here
export const PlayerCosmeticsSchema = z.object({
  flag: FlagSchema.optional(),
  pattern: PlayerPatternSchema.optional(),
  color: PlayerColorSchema.optional(),
  skin: PlayerSkinSchema.optional(),
  crown: PlayerCrownSchema.optional(),
  // Resolved effects keyed by slot (effectType for trails, nukeType for nuke
  // explosions).
  effects: z.record(z.string(), PlayerEffectSchema).optional(),
  // Plays under the verified account username — renders the blue check.
  verified: z.boolean().optional(),
});

export const PlayerSchema = z.object({
  clientID: ID,
  username: UsernameSchema,
  clanTag: ClanTagSchema,
  cosmetics: PlayerCosmeticsSchema.optional(),
  isLobbyCreator: z.boolean().optional(),
  friends: z.array(ID).optional(),
  // Server-stamped team slot for matchmade team games (index into the
  // game's team list). Feeds deterministic team assignment, so it must be
  // identical for every client (like clanTag/friends).
  teamIndex: zb.uint().optional(),
});

// A purchased bot tribe name in use this game (active names are globally
// unique, so the name alone identifies the tribe). Loose to mirror infra's
// analytics-ingest schema — a field the API adds later flows through to the
// record without a game-side change, instead of being silently stripped.
export const TribeSchema = z
  .object({
    name: SafeString.min(1).max(64),
  })
  .loose();
export type Tribe = z.infer<typeof TribeSchema>;

export const GameStartInfoSchema = z.object({
  gameID: ID,
  lobbyCreatedAt: zb.uint(),
  visibleAt: zb.uint().optional(),
  listed: z.boolean().optional(),
  config: GameConfigSchema,
  players: PlayerSchema.array(),
  // Purchased bot tribe names in use this game (public games only). Rides
  // the analytics record to infra at game end for owner appearance stats.
  // zb.json: TribeSchema is `.loose()`, and a positional binary layout would
  // silently drop the passthrough keys that looseness exists to preserve.
  tribes: z.array(zb.json(TribeSchema)).max(100).optional(),
});

export const WinnerSchema = z
  .union([
    z.tuple([z.literal("player"), ID]).rest(ID),
    z.tuple([z.literal("team"), SafeString]).rest(ID),
    z.tuple([z.literal("nation"), SafeString]).rest(ID),
  ])
  .optional();
export type Winner = z.infer<typeof WinnerSchema>;

//
// Server
//

export const ServerTurnMessageSchema = z.object({
  type: z.literal("turn"),
  turn: TurnSchema,
});

export const ServerPingMessageSchema = z.object({
  type: z.literal("ping"),
});

export const ServerPrestartMessageSchema = z.object({
  type: z.literal("prestart"),
  gameMap: z.enum(GameMapType),
  gameMapSize: z.enum(GameMapSize),
});

export const ServerStartGameMessageSchema = z.object({
  type: z.literal("start"),
  // Turns the client missed if they are late to the game.
  turns: TurnSchema.array(),
  gameStartInfo: GameStartInfoSchema,
  lobbyCreatedAt: zb.uint(),
  // The clientID assigned to this connection by the server.
  // Absent for replays where the viewer has no player identity.
  myClientID: ID.optional(),
});

export const ServerDesyncSchema = z.object({
  type: z.literal("desync"),
  turn: zb.uint(),
  // Hashes are fractional (PlayerImpl.hash multiplies by troops), so they
  // ride as bit-exact float64 rather than a varint.
  correctHash: zb.float().nullable(),
  clientsWithCorrectHash: zb.uint(),
  totalActiveClients: zb.uint(),
  yourHash: zb.float().optional(),
});

export const ServerErrorSchema = z.object({
  type: z.literal("error"),
  error: z.string(),
  message: z.string().optional(),
});

export const ServerLobbyInfoMessageSchema = z.object({
  type: z.literal("lobby_info"),
  lobby: GameInfoSchema,
  // The clientID assigned to this connection by the server
  myClientID: ID,
});

// Broadcast by a finished private game's server to every still-connected client
// when the host starts a successor lobby, so the whole group can hop to the new
// game without re-sharing the link. gameID is the freshly minted successor.
export const ServerNewLobbyMessageSchema = z.object({
  type: z.literal("new_lobby"),
  gameID: ID,
});

export const ServerMessageSchema = zb.discriminatedUnion("type", [
  ServerTurnMessageSchema,
  ServerPrestartMessageSchema,
  ServerStartGameMessageSchema,
  ServerPingMessageSchema,
  ServerDesyncSchema,
  ServerErrorSchema,
  ServerLobbyInfoMessageSchema,
  ServerNewLobbyMessageSchema,
]);

//
// Client
//

export const ClientSendWinnerSchema = z.object({
  type: z.literal("winner"),
  winner: WinnerSchema,
  allPlayersStats: AllPlayersStatsSchema,
});

// A live snapshot of one human player at a given turn. Only deterministic sim
// values are included so in-sync clients produce an identical snapshot that can
// be agreed on by majority vote. gold is a decimal string because it is a
// bigint in the engine.
export const PlayerLiveStatsSchema = z.object({
  clientID: MappedID,
  tilesOwned: zb.uint(),
  troops: zb.float(),
  gold: z.string(),
  isAlive: z.boolean(),
  team: z.string().nullable(),
  // OFM live standings: the eliminator's clientID and the finishing place at
  // elimination, both null while the player is still alive. Deterministic sim
  // values, so clients agree on them for the majority vote.
  killedBy: MappedID.nullable(),
  deathPosition: zb.uint({ min: 1 }).nullable(),
});

// A full live snapshot of a running game at a given turn. Reported by clients
// (which run the sim) so the server can answer "what's happening" queries for
// the admin bot.
export const LiveStatsSchema = z.object({
  turn: zb.uint(),
  players: PlayerLiveStatsSchema.array(),
});

export const ClientSendLiveStatsSchema = z.object({
  type: z.literal("live_stats"),
  stats: LiveStatsSchema,
});

// A closed enum: the API drops reports with a reason it does not know, so a
// new value must land in infra (REPORT_REASONS) first.
export const ReportReasonSchema = z.enum([
  "botting",
  "teaming",
  "inappropriate_username",
  "griefing",
]);

// A player reporting another player of the same game. The server keeps them
// out of the turn log (who reported whom is staff-only) and emits them once,
// as info.reports of the archived record.
export const PlayerReportSchema = z.object({
  reportedBy: ID,
  reported: ID,
  reason: ReportReasonSchema,
});

// Note: reportedBy is NOT sent - the server stamps it from the connection.
export const ClientReportMessageSchema = z.object({
  type: z.literal("report"),
  reported: ID,
  reason: ReportReasonSchema,
});

export const ClientHashSchema = z.object({
  type: z.literal("hash"),
  hash: zb.float(),
  turnNumber: zb.uint(),
});

export const ClientLogMessageSchema = z.object({
  type: z.literal("log"),
  severity: z.enum(LogSeverity),
  log: ID,
});

export const ClientPingMessageSchema = z.object({
  type: z.literal("ping"),
});

export const ClientIntentMessageSchema = z.object({
  type: z.literal("intent"),
  intent: IntentSchema,
});

// WARNING: never send this message to clients.
// Note: clientID is NOT included - server assigns it based on persistentID from token
export const ClientJoinMessageSchema = z.object({
  type: z.literal("join"),
  token: TokenSchema, // WARNING: PII - server extracts persistentID from this
  gameID: ID,
  username: UsernameSchema,
  clanTag: ClanTagSchema,
  // Server replaces the refs with the actual cosmetic data.
  cosmetics: PlayerCosmeticRefsSchema.optional(),
  turnstileToken: z.string().nullable(),
  // Watch without playing: no spawn, no team, no lobby slot.
  spectator: z.boolean().optional(),
});

export const ClientRejoinMessageSchema = z.object({
  type: z.literal("rejoin"),
  gameID: ID,
  // Note: clientID is NOT sent - server looks it up from persistentID in token
  lastTurn: zb.uint(),
  token: TokenSchema,
});

// Switch between playing and watching from the lobby screen. Lobby-phase only:
// once the game starts the player list is frozen, so the server refuses to turn
// a spectator back into a player.
export const ClientSpectateMessageSchema = z.object({
  type: z.literal("spectate"),
  spectator: z.boolean(),
});

export const ClientMessageSchema = zb.discriminatedUnion("type", [
  ClientSendWinnerSchema,
  ClientSendLiveStatsSchema,
  ClientPingMessageSchema,
  ClientIntentMessageSchema,
  ClientJoinMessageSchema,
  ClientRejoinMessageSchema,
  ClientLogMessageSchema,
  ClientHashSchema,
  ClientSpectateMessageSchema,
  ClientReportMessageSchema,
]);

//
// Records
//

export const PlayerRecordSchema = PlayerSchema.extend({
  persistentID: PersistentIdSchema.nullable(), // WARNING: PII
  stats: PlayerStatsSchema,
});
export type PlayerRecord = z.infer<typeof PlayerRecordSchema>;

export const GameEndInfoSchema = GameStartInfoSchema.extend({
  players: PlayerRecordSchema.array(),
  start: z.number(),
  end: z.number(),
  duration: z.number().nonnegative(),
  num_turns: z.number(),
  winner: WinnerSchema,
  lobbyFillTime: z.number().nonnegative(),
  // Absent on singleplayer records and on records read back from the API,
  // which scrubs them like persistentID.
  reports: PlayerReportSchema.array().optional(),
});
export type GameEndInfo = z.infer<typeof GameEndInfoSchema>;

const GitCommitSchema = z
  .string()
  .regex(/^[0-9a-fA-F]{40}$/)
  .or(z.literal("DEV"));

export const PartialAnalyticsRecordSchema = z.object({
  info: GameEndInfoSchema,
  version: z.literal("v0.0.2"),
});
export type ClientAnalyticsRecord = z.infer<
  typeof PartialAnalyticsRecordSchema
>;

export const AnalyticsRecordSchema = PartialAnalyticsRecordSchema.extend({
  gitCommit: GitCommitSchema,
  // Absent on client-archived singleplayer records: those are stored by the
  // API worker exactly as the client sent them, and no game server (whose
  // identity these fields record) is involved.
  subdomain: z.string().optional(),
  domain: z.string().optional(),
});

export type AnalyticsRecord = z.infer<typeof AnalyticsRecordSchema>;

// Lenient variant for *reading* archived records. Older builds wrote records
// under earlier schemas (username rules tightened since, clanTag and nations
// added later, conquests became an array) while the `version` literal never
// changed, so strict parsing rejects them wholesale. Records are trusted
// server output, not untrusted input — tolerate the historical shapes.
// Inferred types are identical to the strict schemas', so parsed results are
// still AnalyticsRecord. Not for replays: those require an exact gitCommit
// match anyway (see JoinLobbyModal.checkArchivedGame).
const ArchivedPlayerRecordSchema = PlayerRecordSchema.extend({
  // Validated at join time under the rules of its era; the loosest era was
  // SafeString (max 1000, emoji allowed, no min), so only cap length.
  username: z.string().max(1000),
  clanTag: ClanTagSchema.catch(null).default(null), // predates clan tags
  stats: ArchivedPlayerStatsSchema, // scalar conquests
});

export const ArchivedAnalyticsRecordSchema = AnalyticsRecordSchema.extend({
  info: GameEndInfoSchema.extend({
    config: GameConfigSchema.extend({
      gameMap: z.preprocess(
        (value) => (typeof value === "string" ? value.trim() : value),
        GameConfigSchema.shape.gameMap,
      ),
      // predates configurable nation count
      nations: GameConfigSchema.shape.nations
        .catch("default")
        .default("default"),
    }),
    players: ArchivedPlayerRecordSchema.array(),
  }),
});

export const GameRecordSchema = AnalyticsRecordSchema.extend({
  turns: TurnSchema.array(),
});

export const PartialGameRecordSchema = PartialAnalyticsRecordSchema.extend({
  turns: TurnSchema.array(),
});

export type PartialGameRecord = z.infer<typeof PartialGameRecordSchema>;

export type GameRecord = z.infer<typeof GameRecordSchema>;
