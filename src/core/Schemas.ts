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
import { zb } from "./protocol/zb";
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
  | UpdateGameConfigIntent;

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
export type PublicGameType = z.infer<typeof PublicGameTypeSchema>;

export const PublicGameTypeSchema = zb.enum(["ffa", "team", "special"]);

export const UsernameSchema = zb
  .string()
  .regex(/^(?=.*\S)[a-zA-Z0-9_ üÜ.]+$/u)
  .min(3)
  .max(27);

export const ClanTagSchema = zb
  .string()
  .regex(/^[a-zA-Z0-9]{2,5}$/)
  .nullable();

const ClientInfoSchema = zb.object({
  clientID: zb.string(),
  username: UsernameSchema,
  clanTag: ClanTagSchema,
});

export const GameInfoSchema = zb.object({
  gameID: zb.string(),
  clients: zb.array(ClientInfoSchema).optional(),
  lobbyCreatorClientID: zb.string().optional(),
  startsAt: zb.number().optional(),
  serverTime: zb.number(),
  gameConfig: zb.lazy(() => GameConfigSchema).optional(),
  publicGameType: PublicGameTypeSchema.optional(),
});

export const PublicGameInfoSchema = zb.object({
  gameID: zb.string(),
  numClients: zb.number(),
  startsAt: zb.number().optional(),
  gameConfig: zb.lazy(() => GameConfigSchema).optional(),
  publicGameType: PublicGameTypeSchema,
});

export const PublicGamesSchema = zb.object({
  serverTime: zb.number(),
  games: zb.record(PublicGameTypeSchema, zb.array(PublicGameInfoSchema)),
});

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

const TeamCountConfigSchema = zb.union([
  zb.number(),
  zb.literal(Duos),
  zb.literal(Trios),
  zb.literal(Quads),
  zb.literal(HumansVsNations),
]);
export type TeamCountConfig = z.infer<typeof TeamCountConfigSchema>;

export const GameConfigSchema = zb.object({
  gameMap: zb.enum(GameMapType),
  difficulty: zb.enum(Difficulty),
  donateGold: zb.boolean(), // Configures donations to humans only
  donateTroops: zb.boolean(), // Configures donations to humans only
  gameType: zb.enum(GameType),
  gameMode: zb.enum(GameMode),
  rankedType: zb.enum(RankedType).optional(), // Only set for ranked games.
  gameMapSize: zb.enum(GameMapSize),
  publicGameModifiers: zb
    .object({
      isCompact: zb.boolean().optional(),
      isRandomSpawn: zb.boolean().optional(),
      isCrowded: zb.boolean().optional(),
      isHardNations: zb.boolean().optional(),
      startingGold: zb.number().int().min(0).optional(),
      goldMultiplier: zb.number().min(0.1).max(1000).optional(),
      isAlliancesDisabled: zb.boolean().optional(),
      isPortsDisabled: zb.boolean().optional(),
      isNukesDisabled: zb.boolean().optional(),
      isSAMsDisabled: zb.boolean().optional(),
      isPeaceTime: zb.boolean().optional(),
    })
    .optional(),
  nations: zb
    .number()
    .int()
    .min(1)
    .max(400)
    .or(zb.enum(["default", "disabled"])),
  bots: zb.number().int().min(0).max(400),
  infiniteGold: zb.boolean(),
  infiniteTroops: zb.boolean(),
  instantBuild: zb.boolean(),
  disableNavMesh: zb.boolean().optional(),
  disableAlliances: zb.boolean().optional(),
  randomSpawn: zb.boolean(),
  maxPlayers: zb.number().optional(),
  maxTimerValue: zb.number().int().min(1).max(120).optional(), // In minutes
  spawnImmunityDuration: zb.number().int().min(0).optional(), // In ticks
  disabledUnits: zb.enum(UnitType).array().optional(),
  playerTeams: TeamCountConfigSchema.optional(),
  goldMultiplier: zb.number().min(0.1).max(1000).optional(),
  startingGold: zb.number().int().min(0).max(1000000000).optional(),
});

export const TeamSchema = zb.string();

export const SafeString = zb
  .string()
  .regex(
    /^([a-zA-Z0-9\s.,!?@#$%&*()\-_+=[\]{}|;:"'/\u00a9|\u00ae|[\u2000-\u3300]|\ud83c[\ud000-\udfff]|\ud83d[\ud000-\udfff]|\ud83e[\ud000-\udfff]|[üÜ])*$/u,
  )
  .max(1000);

export const PersistentIdSchema = zb.uuid();
const JwtTokenSchema = zb.jwt();
const TokenSchema = zb
  .string()
  .refine(
    (v) =>
      PersistentIdSchema.safeParse(v).success ||
      JwtTokenSchema.safeParse(v).success,
    {
      message: "Token must be a valid UUID or JWT",
    },
  );

export const EmojiSchema = zb
  .u16()
  .max(flattenedEmojiTable.length - 1)
  .schema();

export const GAME_ID_REGEX = /^[A-Za-z0-9]{8}$/;

export const isValidGameID = (value: string): boolean =>
  GAME_ID_REGEX.test(value);

export const ID = zb.string().regex(GAME_ID_REGEX);

export const AllPlayersStatsSchema = zb.record(ID, PlayerStatsSchema);

const countryCodes = countries.filter((c) => !c.restricted).map((c) => c.code);

export const QuickChatKeySchema = zb.enum(
  Object.entries(quickChatData).flatMap(([category, entries]) =>
    entries.map((entry) => `${category}.${entry.key}`),
  ) as [string, ...string[]],
);

// Helper-bearing zb constructors such as zb.u32(), zb.f64(), and zb.playerRef()
// return builders, not Zod schemas directly. Call .schema() at the end of the
// chain to materialize the real Zod schema with its binary helper metadata.

//
// Intents
//

export const AllianceExtensionIntentSchema = zb.object({
  type: zb.literal("allianceExtension"),
  recipient: zb.playerRef().schema(),
});

export const AttackIntentSchema = zb.object({
  type: zb.literal("attack"),
  targetID: zb.playerRef().nullable().schema(),
  troops: zb.f64().nonnegative().nullable().schema(),
});

export const SpawnIntentSchema = zb.object({
  type: zb.literal("spawn"),
  tile: zb.u32().schema(),
});

export const BoatAttackIntentSchema = zb.object({
  type: zb.literal("boat"),
  troops: zb.f64().nonnegative().schema(),
  dst: zb.u32().schema(),
});

export const AllianceRequestIntentSchema = zb.object({
  type: zb.literal("allianceRequest"),
  recipient: zb.playerRef().schema(),
});

export const AllianceRejectIntentSchema = zb.object({
  type: zb.literal("allianceReject"),
  requestor: zb.playerRef().schema(),
});

export const BreakAllianceIntentSchema = zb.object({
  type: zb.literal("breakAlliance"),
  recipient: zb.playerRef().schema(),
});

export const TargetPlayerIntentSchema = zb.object({
  type: zb.literal("targetPlayer"),
  target: zb.playerRef().schema(),
});

export const EmojiIntentSchema = zb.object({
  type: zb.literal("emoji"),
  recipient: zb.broadcastPlayerRef().schema(),
  emoji: EmojiSchema,
});

export const EmbargoIntentSchema = zb.object({
  type: zb.literal("embargo"),
  targetID: zb.playerRef().schema(),
  action: zb.union([zb.literal("start"), zb.literal("stop")]),
});

export const EmbargoAllIntentSchema = zb.object({
  type: zb.literal("embargo_all"),
  action: zb.union([zb.literal("start"), zb.literal("stop")]),
});

export const DonateGoldIntentSchema = zb.object({
  type: zb.literal("donate_gold"),
  recipient: zb.playerRef().schema(),
  gold: zb.f64().nonnegative().nullable().schema(),
});

export const DonateTroopIntentSchema = zb.object({
  type: zb.literal("donate_troops"),
  recipient: zb.playerRef().schema(),
  troops: zb.f64().nonnegative().nullable().schema(),
});

export const BuildUnitIntentSchema = zb.object({
  type: zb.literal("build_unit"),
  unit: zb.enum(UnitType),
  tile: zb.u32().schema(),
  rocketDirectionUp: zb.boolean().optional(),
});

export const UpgradeStructureIntentSchema = zb.object({
  type: zb.literal("upgrade_structure"),
  unit: zb.enum(UnitType),
  unitId: zb.u32().schema(),
});

export const CancelAttackIntentSchema = zb.object({
  type: zb.literal("cancel_attack"),
  attackID: zb.string(),
});

export const CancelBoatIntentSchema = zb.object({
  type: zb.literal("cancel_boat"),
  unitID: zb.u32().schema(),
});

export const MoveWarshipIntentSchema = zb.object({
  type: zb.literal("move_warship"),
  unitId: zb.u32().schema(),
  tile: zb.u32().schema(),
});

export const DeleteUnitIntentSchema = zb.object({
  type: zb.literal("delete_unit"),
  unitId: zb.u32().schema(),
});

export const QuickChatIntentSchema = zb.object({
  type: zb.literal("quick_chat"),
  recipient: zb.playerRef().schema(),
  quickChatKey: QuickChatKeySchema,
  target: zb.playerRef().optional().schema(),
});

export const MarkDisconnectedIntentSchema = zb.object({
  type: zb.literal("mark_disconnected"),
  clientID: zb.playerRef().schema(),
  isDisconnected: zb.boolean(),
});

export const KickPlayerIntentSchema = zb.object({
  type: zb.literal("kick_player"),
  target: zb.playerRef().schema(),
});

export const TogglePauseIntentSchema = zb.object({
  type: zb.literal("toggle_pause"),
  paused: zb.boolean().default(false),
});

export const UpdateGameConfigIntentSchema = zb.jsonOnlyIntent(
  zb.object({
    type: zb.literal("update_game_config"),
    config: GameConfigSchema.partial(),
  }),
);

// Gameplay intents are binary by default when they are part of AllIntentSchema.
// jsonOnlyIntent() is the explicit opt-out for intent variants that must stay JSON.
export const AllIntentSchema = zb.discriminatedUnion("type", [
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
]);

// StampedIntent = Intent with server-stamped clientID (used in turns and execution)
export const StampedIntentSchema = AllIntentSchema.and(
  zb.object({ clientID: ID }),
);
export type StampedIntent = Intent & { clientID: ClientID };

//
// Server utility types
//

export const TurnSchema = zb.object({
  turnNumber: zb.u32().schema(),
  intents: StampedIntentSchema.array(),
  // The hash of the game state at the end of the turn.
  hash: zb.binaryOmit(zb.i32().nullable().optional().schema()),
});

export const FlagSchema = zb
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

export const PlayerCosmeticRefsSchema = zb.object({
  flag: FlagSchema.optional(),
  color: zb.string().optional(),
  patternName: PatternNameSchema.optional(),
  patternColorPaletteName: zb.string().optional(),
});

export const PlayerPatternSchema = zb.object({
  name: PatternNameSchema,
  patternData: PatternDataSchema,
  colorPalette: ColorPaletteSchema.optional(),
});

export const PlayerColorSchema = zb.object({
  color: zb.string(),
});

export const PlayerCosmeticsSchema = zb.object({
  flag: FlagSchema.optional(),
  pattern: PlayerPatternSchema.optional(),
  color: PlayerColorSchema.optional(),
});

export const PlayerSchema = zb.object({
  clientID: ID,
  username: UsernameSchema,
  clanTag: ClanTagSchema,
  cosmetics: PlayerCosmeticsSchema.optional(),
  isLobbyCreator: zb.boolean().optional(),
});

export const GameStartInfoSchema = zb.object({
  gameID: ID,
  lobbyCreatedAt: zb.number(),
  visibleAt: zb.number().optional(),
  config: GameConfigSchema,
  players: PlayerSchema.array(),
});

export const WinnerSchema = zb
  .union([
    zb.tuple([zb.literal("player"), ID]).rest(ID),
    zb.tuple([zb.literal("team"), SafeString]).rest(ID),
    zb.tuple([zb.literal("nation"), SafeString]).rest(ID),
  ])
  .optional();
export type Winner = z.infer<typeof WinnerSchema>;

//
// Server
//

export const ServerTurnMessageSchema = zb.object({
  type: zb.literal("turn"),
  turn: TurnSchema,
});

export const ServerPingMessageSchema = zb.object({
  type: zb.literal("ping"),
});

export const ServerPrestartMessageSchema = zb.object({
  type: zb.literal("prestart"),
  gameMap: zb.enum(GameMapType),
  gameMapSize: zb.enum(GameMapSize),
});

export const ServerStartGameMessageSchema = zb.object({
  type: zb.literal("start"),
  // Turns the client missed if they are late to the game.
  turns: TurnSchema.array(),
  gameStartInfo: GameStartInfoSchema,
  lobbyCreatedAt: zb.number(),
  // The clientID assigned to this connection by the server.
  // Absent for replays where the viewer has no player identity.
  myClientID: ID.optional(),
});

export const ServerDesyncSchema = zb.object({
  type: zb.literal("desync"),
  turn: zb.u32().schema(),
  correctHash: zb.i32().nullable().schema(),
  clientsWithCorrectHash: zb.u16().schema(),
  totalActiveClients: zb.u16().schema(),
  yourHash: zb.binaryOmit(zb.i32().optional().schema()),
});

export const ServerErrorSchema = zb.object({
  type: zb.literal("error"),
  error: zb.string(),
  message: zb.string().optional(),
});

export const ServerLobbyInfoMessageSchema = zb.object({
  type: zb.literal("lobby_info"),
  lobby: GameInfoSchema,
  // The clientID assigned to this connection by the server
  myClientID: ID,
});

// Only the live gameplay server-message subset participates in the binary protocol.
// Setup/control messages such as start, prestart, error, and lobby_info stay JSON.
export const BinaryServerGameplayMessageSchema = zb.discriminatedUnion("type", [
  ServerTurnMessageSchema,
  ServerDesyncSchema,
]);

// Top-level live gameplay routing stays schema-adjacent: the binary subset unions
// declare membership, and these configs declare which envelope each binary message
// uses on the wire.
export const BinaryServerGameplayMessageRouting = {
  turn: "packedTurn",
  desync: "auto",
} as const satisfies Record<string, "auto" | "intent" | "packedTurn">;

// All server messages, including the binary gameplay subset above and the JSON-only
// setup/control path, are part of the semantic protocol union.
export const ServerMessageSchema = zb.discriminatedUnion("type", [
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

export const ClientSendWinnerSchema = zb.object({
  type: zb.literal("winner"),
  winner: WinnerSchema,
  allPlayersStats: AllPlayersStatsSchema,
});

export const ClientHashSchema = zb.object({
  type: zb.literal("hash"),
  hash: zb.i32().schema(),
  turnNumber: zb.u32().schema(),
});

export const ClientLogMessageSchema = zb.object({
  type: zb.literal("log"),
  severity: zb.enum(LogSeverity),
  log: ID,
});

export const ClientPingMessageSchema = zb.object({
  type: zb.literal("ping"),
});

export const ClientIntentMessageSchema = zb.object({
  type: zb.literal("intent"),
  intent: AllIntentSchema,
});

// WARNING: never send this message to clients.
// Note: clientID is NOT included - server assigns it based on persistentID from token
export const ClientJoinMessageSchema = zb.object({
  type: zb.literal("join"),
  token: TokenSchema, // WARNING: PII - server extracts persistentID from this
  gameID: ID,
  username: UsernameSchema,
  clanTag: ClanTagSchema,
  // Server replaces the refs with the actual cosmetic data.
  cosmetics: PlayerCosmeticRefsSchema.optional(),
  turnstileToken: zb.string().nullable(),
});

export const ClientRejoinMessageSchema = zb.object({
  type: zb.literal("rejoin"),
  gameID: ID,
  // Note: clientID is NOT sent - server looks it up from persistentID in token
  lastTurn: zb.number(),
  token: TokenSchema,
});

// Only the live gameplay client-message subset participates in the binary protocol.
// Join/rejoin/winner/log stay JSON even though they share the top-level client union.
export const BinaryClientGameplayMessageSchema = zb.discriminatedUnion("type", [
  ClientPingMessageSchema,
  ClientIntentMessageSchema,
  ClientHashSchema,
]);

export const BinaryClientGameplayMessageRouting = {
  ping: "auto",
  intent: "intent",
  hash: "auto",
} as const satisfies Record<string, "auto" | "intent" | "packedTurn">;

// All client messages, including the binary gameplay subset above and the JSON-only
// setup/control path, are part of the semantic protocol union.
export const ClientMessageSchema = zb.discriminatedUnion("type", [
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
  stats: PlayerStatsSchema,
});
export type PlayerRecord = z.infer<typeof PlayerRecordSchema>;

export const GameEndInfoSchema = GameStartInfoSchema.extend({
  players: PlayerRecordSchema.array(),
  start: zb.number(),
  end: zb.number(),
  duration: zb.number().nonnegative(),
  num_turns: zb.number(),
  winner: WinnerSchema,
  lobbyFillTime: zb.number().nonnegative(),
});
export type GameEndInfo = z.infer<typeof GameEndInfoSchema>;

const GitCommitSchema = zb
  .string()
  .regex(/^[0-9a-fA-F]{40}$/)
  .or(zb.literal("DEV"));

export const PartialAnalyticsRecordSchema = zb.object({
  info: GameEndInfoSchema,
  version: zb.literal("v0.0.2"),
});
export type ClientAnalyticsRecord = z.infer<
  typeof PartialAnalyticsRecordSchema
>;

export const AnalyticsRecordSchema = PartialAnalyticsRecordSchema.extend({
  gitCommit: GitCommitSchema,
  subdomain: zb.string(),
  domain: zb.string(),
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
