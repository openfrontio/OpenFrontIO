import { GameConfigSchema } from "@openfront/engine-api/Schemas";
import { LobbyInviteSchema } from "@openfront/shared/LobbyInviteSchemas";
import {
  PublicGameInfoSchema,
  PublicGameTypeSchema,
} from "@openfront/shared/WireSchemas";
import { z } from "zod";

export type InternalGameInfo = z.infer<typeof InternalGameInfoSchema>;
export type InternalPublicGames = z.infer<typeof InternalPublicGamesSchema>;
export type WorkerLobbyList = z.infer<typeof WorkerLobbyListSchema>;
export type WorkerReady = z.infer<typeof WorkerReadySchema>;
export type MasterLobbiesBroadcast = z.infer<
  typeof MasterLobbiesBroadcastSchema
>;

export type MasterUpdateGame = z.infer<typeof MasterUpdateGameSchema>;
export type MasterCreateGame = z.infer<typeof MasterCreateGameSchema>;
export type WorkerLobbyInvite = z.infer<typeof WorkerLobbyInviteSchema>;
export type WorkerLobbyInviteDismiss = z.infer<
  typeof WorkerLobbyInviteDismissSchema
>;
export type MasterLobbyInviteBroadcast = z.infer<
  typeof MasterLobbyInviteBroadcastSchema
>;
export type MasterLobbyInviteDismissBroadcast = z.infer<
  typeof MasterLobbyInviteDismissBroadcastSchema
>;
export type OpenLobbyMeta = z.infer<typeof OpenLobbyMetaSchema>;
export type WorkerMessage = z.infer<typeof WorkerMessageSchema>;
export type MasterMessage = z.infer<typeof MasterMessageSchema>;

export const OpenLobbyMetaSchema = z.object({
  gameMode: z.string().optional(),
  map: z.string().optional(),
  allowedPublicIds: z.array(z.string()).optional(),
});

// Master/worker-internal lobby info: PublicGameInfo plus the hashed creator
// ID (hosted lobbies only) used for the one-listed-lobby-per-creator check,
// and the lobby's creation time (used for queue order).
// Never sent to browsers — WorkerLobbyService.sanitizeGames converts to plain
// PublicGameInfo before anything reaches a client.
export const InternalGameInfoSchema = PublicGameInfoSchema.extend({
  creatorID: z.string().optional(),
  // When the worker created the lobby. The master orders the queue behind the
  // counting-down lobby by this, so lobbies advance one place as the front one
  // starts instead of shuffling when a new one spawns.
  createdAt: z.number().optional(),
  // Paid-queued hosted lobbies only: when the host paid. The master puts
  // these right behind the counting-down lobby, oldest payment first.
  queuedAt: z.number().optional(),
});

const InternalPublicGamesSchema = z.object({
  serverTime: z.number(),
  games: z.partialRecord(PublicGameTypeSchema, z.array(InternalGameInfoSchema)),
});

// --- Worker Messages ---

// Worker tells the master about its lobbies. Entries are deliberately not
// validated here: the master checks each against InternalGameInfoSchema and
// drops bad ones (MasterLobbyService.validLobbies), so a single malformed
// lobby can't invalidate the whole report and freeze the master's view of
// this worker's lobbies.
const WorkerLobbyListSchema = z.object({
  type: z.literal("lobbyList"),
  lobbies: z.array(z.unknown()),
  // Games this worker is running, lobbies included. The master sums them
  // for the cluster check-in (ClusterCheckin.ts), so an operator can tell
  // when a draining server is empty. Optional for a worker build that
  // predates it; absent counts as zero.
  liveGames: z.number().int().min(0).optional(),
  // Map of open lobby gameID (public or private) to connected member IDs
  // (publicId and persistentID) on this worker.
  openLobbies: z.record(z.string(), z.array(z.string())).optional(),
  openLobbyMeta: z.record(z.string(), OpenLobbyMetaSchema).optional(),
});

const WorkerReadySchema = z.object({
  type: z.literal("workerReady"),
  workerId: z.number(),
});

const WorkerLobbyInviteSchema = z.object({
  type: z.literal("lobbyInvite"),
  invite: LobbyInviteSchema,
});

const WorkerLobbyInviteDismissSchema = z.object({
  type: z.literal("lobbyInviteDismiss"),
  inviteId: z.string(),
  dismissedAt: z.number().optional(),
  targetPublicId: z.string().optional(),
});

export const WorkerMessageSchema = z.discriminatedUnion("type", [
  WorkerLobbyListSchema,
  WorkerReadySchema,
  WorkerLobbyInviteSchema,
  WorkerLobbyInviteDismissSchema,
]);

// --- Master Messages ---

const MasterUpdateGameSchema = z.object({
  type: z.literal("updateLobby"),
  gameID: z.string(),
  startsAt: z.number(),
});

// Broadcasts all public game info to all workers.
// Workers need information on all public lobbies so
// it can send it to the client.
const MasterLobbiesBroadcastSchema = z.object({
  type: z.literal("lobbiesBroadcast"),
  publicGames: InternalPublicGamesSchema,
  // Hosted lobbies the master wants delisted: a creator got two lobbies
  // listed concurrently on different workers, and only the dedup winner may
  // stay advertised. The owning worker clears the loser's listed flag so
  // worker state, host UI, and the broadcast agree.
  delistGameIDs: z.array(z.string()).optional(),
  // Whether this deployment is the one the load balancer routes to. Workers
  // stamp it onto the public-lobby feed so pinned homepage tabs on a draining
  // deployment learn to reload (see PublicLobbyFullSchema.active). Optional
  // only for old fixtures; the master always sends it, absent means active.
  active: z.boolean().optional(),
  // Aggregated map of open lobby gameID -> member IDs across all workers.
  openLobbies: z.record(z.string(), z.array(z.string())).optional(),
  openLobbyMeta: z.record(z.string(), OpenLobbyMetaSchema).optional(),
});

// Master sends a message to worker to schedule a new public game/lobby.
const MasterCreateGameSchema = z.object({
  type: z.literal("createGame"),
  gameID: z.string(),
  gameConfig: GameConfigSchema,
  publicGameType: PublicGameTypeSchema,
});

const MasterLobbyInviteBroadcastSchema = z.object({
  type: z.literal("lobbyInviteBroadcast"),
  invite: LobbyInviteSchema,
});

const MasterLobbyInviteDismissBroadcastSchema = z.object({
  type: z.literal("lobbyInviteDismissBroadcast"),
  inviteId: z.string(),
  dismissedAt: z.number().optional(),
});

export const MasterMessageSchema = z.discriminatedUnion("type", [
  MasterLobbiesBroadcastSchema,
  MasterCreateGameSchema,
  MasterUpdateGameSchema,
  MasterLobbyInviteBroadcastSchema,
  MasterLobbyInviteDismissBroadcastSchema,
]);
