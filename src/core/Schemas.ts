import {
  AllPlayers,
  Difficulty,
  Duos,
  GameMapType,
  GameMode,
  GameType,
  PlayerType,
  Quads,
  Trios,
  UnitType,
} from "./game/Game";
import { ID } from "./BaseSchemas";
import { PatternDecoder } from "./PatternDecoder";
import { PlayerStatsSchema } from "./StatsSchemas";
import { base64url } from "jose";
import countries from "../client/data/countries.json" with { type: "json" };
import { flattenedEmojiTable } from "./Util";
import quickChatData from "../../resources/QuickChat.json" with { type: "json" };
import { z } from "zod";

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
  | UpgradeStructureIntent
  | DeleteUnitIntent
  | KickPlayerIntent;

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
  | ServerTurnMessage
  | ServerStartGameMessage
  | ServerPingMessage
  | ServerDesyncMessage
  | ServerPrestartMessage
  | ServerErrorMessage;

export type ServerTurnMessage = z.infer<typeof ServerTurnMessageSchema>;
export type ServerStartGameMessage = z.infer<
  typeof ServerStartGameMessageSchema
>;
export type ServerPingMessage = z.infer<typeof ServerPingMessageSchema>;
export type ServerDesyncMessage = z.infer<typeof ServerDesyncSchema>;
export type ServerPrestartMessage = z.infer<typeof ServerPrestartMessageSchema>;
export type ServerErrorMessage = z.infer<typeof ServerErrorSchema>;
export type ClientSendWinnerMessage = z.infer<typeof ClientSendWinnerSchema>;
export type ClientPingMessage = z.infer<typeof ClientPingMessageSchema>;
export type ClientIntentMessage = z.infer<typeof ClientIntentMessageSchema>;
export type ClientJoinMessage = z.infer<typeof ClientJoinMessageSchema>;
export type ClientLogMessage = z.infer<typeof ClientLogMessageSchema>;
export type ClientHashMessage = z.infer<typeof ClientHashSchema>;

export type AllPlayersStats = z.infer<typeof AllPlayersStatsSchema>;
export type Player = z.infer<typeof PlayerSchema>;
export type GameStartInfo = z.infer<typeof GameStartInfoSchema>;
const PlayerTypeSchema = z.enum(PlayerType);

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
]);
export type TeamCountConfig = z.infer<typeof TeamCountConfigSchema>;

export const GameConfigSchema = z.object({
  bots: z.number().int().min(0).max(400),
  difficulty: z.enum(Difficulty),
  disableNPCs: z.boolean(),
  disabledUnits: z.enum(UnitType).array().optional(),
  donateGold: z.boolean(),
  donateTroops: z.boolean(),
  gameMap: z.enum(GameMapType),
  gameMode: z.enum(GameMode),
  gameType: z.enum(GameType),
  infiniteGold: z.boolean(),
  infiniteTroops: z.boolean(),
  instantBuild: z.boolean(),
  maxPlayers: z.number().optional(),
  playerTeams: TeamCountConfigSchema.optional(),
});

export const TeamSchema = z.string();

const SafeString = z
  .string()
  .regex(
    // eslint-disable-next-line max-len
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

export const AllPlayersStatsSchema = z.record(ID, PlayerStatsSchema);

export const UsernameSchema = SafeString;

export const ClientInfoSchema = z.object({
  clientID: ID,
  username: UsernameSchema,
});
export type ClientInfo = z.infer<typeof ClientInfoSchema>;

export const GameInfoSchema = z.object({
  clients: ClientInfoSchema.array().optional(),
  gameConfig: GameConfigSchema.optional(),
  gameID: ID,
  msUntilStart: z.number().int().nonnegative().optional(),
  numClients: z.number().int().nonnegative().optional(),
});
export type GameInfo = z.infer<typeof GameInfoSchema>;

const countryCodes = countries.filter((c) => !c.restricted).map((c) => c.code);
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
export const RequiredPatternSchema = z
  .string()
  .max(1403)
  .base64url()
  .refine(
    (val) => {
      try {
        new PatternDecoder(val, base64url.decode);
        return true;
      } catch (e) {
        if (e instanceof Error) {
          console.error(JSON.stringify(e.message, null, 2));
        } else {
          console.error(String(e));
        }
        return false;
      }
    },
    {
      message: "Invalid pattern",
    },
  );
export const PatternSchema = RequiredPatternSchema.optional();

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
  recipient: ID,
  type: z.literal("allianceExtension"),
});

export const AttackIntentSchema = BaseIntentSchema.extend({
  targetID: ID.nullable(),
  troops: z.number().nonnegative().nullable(),
  type: z.literal("attack"),
});

export const SpawnIntentSchema = BaseIntentSchema.extend({
  flag: FlagSchema,
  name: UsernameSchema,
  pattern: PatternSchema,
  playerType: PlayerTypeSchema,
  tile: z.number(),
  type: z.literal("spawn"),
});

export const BoatAttackIntentSchema = BaseIntentSchema.extend({
  dst: z.number(),
  src: z.number().nullable(),
  targetID: ID.nullable(),
  troops: z.number().nonnegative(),
  type: z.literal("boat"),
});

export const AllianceRequestIntentSchema = BaseIntentSchema.extend({
  recipient: ID,
  type: z.literal("allianceRequest"),
});

export const AllianceRequestReplyIntentSchema = BaseIntentSchema.extend({
  accept: z.boolean(),
  requestor: ID, // The one who made the original alliance request
  type: z.literal("allianceRequestReply"),
});

export const BreakAllianceIntentSchema = BaseIntentSchema.extend({
  recipient: ID,
  type: z.literal("breakAlliance"),
});

export const TargetPlayerIntentSchema = BaseIntentSchema.extend({
  target: ID,
  type: z.literal("targetPlayer"),
});

export const EmojiIntentSchema = BaseIntentSchema.extend({
  emoji: EmojiSchema,
  recipient: z.union([ID, z.literal(AllPlayers)]),
  type: z.literal("emoji"),
});

export const EmbargoIntentSchema = BaseIntentSchema.extend({
  action: z.union([z.literal("start"), z.literal("stop")]),
  targetID: ID,
  type: z.literal("embargo"),
});

export const DonateGoldIntentSchema = BaseIntentSchema.extend({
  gold: z.bigint().nullable(),
  recipient: ID,
  type: z.literal("donate_gold"),
});

export const DonateTroopIntentSchema = BaseIntentSchema.extend({
  recipient: ID,
  troops: z.number().nullable(),
  type: z.literal("donate_troops"),
});

export const BuildUnitIntentSchema = BaseIntentSchema.extend({
  tile: z.number(),
  type: z.literal("build_unit"),
  unit: z.enum(UnitType),
});

export const UpgradeStructureIntentSchema = BaseIntentSchema.extend({
  type: z.literal("upgrade_structure"),
  unit: z.enum(UnitType),
  unitId: z.number(),
});

export const CancelAttackIntentSchema = BaseIntentSchema.extend({
  attackID: z.string(),
  type: z.literal("cancel_attack"),
});

export const CancelBoatIntentSchema = BaseIntentSchema.extend({
  type: z.literal("cancel_boat"),
  unitID: z.number(),
});

export const MoveWarshipIntentSchema = BaseIntentSchema.extend({
  tile: z.number(),
  type: z.literal("move_warship"),
  unitId: z.number(),
});

export const DeleteUnitIntentSchema = BaseIntentSchema.extend({
  type: z.literal("delete_unit"),
  unitId: z.number(),
});

export const QuickChatIntentSchema = BaseIntentSchema.extend({
  quickChatKey: QuickChatKeySchema,
  recipient: ID,
  target: ID.optional(),
  type: z.literal("quick_chat"),
});

export const MarkDisconnectedIntentSchema = BaseIntentSchema.extend({
  isDisconnected: z.boolean(),
  type: z.literal("mark_disconnected"),
});

export const KickPlayerIntentSchema = BaseIntentSchema.extend({
  target: ID,
  type: z.literal("kick_player"),
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
  MoveWarshipIntentSchema,
  QuickChatIntentSchema,
  AllianceExtensionIntentSchema,
  DeleteUnitIntentSchema,
  KickPlayerIntentSchema,
]);

//
// Server utility types
//

export const TurnSchema = z.object({
  // The hash of the game state at the end of the turn.
  hash: z.number().nullable().optional(),
  intents: IntentSchema.array(),
  turnNumber: z.number(),
});

export const PlayerSchema = z.object({
  clientID: ID,
  flag: FlagSchema,
  pattern: PatternSchema,
  username: UsernameSchema,
});

export const GameStartInfoSchema = z.object({
  config: GameConfigSchema,
  gameID: ID,
  // Epoch time in milliseconds when the lobby was created.
  lobbyCreatedAt: z.number().int().nonnegative(),
  players: PlayerSchema.array(),
});

export const WinnerSchema = z
  .union([
    z.tuple([z.literal("player"), ID]).rest(ID),
    z.tuple([z.literal("team"), SafeString]).rest(ID),
  ])
  .optional();
export type Winner = z.infer<typeof WinnerSchema>;

//
// Server
//

export const ServerTurnMessageSchema = z.object({
  turn: TurnSchema,
  type: z.literal("turn"),
});

export const ServerPingMessageSchema = z.object({
  type: z.literal("ping"),
});

export const ServerPrestartMessageSchema = z.object({
  gameMap: z.nativeEnum(GameMapType),
  type: z.literal("prestart"),
});

export const ServerStartGameMessageSchema = z.object({
  gameStartInfo: GameStartInfoSchema,
  // Turns the client missed if they are late to the game.
  turns: TurnSchema.array(),
  type: z.literal("start"),
});

export const ServerDesyncSchema = z.object({
  clientsWithCorrectHash: z.number(),
  correctHash: z.number().nullable(),
  totalActiveClients: z.number(),
  turn: z.number(),
  type: z.literal("desync"),
  yourHash: z.number().optional(),
});

export const ServerErrorSchema = z.object({
  error: z.string(),
  message: z.string().optional(),
  type: z.literal("error"),
});

export const ServerMessageSchema = z.discriminatedUnion("type", [
  ServerTurnMessageSchema,
  ServerPrestartMessageSchema,
  ServerStartGameMessageSchema,
  ServerPingMessageSchema,
  ServerDesyncSchema,
  ServerErrorSchema,
]);

//
// Client
//

export const ClientSendWinnerSchema = z.object({
  allPlayersStats: AllPlayersStatsSchema,
  type: z.literal("winner"),
  winner: WinnerSchema,
});

export const ClientHashSchema = z.object({
  hash: z.number(),
  turnNumber: z.number(),
  type: z.literal("hash"),
});

export const ClientLogMessageSchema = z.object({
  log: ID,
  severity: z.enum(LogSeverity),
  type: z.literal("log"),
});

export const ClientPingMessageSchema = z.object({
  type: z.literal("ping"),
});

export const ClientIntentMessageSchema = z.object({
  intent: IntentSchema,
  type: z.literal("intent"),
});

// WARNING: never send this message to clients.
export const ClientJoinMessageSchema = z.object({
  clientID: ID,
  flag: FlagSchema,
  gameID: ID,
  lastTurn: z.number(), // The last turn the client saw.
  pattern: PatternSchema,
  token: TokenSchema, // WARNING: PII
  type: z.literal("join"),
  username: UsernameSchema,
});

export const ClientMessageSchema = z.discriminatedUnion("type", [
  ClientSendWinnerSchema,
  ClientPingMessageSchema,
  ClientIntentMessageSchema,
  ClientJoinMessageSchema,
  ClientLogMessageSchema,
  ClientHashSchema,
]);

//
// Records
//

export const PlayerRecordSchema = PlayerSchema.extend({
  persistentID: PersistentIdSchema, // WARNING: PII
  stats: PlayerStatsSchema,
});
export type PlayerRecord = z.infer<typeof PlayerRecordSchema>;

export const GameEndInfoSchema = GameStartInfoSchema.extend({
  duration: z.number().nonnegative(),
  end: z.number(),
  lobbyFillTime: z.number().nonnegative(),
  num_turns: z.number(),
  players: PlayerRecordSchema.array(),
  start: z.number(),
  winner: WinnerSchema,
});
export type GameEndInfo = z.infer<typeof GameEndInfoSchema>;

const GitCommitSchema = z.string().regex(/^[0-9a-fA-F]{40}$/);

export const AnalyticsRecordSchema = z.object({
  domain: z.string(),
  gitCommit: GitCommitSchema,
  info: GameEndInfoSchema,
  subdomain: z.string(),
  version: z.literal("v0.0.2"),
});
export type AnalyticsRecord = z.infer<typeof AnalyticsRecordSchema>;

export const GameRecordSchema = AnalyticsRecordSchema.extend({
  turns: TurnSchema.array(),
});
export type GameRecord = z.infer<typeof GameRecordSchema>;
