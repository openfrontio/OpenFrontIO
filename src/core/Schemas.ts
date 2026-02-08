import countries from "resources/countries.json";
import quickChatData from "resources/QuickChat.json";
import { z } from "zod";
import {
  ColorPaletteSchema,
  PatternDataSchema,
  PatternNameSchema,
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
  | AllianceRequestReplyIntent
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
  | UpdateGameConfigIntent;

export type AttackIntent = z.infer<typeof AttackIntentSchema>;
export type CancelAttackIntent = z.infer<typeof CancelAttackIntentSchema>;
export type SpawnIntent = z.infer<typeof SpawnIntentSchema>;
export type BoatAttackIntent = z.infer<typeof BoatAttackIntentSchema>;
export type EmbargoAllIntent = z.infer<typeof EmbargoAllIntentSchema>;
export type CancelBoatIntent = z.infer<typeof CancelBoatIntentSchema>;
export type AllianceRequestIntent = z.infer<typeof AllianceRequestIntentSchema>;
export type AllianceRequestReplyIntent = z.infer<
  typeof AllianceRequestReplyIntentSchema
>;
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

export type Turn = z.infer<typeof TurnSchema>;
export type GameConfig = z.infer<typeof GameConfigSchema>;

export type ClientMessage =
  | ClientSendWinnerMessage
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
export type Flag = z.infer<typeof FlagSchema>;
export type GameStartInfo = z.infer<typeof GameStartInfoSchema>;
export type GameInfo = z.infer<typeof GameInfoSchema>;
export type PublicGames = z.infer<typeof PublicGamesSchema>;
export type PublicGameInfo = z.infer<typeof PublicGameInfoSchema>;

const ClientInfoSchema = z.object({
  clientID: z.string(),
  username: z.string(),
});

export const GameInfoSchema = z.object({
  gameID: z.string(),
  clients: z.array(ClientInfoSchema).optional(),
  startsAt: z.number().optional(),
  serverTime: z.number(),
  gameConfig: z.lazy(() => GameConfigSchema).optional(),
});

export const PublicGameInfoSchema = z.object({
  gameID: z.string(),
  numClients: z.number(),
  startsAt: z.number(),
  gameConfig: z.lazy(() => GameConfigSchema).optional(),
});

export const PublicGamesSchema = z.object({
  serverTime: z.number(),
  games: PublicGameInfoSchema.array(),
});

export class LobbyInfoEvent implements GameEvent {
  constructor(public lobby: GameInfo) {}
}

export interface ClientInfo {
  clientID: ClientID;
  username: string;
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

export const GameConfigSchema = z.object({
  gameMap: z.enum(GameMapType),
  difficulty: z.enum(Difficulty),
  donateGold: z.boolean(), // Configures donations to humans only
  donateTroops: z.boolean(), // Configures donations to humans only
  gameType: z.enum(GameType),
  gameMode: z.enum(GameMode),
  rankedType: z.enum(RankedType).optional(), // Only set for ranked games.
  gameMapSize: z.enum(GameMapSize),
  publicGameModifiers: z
    .object({
      isCompact: z.boolean(),
      isRandomSpawn: z.boolean(),
      isCrowded: z.boolean(),
      startingGold: z.number().int().min(0).optional(),
    })
    .optional(),
  disableNations: z.boolean(),
  bots: z.number().int().min(0).max(400),
  infiniteGold: z.boolean(),
  infiniteTroops: z.boolean(),
  instantBuild: z.boolean(),
  disableNavMesh: z.boolean().optional(),
  randomSpawn: z.boolean(),
  maxPlayers: z.number().optional(),
  maxTimerValue: z.number().int().min(1).max(120).optional(), // In minutes
  spawnImmunityDuration: z.number().int().min(0).optional(), // In ticks
  disabledUnits: z.enum(UnitType).array().optional(),
  playerTeams: TeamCountConfigSchema.optional(),
  goldMultiplier: z.number().min(0.1).max(1000).optional(),
  startingGold: z.number().int().min(0).max(1000000000).optional(),
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

export const UsernameSchema = z
  .string()
  .regex(/^[a-zA-Z0-9_ [\]üÜ.]+$/u)
  .min(3)
  .max(27);
const countryCodes = countries.filter((c) => !c.restricted).map((c) => c.code);

export const QuickChatKeySchema = z.enum(
  Object.entries(quickChatData).flatMap(([category, entries]) =>
    entries.map((entry) => `${category}.${entry.key}`),
  ) as [string, ...string[]],
);

//
// Intents
//

const BaseIntentSchema = z.object({
  clientID: ID,
});

export const AllianceExtensionIntentSchema = BaseIntentSchema.extend({
  type: z.literal("allianceExtension"),
  recipient: ID,
});

export const AttackIntentSchema = BaseIntentSchema.extend({
  type: z.literal("attack"),
  targetID: ID.nullable(),
  troops: z.number().nonnegative().nullable(),
});

export const SpawnIntentSchema = BaseIntentSchema.extend({
  type: z.literal("spawn"),
  tile: z.number(),
});

export const BoatAttackIntentSchema = BaseIntentSchema.extend({
  type: z.literal("boat"),
  troops: z.number().nonnegative(),
  dst: z.number(),
});

export const AllianceRequestIntentSchema = BaseIntentSchema.extend({
  type: z.literal("allianceRequest"),
  recipient: ID,
});

export const AllianceRequestReplyIntentSchema = BaseIntentSchema.extend({
  type: z.literal("allianceRequestReply"),
  requestor: ID, // The one who made the original alliance request
  accept: z.boolean(),
});

export const BreakAllianceIntentSchema = BaseIntentSchema.extend({
  type: z.literal("breakAlliance"),
  recipient: ID,
});

export const TargetPlayerIntentSchema = BaseIntentSchema.extend({
  type: z.literal("targetPlayer"),
  target: ID,
});

export const EmojiIntentSchema = BaseIntentSchema.extend({
  type: z.literal("emoji"),
  recipient: z.union([ID, z.literal(AllPlayers)]),
  emoji: EmojiSchema,
});

export const EmbargoIntentSchema = BaseIntentSchema.extend({
  type: z.literal("embargo"),
  targetID: ID,
  action: z.union([z.literal("start"), z.literal("stop")]),
});

export const EmbargoAllIntentSchema = BaseIntentSchema.extend({
  type: z.literal("embargo_all"),
  action: z.union([z.literal("start"), z.literal("stop")]),
});

export const DonateGoldIntentSchema = BaseIntentSchema.extend({
  type: z.literal("donate_gold"),
  recipient: ID,
  gold: z.number().nonnegative().nullable(),
});

export const DonateTroopIntentSchema = BaseIntentSchema.extend({
  type: z.literal("donate_troops"),
  recipient: ID,
  troops: z.number().nonnegative().nullable(),
});

export const BuildUnitIntentSchema = BaseIntentSchema.extend({
  type: z.literal("build_unit"),
  unit: z.enum(UnitType),
  tile: z.number(),
  rocketDirectionUp: z.boolean().optional(),
});

export const UpgradeStructureIntentSchema = BaseIntentSchema.extend({
  type: z.literal("upgrade_structure"),
  unit: z.enum(UnitType),
  unitId: z.number(),
});

export const CancelAttackIntentSchema = BaseIntentSchema.extend({
  type: z.literal("cancel_attack"),
  attackID: z.string(),
});

export const CancelBoatIntentSchema = BaseIntentSchema.extend({
  type: z.literal("cancel_boat"),
  unitID: z.number(),
});

export const MoveWarshipIntentSchema = BaseIntentSchema.extend({
  type: z.literal("move_warship"),
  unitId: z.number(),
  tile: z.number(),
});

export const DeleteUnitIntentSchema = BaseIntentSchema.extend({
  type: z.literal("delete_unit"),
  unitId: z.number(),
});

export const QuickChatIntentSchema = BaseIntentSchema.extend({
  type: z.literal("quick_chat"),
  recipient: ID,
  quickChatKey: QuickChatKeySchema,
  target: ID.optional(),
});

export const MarkDisconnectedIntentSchema = BaseIntentSchema.extend({
  type: z.literal("mark_disconnected"),
  isDisconnected: z.boolean(),
});

export const KickPlayerIntentSchema = BaseIntentSchema.extend({
  type: z.literal("kick_player"),
  target: ID,
});

export const TogglePauseIntentSchema = BaseIntentSchema.extend({
  type: z.literal("toggle_pause"),
  paused: z.boolean().default(false),
});

export const UpdateGameConfigIntentSchema = BaseIntentSchema.extend({
  type: z.literal("update_game_config"),
  config: GameConfigSchema.partial(),
});

const IntentSchema = z.discriminatedUnion("type", [
  AttackIntentSchema,
  CancelAttackIntentSchema,
  SpawnIntentSchema,
  MarkDisconnectedIntentSchema,
  BoatAttackIntentSchema,
  CancelBoatIntentSchema,
  AllianceRequestIntentSchema,
  AllianceRequestReplyIntentSchema,
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
]);

//
// Server utility types
//

export const TurnSchema = z.object({
  turnNumber: z.number(),
  intents: IntentSchema.array(),
  // The hash of the game state at the end of the turn.
  hash: z.number().nullable().optional(),
});

export const FlagSchema = z
  .string()
  .max(128)
  .optional()
  .refine(
    (val) => {
      if (val === undefined || val === "") return true;
      if (val.startsWith("!")) return true;
      return countryCodes.includes(val);
    },
    { message: "Invalid flag: must be a valid country code or start with !" },
  );

export const PlayerCosmeticRefsSchema = z.object({
  flag: FlagSchema.optional(),
  color: z.string().optional(),
  patternName: PatternNameSchema.optional(),
  patternColorPaletteName: z.string().optional(),
});

export const PlayerPatternSchema = z.object({
  name: PatternNameSchema,
  patternData: PatternDataSchema,
  colorPalette: ColorPaletteSchema.optional(),
});

export const PlayerColorSchema = z.object({
  color: z.string(),
});

export const PlayerCosmeticsSchema = z.object({
  flag: FlagSchema.optional(),
  pattern: PlayerPatternSchema.optional(),
  color: PlayerColorSchema.optional(),
});

export const PlayerSchema = z.object({
  clientID: ID,
  username: UsernameSchema,
  cosmetics: PlayerCosmeticsSchema.optional(),
  isLobbyCreator: z.boolean().optional(),
});

export const GameStartInfoSchema = z.object({
  gameID: ID,
  lobbyCreatedAt: z.number(),
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
export const ClientJoinMessageSchema = z.object({
  type: z.literal("join"),
  clientID: ID,
  token: TokenSchema, // WARNING: PII
  gameID: ID,
  username: UsernameSchema,
  // Server replaces the refs with the actual cosmetic data.
  cosmetics: PlayerCosmeticRefsSchema.optional(),
  turnstileToken: z.string().nullable(),
});

export const ClientRejoinMessageSchema = z.object({
  type: z.literal("rejoin"),
  gameID: ID,
  clientID: ID,
  lastTurn: z.number(),
  token: TokenSchema,
});

export const ClientMessageSchema = z.discriminatedUnion("type", [
  ClientSendWinnerSchema,
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
  clanTag: z.string().optional(),
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
