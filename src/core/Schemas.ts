import { z } from "zod";
import quickChatData from "../../resources/QuickChat.json" with { type: "json" };
import {
  AllPlayers,
  Difficulty,
  Duos,
  GameMapType,
  GameMode,
  GameType,
  PlayerType,
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
  | BreakAllianceIntent
  | TargetPlayerIntent
  | EmojiIntent
  | DonateGoldIntent
  | DonateTroopsIntent
  | TargetTroopRatioIntent
  | BuildUnitIntent
  | EmbargoIntent
  | QuickChatIntent
  | MoveWarshipIntent
  | MarkDisconnectedIntent;

export type AttackIntent = z.infer<typeof AttackIntentSchema>;
export type CancelAttackIntent = z.infer<typeof CancelAttackIntentSchema>;
export type SpawnIntent = z.infer<typeof SpawnIntentSchema>;
export type BoatAttackIntent = z.infer<typeof BoatAttackIntentSchema>;
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
export type TargetTroopRatioIntent = z.infer<
  typeof TargetTroopRatioIntentSchema
>;
export type BuildUnitIntent = z.infer<typeof BuildUnitIntentSchema>;
export type MoveWarshipIntent = z.infer<typeof MoveWarshipIntentSchema>;
export type QuickChatIntent = z.infer<typeof QuickChatIntentSchema>;
export type MarkDisconnectedIntent = z.infer<
  typeof MarkDisconnectedIntentSchema
>;

export type Turn = z.infer<typeof TurnSchema>;
export type GameConfig = z.infer<typeof GameConfigSchema>;

export type ClientMessage =
  | ClientSendWinnerMessage
  | ClientPingMessage
  | ClientIntentMessage
  | ClientJoinMessage
  | ClientLogMessage
  | ClientHashMessage;
export type ServerMessage =
  | ServerSyncMessage
  | ServerStartGameMessage
  | ServerPingMessage
  | ServerDesyncMessage
  | ServerPrestartMessage;

export type ServerSyncMessage = z.infer<typeof ServerTurnMessageSchema>;
export type ServerStartGameMessage = z.infer<
  typeof ServerStartGameMessageSchema
>;
export type ServerPingMessage = z.infer<typeof ServerPingMessageSchema>;
export type ServerDesyncMessage = z.infer<typeof ServerDesyncSchema>;
export type ServerPrestartMessage = z.infer<typeof ServerPrestartMessageSchema>;
export type ClientSendWinnerMessage = z.infer<typeof ClientSendWinnerSchema>;
export type ClientPingMessage = z.infer<typeof ClientPingMessageSchema>;
export type ClientIntentMessage = z.infer<typeof ClientIntentMessageSchema>;
export type ClientJoinMessage = z.infer<typeof ClientJoinMessageSchema>;
export type ClientLogMessage = z.infer<typeof ClientLogMessageSchema>;
export type ClientHashMessage = z.infer<typeof ClientHashSchema>;

export type AllPlayersStats = z.infer<typeof AllPlayersStatsSchema>;
export type Player = z.infer<typeof PlayerSchema>;
export type GameStartInfo = z.infer<typeof GameStartInfoSchema>;
const PlayerTypeSchema = z.nativeEnum(PlayerType);

export interface GameInfo {
  gameID: GameID;
  clients?: ClientInfo[];
  numClients?: number;
  msUntilStart?: number;
  gameConfig?: GameConfig;
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

export const GameConfigSchema = z.object({
  gameMap: z.nativeEnum(GameMapType),
  difficulty: z.nativeEnum(Difficulty),
  gameType: z.nativeEnum(GameType),
  gameMode: z.nativeEnum(GameMode),
  disableNPCs: z.boolean(),
  bots: z.number().int().min(0).max(400),
  infiniteGold: z.boolean(),
  infiniteTroops: z.boolean(),
  instantBuild: z.boolean(),
  maxPlayers: z.number().optional(),
  disabledUnits: z.array(z.nativeEnum(UnitType)).optional(),
  playerTeams: z.union([z.number().optional(), z.literal(Duos)]),
});

export const TeamSchema = z.string();

const SafeString = z
  .string()
  .regex(
    /^([a-zA-Z0-9\s.,!?@#$%&*()\-_+=\[\]{}|;:"'\/\u00a9|\u00ae|[\u2000-\u3300]|\ud83c[\ud000-\udfff]|\ud83d[\ud000-\udfff]|\ud83e[\ud000-\udfff]|üÜ])*$/,
  )
  .max(1000);

const PersistentIdSchema = z.string().uuid();
const JwtTokenSchema = z.string().jwt();
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
  .refine((value) => value <= flattenedEmojiTable.length - 1, {
    message: "Invalid emoji index",
  });

const ID = z
  .string()
  .regex(/^[a-zA-Z0-9]+$/)
  .length(8);

export const AllPlayersStatsSchema = z.record(ID, PlayerStatsSchema);

// Zod schemas
const BaseIntentSchema = z.object({
  type: z.enum([
    "attack",
    "cancel_attack",
    "spawn",
    "mark_disconnected",
    "boat",
    "cancel_boat",
    "name",
    "targetPlayer",
    "emoji",
    "troop_ratio",
    "build_unit",
    "embargo",
    "move_warship",
  ]),
  clientID: ID,
});

export const AttackIntentSchema = BaseIntentSchema.extend({
  type: z.literal("attack"),
  targetID: ID.nullable(),
  troops: z.number().nullable(),
});

export const FlagSchema = z.string().max(128).optional();
export const PatternSchema = z.string().max(128).base64().optional();

export const SpawnIntentSchema = BaseIntentSchema.extend({
  flag: FlagSchema,
  pattern: PatternSchema,
  type: z.literal("spawn"),
  name: SafeString,
  playerType: PlayerTypeSchema,
  x: z.number(),
  y: z.number(),
});

export const BoatAttackIntentSchema = BaseIntentSchema.extend({
  type: z.literal("boat"),
  targetID: ID.nullable(),
  troops: z.number(),
  dstX: z.number(),
  dstY: z.number(),
  srcX: z.number().nullable(),
  srcY: z.number().nullable(),
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

export const DonateGoldIntentSchema = BaseIntentSchema.extend({
  type: z.literal("donate_gold"),
  recipient: ID,
  gold: z.bigint().nullable(),
});

export const DonateTroopIntentSchema = BaseIntentSchema.extend({
  type: z.literal("donate_troops"),
  recipient: ID,
  troops: z.number().nullable(),
});

export const TargetTroopRatioIntentSchema = BaseIntentSchema.extend({
  type: z.literal("troop_ratio"),
  ratio: z.number().min(0).max(1),
});

export const BuildUnitIntentSchema = BaseIntentSchema.extend({
  type: z.literal("build_unit"),
  unit: z.nativeEnum(UnitType),
  x: z.number(),
  y: z.number(),
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

export const QuickChatKeySchema = z.enum(
  Object.entries(quickChatData).flatMap(([category, entries]) =>
    entries.map((entry) => `${category}.${entry.key}`),
  ) as [string, ...string[]],
);

export const QuickChatIntentSchema = BaseIntentSchema.extend({
  type: z.literal("quick_chat"),
  recipient: ID,
  quickChatKey: QuickChatKeySchema,
  variables: z.record(SafeString).optional(),
});

export const MarkDisconnectedIntentSchema = BaseIntentSchema.extend({
  type: z.literal("mark_disconnected"),
  isDisconnected: z.boolean(),
});

const IntentSchema = z.union([
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
  TargetTroopRatioIntentSchema,
  BuildUnitIntentSchema,
  EmbargoIntentSchema,
  MoveWarshipIntentSchema,
  QuickChatIntentSchema,
]);

export const TurnSchema = z.object({
  turnNumber: z.number(),
  intents: z.array(IntentSchema),
  // The hash of the game state at the end of the turn.
  hash: z.number().nullable().optional(),
});

// Server

const ServerBaseMessageSchema = z.object({
  type: z.enum(["turn", "ping", "prestart", "start", "desync"]),
});

export const ServerTurnMessageSchema = ServerBaseMessageSchema.extend({
  type: z.literal("turn"),
  turn: TurnSchema,
});

export const ServerPingMessageSchema = ServerBaseMessageSchema.extend({
  type: z.literal("ping"),
});

export const ServerPrestartMessageSchema = ServerBaseMessageSchema.extend({
  type: z.literal("prestart"),
  gameMap: z.nativeEnum(GameMapType),
});

export const PlayerSchema = z.object({
  clientID: ID,
  username: SafeString,
  flag: FlagSchema,
  pattern: PatternSchema,
});

export const GameStartInfoSchema = z.object({
  gameID: ID,
  config: GameConfigSchema,
  players: z.array(PlayerSchema),
});

export const ServerStartGameMessageSchema = ServerBaseMessageSchema.extend({
  type: z.literal("start"),
  // Turns the client missed if they are late to the game.
  turns: z.array(TurnSchema),
  gameStartInfo: GameStartInfoSchema,
});

export const ServerDesyncSchema = ServerBaseMessageSchema.extend({
  type: z.literal("desync"),
  turn: z.number(),
  correctHash: z.number().nullable(),
  clientsWithCorrectHash: z.number(),
  totalActiveClients: z.number(),
  yourHash: z.number().optional(),
});

export const ServerMessageSchema = z.union([
  ServerTurnMessageSchema,
  ServerPrestartMessageSchema,
  ServerStartGameMessageSchema,
  ServerPingMessageSchema,
  ServerDesyncSchema,
]);

// Client

export const WinnerSchema = z
  .union([
    z.tuple([z.literal("player"), ID]),
    z.tuple([z.literal("team"), SafeString]),
  ])
  .optional();
export type Winner = z.infer<typeof WinnerSchema>;

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
  severity: z.nativeEnum(LogSeverity),
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
  lastTurn: z.number(), // The last turn the client saw.
  username: SafeString,
  flag: FlagSchema,
  pattern: PatternSchema,
});

export const ClientMessageSchema = z.union([
  ClientSendWinnerSchema,
  ClientPingMessageSchema,
  ClientIntentMessageSchema,
  ClientJoinMessageSchema,
  ClientLogMessageSchema,
  ClientHashSchema,
]);

export const PlayerRecordSchema = PlayerSchema.extend({
  persistentID: PersistentIdSchema, // WARNING: PII
  stats: PlayerStatsSchema,
});
export type PlayerRecord = z.infer<typeof PlayerRecordSchema>;

export const GameEndInfoSchema = GameStartInfoSchema.extend({
  players: z.array(PlayerRecordSchema),
  start: z.number(),
  end: z.number(),
  duration: z.number().nonnegative(),
  num_turns: z.number(),
  winner: WinnerSchema,
});
export type GameEndInfo = z.infer<typeof GameEndInfoSchema>;

const GitCommitSchema = z.string().regex(/^[0-9a-fA-F]{40}$/);

export const AnalyticsRecordSchema = z.object({
  info: GameEndInfoSchema,
  version: z.literal("v0.0.2"),
  gitCommit: GitCommitSchema,
});
export type AnalyticsRecord = z.infer<typeof AnalyticsRecordSchema>;

export const GameRecordSchema = AnalyticsRecordSchema.extend({
  turns: z.array(TurnSchema),
});
export type GameRecord = z.infer<typeof GameRecordSchema>;

export const CosmeticsSchema = z.object({
  role_group: z.record(z.string(), z.string().array()).optional(),
  pattern: z.record(
    z.string(),
    z.object({
      pattern: z.string().base64(),
      role_group: z.string().array().optional(),
    }),
  ),
});

export type Cosmetic = z.infer<typeof CosmeticsSchema>;
