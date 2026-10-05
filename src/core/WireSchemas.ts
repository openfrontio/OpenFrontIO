import { z } from "zod";
import { zb } from "../../zbin";
import {
  ColorPaletteSchema,
  CosmeticNameSchema,
  EffectTypeSchema,
  PatternDataSchema,
} from "./CosmeticSchemas";
import type { GameEvent } from "./EventBus";
import { GameMapSize, GameMapType } from "./game/GameTypes";
import { ArchivedPlayerStatsSchema, PlayerStatsSchema } from "./StatsSchemas";
import { LOBBY_LABEL_MAX } from "./Util";

import {
  AllPlayersStatsSchema,
  ClanTagSchema,
  ClientID,
  GameConfigSchema,
  GameStartInfoSchema,
  ID,
  IntentSchema,
  MappedID,
  PlayerSchema,
  TurnSchema,
  UsernameSchema,
  WinnerSchema,
} from "./Schemas";

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
  | ServerNewLobbyMessage
  | ServerPongMessage
  | ServerRedirectMessage;

export type ServerTurnMessage = z.infer<typeof ServerTurnMessageSchema>;

export type ServerStartGameMessage = z.infer<
  typeof ServerStartGameMessageSchema
>;

export type ServerPingMessage = z.infer<typeof ServerPingMessageSchema>;

export type ServerPongMessage = z.infer<typeof ServerPongMessageSchema>;

export type ServerDesyncMessage = z.infer<typeof ServerDesyncSchema>;

export type ServerPrestartMessage = z.infer<typeof ServerPrestartMessageSchema>;

export type ServerErrorMessage = z.infer<typeof ServerErrorSchema>;

export type ServerLobbyInfoMessage = z.infer<
  typeof ServerLobbyInfoMessageSchema
>;

export type ServerNewLobbyMessage = z.infer<typeof ServerNewLobbyMessageSchema>;

export type ServerRedirectMessage = z.infer<typeof ServerRedirectMessageSchema>;

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

export type PlayerCosmeticRefs = z.infer<typeof PlayerCosmeticRefsSchema>;

export type PlayerCosmetics = z.infer<typeof PlayerCosmeticsSchema>;

export type PlayerPattern = z.infer<typeof PlayerPatternSchema>;

export type PlayerColor = z.infer<typeof PlayerColorSchema>;

export type PlayerSkin = z.infer<typeof PlayerSkinSchema>;

export type PlayerCrown = z.infer<typeof PlayerCrownSchema>;

export type PlayerEffect = z.infer<typeof PlayerEffectSchema>;

export type WirePlayer = z.infer<typeof WirePlayerSchema>;

export type WireGameStartInfo = z.infer<typeof WireGameStartInfoSchema>;

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

// The host picks the start time (up to HOSTED_LOBBY_AUTO_START_MS) and the
// player cap when listing; filling to the cap starts the game early.
export const MIN_HOSTED_LOBBY_AUTO_START_MS = 60 * 1000;

export const MIN_HOSTED_LOBBY_PLAYERS = 10;

export const MAX_HOSTED_LOBBY_PLAYERS = 100;

// A listed lobby this close to its auto-start can no longer be queued, so a
// host can't pay for a queue spot the lobby starts before it reaches.
export const LOBBY_QUEUE_CUTOFF_MS = 30 * 1000;

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
  // Listed lobbies only: the host paid to put it in the public Special
  // queue, so the queue's countdown starts it.
  queued: z.boolean().optional(),
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
  // Hosted lobbies only: server timestamp when the listing auto-starts, so
  // the lobby browser can show a countdown before the host presses Start.
  autoStartAt: zb.uint().optional(),
  // A player's listed lobby (hosted, or paid into a public queue) rather
  // than one the server scheduled, so the browser can label it Custom.
  // Featured lobbies are official events and never carry it.
  custom: z.boolean().optional(),
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
  // Build commit of the serving deployment. Clients on the homepage compare
  // it to their own bundle's commit to detect that a new version deployed
  // and prompt a refresh. Optional only so a server can omit it in tests; a
  // bundle built before this field cannot decode the frame at all (zbin
  // presence header shifts), which is the usual ship-together tradeoff.
  gitCommit: z.string().max(64).optional(),
  // False when the serving deployment is draining: the load balancer routes
  // elsewhere and this one has stopped queueing public lobbies, so a pinned
  // tab would watch the list empty out. Clients respond with the same reload
  // prompt as a commit mismatch — which cannot catch this case by itself,
  // because the pinned server reports its own commit and a same-commit
  // blue/green flip keeps them equal. Absent means active.
  active: z.boolean().optional(),
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

// This game's opaque grouping token arrived (see GroupToken in the server
// message schemas). One event for both carriers — lobby_info for anyone who
// sat in the lobby, the start message for a late joiner who never saw one —
// so a listener does not have to know which message it came from. Never
// emitted for singleplayer or a replay: there is no server game to group.
export class GroupTokenEvent implements GameEvent {
  constructor(public groupToken: string) {}
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
  // Intent to play under the account name. The game server keeps the check
  // only when the screened join name is the account's bare name
  // (resolveVerifiedJoin in src/server/Privilege.ts); the name is never
  // replaced and nothing sent here can mint a badge.
  verified: z.boolean().optional(),
});

export const FlagSchema = z.string();

export const PlayerPatternSchema = z.object({
  name: CosmeticNameSchema,
  patternData: PatternDataSchema,
  colorPalette: ColorPaletteSchema.optional(),
});

export const PlayerColorSchema = z.object({
  color: z.string(),
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

// A player as the server sends and records it: what the engine reads
// (PlayerSchema) plus the cosmetics only the client renders. zbin encodes
// fields in shape order, so cosmetics keeps its place after clanTag.
const { clientID, username, clanTag, ...playerRest } = PlayerSchema.shape;
export const WirePlayerSchema = z.object({
  clientID,
  username,
  clanTag,
  cosmetics: PlayerCosmeticsSchema.optional(),
  ...playerRest,
});

export const WireGameStartInfoSchema = GameStartInfoSchema.extend({
  players: WirePlayerSchema.array(),
});

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

// An opaque, server-minted, per-game token. It identifies "everyone in this
// game" to something outside the game — the desktop shell publishes it as the
// Steam player group — without handing that something the game id, which is a
// private lobby's join secret. Random, never a function of the id, and never
// accepted back: the server reads it from nowhere, so it grants nothing.
//
// Not part of WireGameStartInfoSchema on purpose. That object is archived into
// the publicly downloadable game record and emitted to telemetry; a token
// sitting next to the game id in a public record is exactly the derivation
// this exists to prevent. It rides the two server->client messages instead.
const GroupToken = z.string().min(1).max(64);

export const ServerStartGameMessageSchema = z.object({
  type: z.literal("start"),
  // Turns the client missed if they are late to the game.
  turns: TurnSchema.array(),
  gameStartInfo: WireGameStartInfoSchema,
  lobbyCreatedAt: zb.uint(),
  // The clientID assigned to this connection by the server.
  // Absent for replays where the viewer has no player identity.
  myClientID: ID.optional(),
  // The same token the lobby_info broadcasts carried, repeated here because a
  // late joiner connects after the lobby phase and never sees one. Optional
  // because singleplayer and replays synthesize this message locally with no
  // server game behind it, so they have no token and must send none.
  groupToken: GroupToken.optional(),
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
  // Build commit of the rejecting server, sent with version_mismatch so the
  // client can log which build it must update to. Rides the same flip as
  // ClientJoinMessageSchema.gitCommit: optional only so other errors can omit
  // it — a pre-field bundle cannot decode the frame (zbin presence header
  // shifts), the same ship-together tradeoff as PublicLobbyFullSchema.
  gitCommit: z.string().max(64).optional(),
});

export const ServerLobbyInfoMessageSchema = z.object({
  type: z.literal("lobby_info"),
  lobby: GameInfoSchema,
  // The clientID assigned to this connection by the server
  myClientID: ID,
  // See GroupToken below. Deliberately a sibling of `lobby` rather than a
  // field of GameInfoSchema: gameInfo() is also the body of several HTTP
  // routes (Worker's /api/game/:id, the admin-bot routes, the lobby
  // preview), and a token anyone can GET by game id is a token derived from
  // the game id. On this message it only ever reaches a connected
  // participant of this game.
  groupToken: GroupToken.optional(),
});

// Broadcast by a finished private game's server to every still-connected client
// when the host starts a successor lobby, so the whole group can hop to the new
// game without re-sharing the link. gameID is the freshly minted successor.
export const ServerNewLobbyMessageSchema = z.object({
  type: z.literal("new_lobby"),
  gameID: ID,
});

// The reply to a ClientPingMessage, echoing its sentAt.
export const ServerPongMessageSchema = z.object({
  type: z.literal("pong"),
  sentAt: zb.uint(),
});

// Sent to a joiner this lobby's pool assigns elsewhere, immediately before the
// close. A close frame's reason is a fixed enum and cannot carry an id, so the
// target needs a frame of its own; the id is all the client needs, since it
// resolves the hosting worker from the id itself.
export const ServerRedirectMessageSchema = z.object({
  type: z.literal("redirect"),
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
  ServerPongMessageSchema,
  // Appended, never inserted: variant order is the wire tag (zbin/README.md).
  ServerRedirectMessageSchema,
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

// sentAt is the client's own performance.now() (whole ms), echoed back in the
// pong so the client can time the round trip without keeping state. Only
// meaningful to the client that sent it.
export const ClientPingMessageSchema = z.object({
  type: z.literal("ping"),
  sentAt: zb.uint(),
});

export const ClientIntentMessageSchema = z.object({
  type: z.literal("intent"),
  intent: IntentSchema,
});

// Where the client was distributed, as the client reports it. Unverified, so
// fit for metric dimensions only; the signed provider="steam" claim is the
// trustworthy Steam signal. Append new members only (zbin ordinals).
export const ClientPlatformSchema = z.enum(["web", "steam", "crazygames"]);

export type ClientPlatform = z.infer<typeof ClientPlatformSchema>;

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
  // Build commit of the client bundle. The sim only stays deterministic when
  // every client in a game runs identical code, so the server rejects joins
  // whose commit doesn't match its own (missing counts as a mismatch —
  // pre-feature bundles are by definition stale).
  gitCommit: z.string().max(64).optional(),
  // Must stay the last field, and its presence bit must not spill into a new
  // header byte: then a stale bundle's frame (which lacks it) still decodes,
  // reaches the gitCommit check above, and the player is told to refresh.
  platform: ClientPlatformSchema.optional(),
});

export const ClientRejoinMessageSchema = z.object({
  type: z.literal("rejoin"),
  gameID: ID,
  // Note: clientID is NOT sent - server looks it up from persistentID in token
  lastTurn: zb.uint(),
  token: TokenSchema,
  // See ClientJoinMessageSchema.gitCommit.
  gitCommit: z.string().max(64).optional(),
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

export const PlayerRecordSchema = WirePlayerSchema.extend({
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
  // The master-scheduled lobby slot this game filled (ffa/team/special), or
  // "hosted" for a subscriber-listed lobby. Absent on private and
  // singleplayer games. Only the record carries it (not GameStartInfo, which
  // is on the wire): infra measures per-type join rates for map rotation.
  publicGameType: PublicGameTypeSchema.optional(),
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
  // The site the server registered under (ClusterCheckin.registeredSite),
  // which blue/green share. Absent under local dev and on older records.
  site: z.string().optional(),
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
