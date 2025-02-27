import { z } from "zod";
import {
  AllPlayers,
  Difficulty,
  GameMapType,
  GameType,
  PlayerType,
  UnitType,
} from "./game/Game";

export type GameID = string;
export type ClientID = string;

export type Intent =
  | SpawnIntent
  | AttackIntent
  | BoatAttackIntent
  | AllianceRequestIntent
  | AllianceRequestReplyIntent
  | BreakAllianceIntent
  | TargetPlayerIntent
  | EmojiIntent
  | ChatIntent
  | DonateIntent
  | TargetTroopRatioIntent
  | BuildUnitIntent;

export type AttackIntent = z.infer<typeof AttackIntentSchema>;
export type SpawnIntent = z.infer<typeof SpawnIntentSchema>;
export type BoatAttackIntent = z.infer<typeof BoatAttackIntentSchema>;
export type AllianceRequestIntent = z.infer<typeof AllianceRequestIntentSchema>;
export type AllianceRequestReplyIntent = z.infer<
  typeof AllianceRequestReplyIntentSchema
>;
export type BreakAllianceIntent = z.infer<typeof BreakAllianceIntentSchema>;
export type TargetPlayerIntent = z.infer<typeof TargetPlayerIntentSchema>;
export type EmojiIntent = z.infer<typeof EmojiIntentSchema>;
export type ChatIntent = z.infer<typeof ChatIntentSchema>;
export type DonateIntent = z.infer<typeof DonateIntentSchema>;
export type TargetTroopRatioIntent = z.infer<
  typeof TargetTroopRatioIntentSchema
>;
export type BuildUnitIntent = z.infer<typeof BuildUnitIntentSchema>;

export type Turn = z.infer<typeof TurnSchema>;
export type GameConfig = z.infer<typeof GameConfigSchema>;

export type ClientMessage =
  | ClientSendWinnerMessage
  | ClientPingMessage
  | ClientIntentMessage
  | ClientJoinMessage
  | ClientLogMessage;
export type ServerMessage =
  | ServerSyncMessage
  | ServerStartGameMessage
  | ServerPingMessage;

export type ServerSyncMessage = z.infer<typeof ServerTurnMessageSchema>;
export type ServerStartGameMessage = z.infer<
  typeof ServerStartGameMessageSchema
>;
export type ServerPingMessage = z.infer<typeof ServerPingMessageSchema>;

export type ClientSendWinnerMessage = z.infer<typeof ClientSendWinnerSchema>;
export type ClientPingMessage = z.infer<typeof ClientPingMessageSchema>;
export type ClientIntentMessage = z.infer<typeof ClientIntentMessageSchema>;
export type ClientJoinMessage = z.infer<typeof ClientJoinMessageSchema>;
export type ClientLogMessage = z.infer<typeof ClientLogMessageSchema>;

export type PlayerRecord = z.infer<typeof PlayerRecordSchema>;
export type GameRecord = z.infer<typeof GameRecordSchema>;

const PlayerTypeSchema = z.nativeEnum(PlayerType);

export enum LogSeverity {
  Debug = "DEBUG",
  Info = "INFO",
  Warn = "WARN",
  Error = "ERROR",
  Fatal = "FATAL",
}

// TODO: create Cell schema

export interface Lobby {
  id: string;
  msUntilStart?: number;
  numClients?: number;
  gameConfig?: GameConfig;
}

const GameConfigSchema = z.object({
  gameMap: z.nativeEnum(GameMapType),
  difficulty: z.nativeEnum(Difficulty),
  gameType: z.nativeEnum(GameType),
  disableNPCs: z.boolean(),
  bots: z.number().int().min(0).max(400),
  infiniteGold: z.boolean(),
  infiniteTroops: z.boolean(),
  instantBuild: z.boolean(),
});

const SafeString = z
  .string()
  // Remove common dangerous characters and patterns
  // The weird \u stuff is to allow emojis
  .regex(
    /^[a-zA-Z0-9\s.,!?@#$%&*()-_+=\[\]{}|;:"'\/\u00a9|\u00ae|[\u2000-\u3300]|\ud83c[\ud000-\udfff]|\ud83d[\ud000-\udfff]|\ud83e[\ud000-\udfff]|üÜ]+$/,
  )
  // Reasonable max length to prevent DOS
  .max(1000);

const EmojiSchema = z.string().refine(
  (val) => {
    return /\p{Emoji}/u.test(val);
  },
  {
    message: "Must contain at least one emoji character",
  },
);

const ChatSchema = z.string().refine(
    (val) => {
        return val.length > 0;
        // Can add a regex test here.
    },
    {
        message: "Must contain at least one character"
    }
);

const ID = z
  .string()
  .regex(/^[a-zA-Z0-9]+$/)
  .length(8);

// Zod schemas
const BaseIntentSchema = z.object({
  type: z.enum([
    "attack",
    "spawn",
    "boat",
    "name",
    "targetPlayer",
    "emoji",
    "chat",
    "troop_ratio",
    "build_unit",
  ]),
  clientID: ID,
  playerID: ID,
});

export const AttackIntentSchema = BaseIntentSchema.extend({
  type: z.literal("attack"),
  playerID: ID,
  targetID: ID.nullable(),
  troops: z.number().nullable(),
});

export const SpawnIntentSchema = BaseIntentSchema.extend({
  flag: z.string().nullable(),
  type: z.literal("spawn"),
  playerID: ID,
  name: SafeString,
  playerType: PlayerTypeSchema,
  x: z.number(),
  y: z.number(),
});

export const BoatAttackIntentSchema = BaseIntentSchema.extend({
  type: z.literal("boat"),
  playerID: ID,
  targetID: ID.nullable(),
  troops: z.number().nullable(),
  x: z.number(),
  y: z.number(),
});

export const AllianceRequestIntentSchema = BaseIntentSchema.extend({
  type: z.literal("allianceRequest"),
  playerID: ID,
  recipient: ID,
});

export const AllianceRequestReplyIntentSchema = BaseIntentSchema.extend({
  type: z.literal("allianceRequestReply"),
  requestor: ID, // The one who made the original alliance request
  playerID: ID,
  accept: z.boolean(),
});

export const BreakAllianceIntentSchema = BaseIntentSchema.extend({
  type: z.literal("breakAlliance"),
  playerID: ID,
  recipient: ID,
});

export const TargetPlayerIntentSchema = BaseIntentSchema.extend({
  type: z.literal("targetPlayer"),
  playerID: ID,
  target: ID,
});

export const EmojiIntentSchema = BaseIntentSchema.extend({
  type: z.literal("emoji"),
  playerID: ID,
  recipient: z.union([ID, z.literal(AllPlayers)]),
  emoji: EmojiSchema,
});

export const ChatIntentSchema = BaseIntentSchema.extend({
    type: z.literal('chat'),
    sender: z.string(),
    recipient: z.string(),
    chat: ChatSchema,
})

export const DonateIntentSchema = BaseIntentSchema.extend({
  type: z.literal("donate"),
  playerID: ID,
  recipient: ID,
  troops: z.number().nullable(),
});

export const TargetTroopRatioIntentSchema = BaseIntentSchema.extend({
  type: z.literal("troop_ratio"),
  playerID: ID,
  ratio: z.number().min(0).max(1),
});

export const BuildUnitIntentSchema = BaseIntentSchema.extend({
  type: z.literal("build_unit"),
  playerID: ID,
  unit: z.nativeEnum(UnitType),
  x: z.number(),
  y: z.number(),
});

const IntentSchema = z.union([
  AttackIntentSchema,
  SpawnIntentSchema,
  BoatAttackIntentSchema,
  AllianceRequestIntentSchema,
  AllianceRequestReplyIntentSchema,
  BreakAllianceIntentSchema,
  TargetPlayerIntentSchema,
  EmojiIntentSchema,
  ChatIntentSchema,
  DonateIntentSchema,
  TargetTroopRatioIntentSchema,
  BuildUnitIntentSchema,
]);

export const TurnSchema = z.object({
  turnNumber: z.number(),
  gameID: ID,
  intents: z.array(IntentSchema),
});

// Server

const ServerBaseMessageSchema = z.object({
  type: SafeString,
});

export const ServerTurnMessageSchema = ServerBaseMessageSchema.extend({
  type: z.literal("turn"),
  turn: TurnSchema,
});

export const ServerPingMessageSchema = ServerBaseMessageSchema.extend({
  type: z.literal("ping"),
});

export const ServerStartGameMessageSchema = ServerBaseMessageSchema.extend({
  type: z.literal("start"),
  // Turns the client missed if they are late to the game.
  turns: z.array(TurnSchema),
  config: GameConfigSchema,
});

export const ServerMessageSchema = z.union([
  ServerTurnMessageSchema,
  ServerStartGameMessageSchema,
  ServerPingMessageSchema,
]);

// Client

const ClientBaseMessageSchema = z.object({
  type: z.enum(["winner", "join", "intent", "ping", "log"]),
  clientID: ID,
  persistentID: SafeString.nullable(), // WARNING: persistent id is private.
  gameID: ID,
});

export const ClientSendWinnerSchema = ClientBaseMessageSchema.extend({
  type: z.literal("winner"),
  winner: ID.nullable(),
});

export const ClientLogMessageSchema = ClientBaseMessageSchema.extend({
  type: z.literal("log"),
  severity: z.nativeEnum(LogSeverity),
  log: ID,
  persistentID: SafeString,
});

export const ClientPingMessageSchema = ClientBaseMessageSchema.extend({
  type: z.literal("ping"),
});

export const ClientIntentMessageSchema = ClientBaseMessageSchema.extend({
  type: z.literal("intent"),
  intent: IntentSchema,
});

// WARNING: never send this message to clients.
export const ClientJoinMessageSchema = ClientBaseMessageSchema.extend({
  type: z.literal("join"),
  lastTurn: z.number(), // The last turn the client saw.
  username: SafeString,
});

export const ClientMessageSchema = z.union([
  ClientSendWinnerSchema,
  ClientPingMessageSchema,
  ClientIntentMessageSchema,
  ClientJoinMessageSchema,
  ClientLogMessageSchema,
]);

export const PlayerRecordSchema = z.object({
  clientID: ID,
  username: SafeString,
  ip: SafeString.nullable(), // WARNING: PII
  persistentID: SafeString, // WARNING: PII
});

export const GameRecordSchema = z.object({
  id: ID,
  gameConfig: GameConfigSchema,
  players: z.array(PlayerRecordSchema),
  startTimestampMS: z.number(),
  endTimestampMS: z.number(),
  durationSeconds: z.number(),
  date: SafeString,
  num_turns: z.number(),
  turns: z.array(TurnSchema),
  winner: ID.nullable(),
});
