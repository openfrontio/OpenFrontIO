import quickChatData from "resources/QuickChat.json";
import { z } from "zod";
import {
  ColorPaletteSchema,
  CosmeticNameSchema,
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
  Quads,
  RankedType,
  Trios,
  UnitType,
} from "./game/Game";
import { PlayerStatsSchema } from "./StatsSchemas";
import { flattenedEmojiTable } from "./Util";

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
  | ClientHashMessage;

export type ServerMessage =
  | ServerTurnMessage
  | ServerStartGameMessage
  | ServerPingMessage
  | ServerDesyncMessage
  | ServerPrestartMessage
  | ServerErrorMessage
  | ServerLobbyInfoMessage;

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
export type ClientSendWinnerMessage = z.infer<typeof ClientSendWinnerSchema>;
export type ClientSendLiveStatsMessage = z.infer<
  typeof ClientSendLiveStatsSchema
>;
export type PlayerLiveStats = z.infer<typeof PlayerLiveStatsSchema>;
export type LiveStats = z.infer<typeof LiveStatsSchema>;
export type ClientPingMessage = z.infer<typeof ClientPingMessageSchema>;
export type ClientIntentMessage = z.infer<typeof ClientIntentMessageSchema>;
export type ClientJoinMessage = z.infer<typeof ClientJoinMessageSchema>;
export type ClientRejoinMessage = z.infer<typeof ClientRejoinMessageSchema>;
export type ClientLogMessage = z.infer<typeof ClientLogMessageSchema>;
export type ClientHashMessage = z.infer<typeof ClientHashSchema>;

export type AllPlayersStats = z.infer<typeof AllPlayersStatsSchema>;
export type Player = z.infer<typeof PlayerSchema>;
export type PlayerCosmetics = z.infer<typeof PlayerCosmeticsSchema>;
export type PlayerCosmeticRefs = z.infer<typeof PlayerCosmeticRefsSchema>;
export type PlayerPattern = z.infer<typeof PlayerPatternSchema>;
export type PlayerColor = z.infer<typeof PlayerColorSchema>;
export type PlayerSkin = z.infer<typeof PlayerSkinSchema>;
export type GameStartInfo = z.infer<typeof GameStartInfoSchema>;
export type GameInfo = z.infer<typeof GameInfoSchema>;
export type PublicGames = z.infer<typeof PublicGamesSchema>;
export type PublicGameInfo = z.infer<typeof PublicGameInfoSchema>;
export type PublicGameType = z.infer<typeof PublicGameTypeSchema>;

export const PublicGameTypeSchema = z.enum(["ffa", "team", "special"]);

export const UsernameSchema = z
  .string()
  .regex(/^(?=.*\S)[a-zA-Z0-9_ üÜ.]+$/u)
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
});

export const GameInfoSchema = z.object({
  gameID: z.string(),
  clients: z.array(ClientInfoSchema).optional(),
  lobbyCreatorClientID: z.string().optional(),
  startsAt: z.number().optional(),
  serverTime: z.number(),
  gameConfig: z.lazy(() => GameConfigSchema).optional(),
  publicGameType: PublicGameTypeSchema.optional(),
});

export const PublicGameInfoSchema = z.object({
  gameID: z.string(),
  numClients: z.number(),
  startsAt: z.number().optional(),
  gameConfig: z.lazy(() => GameConfigSchema).optional(),
  publicGameType: PublicGameTypeSchema,
});

export const PublicGamesSchema = z.object({
  serverTime: z.number(),
  games: z.record(PublicGameTypeSchema, z.array(PublicGameInfoSchema)),
});

// Wire message sent from server to lobby WebSocket clients.
// "full" carries the complete snapshot; "counts" carries only the
// per-lobby player counts, which change far more often than the rest.
export const PublicLobbyFullSchema = z.object({
  type: z.literal("full"),
  serverTime: z.number(),
  games: z.record(PublicGameTypeSchema, z.array(PublicGameInfoSchema)),
});

export const PublicLobbyCountsSchema = z.object({
  type: z.literal("counts"),
  serverTime: z.number(),
  counts: z.record(z.string(), z.number()),
});

export const PublicLobbyMessageSchema = z.discriminatedUnion("type", [
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

const TeamCountConfigSchema = z.union([
  z.number(),
  z.literal(Duos),
  z.literal(Trios),
  z.literal(Quads),
  z.literal(HumansVsNations),
]);
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
  publicGameModifiers: z
    .object({
      isCompact: z.boolean().optional(),
      isRandomSpawn: z.boolean().optional(),
      isCrowded: z.boolean().optional(),
      isHardNations: z.boolean().optional(),
      startingGold: z.number().int().min(0).optional(),
      goldMultiplier: z.number().min(0.1).max(1000).optional(),
      isAlliancesDisabled: z.boolean().optional(),
      isPortsDisabled: z.boolean().optional(),
      isNukesDisabled: z.boolean().optional(),
      isSAMsDisabled: z.boolean().optional(),
      isPeaceTime: z.boolean().optional(),
      isWaterNukes: z.boolean().optional(),
    })
    .optional(),
  nations: z
    .number()
    .int()
    .min(1)
    .max(400)
    .or(z.enum(["default", "disabled"])),
  bots: z.number().int().min(0).max(400),
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
  maxPlayers: z.number().optional(),
  // OFM: allowlist of publicIds allowed to join (admin-only, see create_game).
  allowedPublicIds: z.array(z.string()).max(200).optional(),
  maxTimerValue: z.number().int().min(1).max(120).nullable().optional(), // In minutes
  customAllianceDuration: z.number().int().min(0).max(15).nullable().optional(), // In minutes; 0 disables alliances
  startDelay: z.number().int().min(0).max(600).nullable().optional(), // In seconds
  spawnImmunityDuration: z.number().int().min(0).nullable().optional(), // In ticks
  disabledUnits: z.enum(UnitType).array().optional(),
  playerTeams: TeamCountConfigSchema.optional(),
  goldMultiplier: z.number().min(0.1).max(1000).nullable().optional(),
  startingGold: z.number().int().min(0).max(1000000000).nullable().optional(),
  hostCheats: z
    .object({
      infiniteGold: z.boolean().optional(),
      infiniteTroops: z.boolean().optional(),
      goldMultiplier: z.number().min(0.1).max(1000).nullable().optional(),
      startingGold: z
        .number()
        .int()
        .min(0)
        .max(1000000000)
        .nullable()
        .optional(),
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

const EmojiSchema = z
  .number()
  .nonnegative()
  .max(flattenedEmojiTable.length - 1);

export const GAME_ID_REGEX = /^[A-Za-z0-9]{8}$/;

export const isValidGameID = (value: string): boolean =>
  GAME_ID_REGEX.test(value);

export const ID = z.string().regex(GAME_ID_REGEX);

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
  recipient: ID,
});

export const AttackIntentSchema = z.object({
  type: z.literal("attack"),
  targetID: ID.nullable(),
  troops: z.number().nonnegative().nullable(),
});

export const SpawnIntentSchema = z.object({
  type: z.literal("spawn"),
  tile: z.number(),
});

export const BoatAttackIntentSchema = z.object({
  type: z.literal("boat"),
  troops: z.number().nonnegative(),
  dst: z.number(),
});

export const AllianceRequestIntentSchema = z.object({
  type: z.literal("allianceRequest"),
  recipient: ID,
});

export const AllianceRejectIntentSchema = z.object({
  type: z.literal("allianceReject"),
  requestor: ID,
});

export const BreakAllianceIntentSchema = z.object({
  type: z.literal("breakAlliance"),
  recipient: ID,
});

export const TargetPlayerIntentSchema = z.object({
  type: z.literal("targetPlayer"),
  target: ID,
});

export const EmojiIntentSchema = z.object({
  type: z.literal("emoji"),
  recipient: z.union([ID, z.literal(AllPlayers)]),
  emoji: EmojiSchema,
});

export const EmbargoIntentSchema = z.object({
  type: z.literal("embargo"),
  targetID: ID,
  action: z.union([z.literal("start"), z.literal("stop")]),
});

export const EmbargoAllIntentSchema = z.object({
  type: z.literal("embargo_all"),
  action: z.union([z.literal("start"), z.literal("stop")]),
});

export const DonateGoldIntentSchema = z.object({
  type: z.literal("donate_gold"),
  recipient: ID,
  gold: z.number().nonnegative().nullable(),
});

export const DonateTroopIntentSchema = z.object({
  type: z.literal("donate_troops"),
  recipient: ID,
  troops: z.number().nonnegative().nullable(),
});

export const BuildUnitIntentSchema = z.object({
  type: z.literal("build_unit"),
  unit: z.enum(UnitType),
  tile: z.number(),
  rocketDirectionUp: z.boolean().optional(),
});

export const UpgradeStructureIntentSchema = z.object({
  type: z.literal("upgrade_structure"),
  unit: z.enum(UnitType),
  unitId: z.number(),
});

export const CancelAttackIntentSchema = z.object({
  type: z.literal("cancel_attack"),
  attackID: z.string(),
});

export const CancelBoatIntentSchema = z.object({
  type: z.literal("cancel_boat"),
  unitID: z.number(),
});

export const MoveWarshipIntentSchema = z.object({
  type: z.literal("move_warship"),
  unitIds: z.array(z.number().int()).nonempty(),
  tile: z.number(),
});

export const DeleteUnitIntentSchema = z.object({
  type: z.literal("delete_unit"),
  unitId: z.number(),
});

export const QuickChatIntentSchema = z.object({
  type: z.literal("quick_chat"),
  recipient: ID,
  quickChatKey: QuickChatKeySchema,
  target: ID.optional(),
});

export const MarkDisconnectedIntentSchema = z.object({
  type: z.literal("mark_disconnected"),
  clientID: ID,
  isDisconnected: z.boolean(),
});

export const KickPlayerIntentSchema = z.object({
  type: z.literal("kick_player"),
  // Either a live clientID (lobby / in-game kick) OR an account publicID, for
  // callers that identify a player by account rather than per-session clientID;
  // the server resolves the publicID to the live clientID. Exactly one is set.
  targetClientID: ID.optional(),
  targetPublicID: ID.optional(),
});

export const TogglePauseIntentSchema = z.object({
  type: z.literal("toggle_pause"),
  paused: z.boolean().default(false),
});

export const UpdateGameConfigIntentSchema = z.object({
  type: z.literal("update_game_config"),
  config: GameConfigSchema.partial(),
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
export const StampedIntentSchema = IntentSchema.and(z.object({ clientID: ID }));
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
  turnNumber: z.number(),
  intents: StampedIntentSchema.array(),
  // The hash of the game state at the end of the turn.
  hash: z.number().nullable().optional(),
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
});

export const PlayerSkinSchema = z.object({
  name: CosmeticNameSchema,
  url: z.string(),
});

// Server converts refs to the actual cosmetics here
export const PlayerCosmeticsSchema = z.object({
  flag: FlagSchema.optional(),
  pattern: PlayerPatternSchema.optional(),
  color: PlayerColorSchema.optional(),
  skin: PlayerSkinSchema.optional(),
});

export const PlayerSchema = z.object({
  clientID: ID,
  username: UsernameSchema,
  clanTag: ClanTagSchema,
  cosmetics: PlayerCosmeticsSchema.optional(),
  isLobbyCreator: z.boolean().optional(),
  friends: z.array(ID).optional(),
});

export const GameStartInfoSchema = z.object({
  gameID: ID,
  lobbyCreatedAt: z.number(),
  visibleAt: z.number().optional(),
  config: GameConfigSchema,
  players: PlayerSchema.array(),
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
  lobbyCreatedAt: z.number(),
  // The clientID assigned to this connection by the server.
  // Absent for replays where the viewer has no player identity.
  myClientID: ID.optional(),
});

export const ServerDesyncSchema = z.object({
  type: z.literal("desync"),
  turn: z.number(),
  correctHash: z.number().nullable(),
  clientsWithCorrectHash: z.number(),
  totalActiveClients: z.number(),
  yourHash: z.number().optional(),
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

export const ServerMessageSchema = z.discriminatedUnion("type", [
  ServerTurnMessageSchema,
  ServerPrestartMessageSchema,
  ServerStartGameMessageSchema,
  ServerPingMessageSchema,
  ServerDesyncSchema,
  ServerErrorSchema,
  ServerLobbyInfoMessageSchema,
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
  clientID: ID,
  tilesOwned: z.number().int().nonnegative(),
  troops: z.number(),
  gold: z.string(),
  isAlive: z.boolean(),
  team: z.string().nullable(),
});

// A full live snapshot of a running game at a given turn. Reported by clients
// (which run the sim) so the server can answer "what's happening" queries for
// the admin bot.
export const LiveStatsSchema = z.object({
  turn: z.number().int().nonnegative(),
  players: PlayerLiveStatsSchema.array(),
});

export const ClientSendLiveStatsSchema = z.object({
  type: z.literal("live_stats"),
  stats: LiveStatsSchema,
});

export const ClientHashSchema = z.object({
  type: z.literal("hash"),
  hash: z.number(),
  turnNumber: z.number(),
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
});

export const ClientRejoinMessageSchema = z.object({
  type: z.literal("rejoin"),
  gameID: ID,
  // Note: clientID is NOT sent - server looks it up from persistentID in token
  lastTurn: z.number(),
  token: TokenSchema,
});

export const ClientMessageSchema = z.discriminatedUnion("type", [
  ClientSendWinnerSchema,
  ClientSendLiveStatsSchema,
  ClientPingMessageSchema,
  ClientIntentMessageSchema,
  ClientJoinMessageSchema,
  ClientRejoinMessageSchema,
  ClientLogMessageSchema,
  ClientHashSchema,
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
  subdomain: z.string(),
  domain: z.string(),
});

export type AnalyticsRecord = z.infer<typeof AnalyticsRecordSchema>;

export const GameRecordSchema = AnalyticsRecordSchema.extend({
  turns: TurnSchema.array(),
});

export const PartialGameRecordSchema = PartialAnalyticsRecordSchema.extend({
  turns: TurnSchema.array(),
});

export type PartialGameRecord = z.infer<typeof PartialGameRecordSchema>;

export type GameRecord = z.infer<typeof GameRecordSchema>;
