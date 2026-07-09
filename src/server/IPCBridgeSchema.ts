import { z } from "zod";
import {
  GameConfigSchema,
  PublicGameInfoSchema,
  PublicGameTypeSchema,
} from "../core/Schemas";

export type InternalGameInfo = z.infer<typeof InternalGameInfoSchema>;
export type InternalPublicGames = z.infer<typeof InternalPublicGamesSchema>;
export type WorkerLobbyList = z.infer<typeof WorkerLobbyListSchema>;
export type WorkerReady = z.infer<typeof WorkerReadySchema>;
export type MasterLobbiesBroadcast = z.infer<
  typeof MasterLobbiesBroadcastSchema
>;

export type MasterUpdateGame = z.infer<typeof MasterUpdateGameSchema>;
export type MasterCreateGame = z.infer<typeof MasterCreateGameSchema>;
export type WorkerMessage = z.infer<typeof WorkerMessageSchema>;
export type MasterMessage = z.infer<typeof MasterMessageSchema>;

// Master/worker-internal lobby info: PublicGameInfo plus the hashed creator
// ID (hosted lobbies only) used for the one-listed-lobby-per-creator check.
// Never sent to browsers — WorkerLobbyService.sanitizeGames converts to plain
// PublicGameInfo before anything reaches a client.
export const InternalGameInfoSchema = PublicGameInfoSchema.extend({
  creatorID: z.string().optional(),
});

export const InternalPublicGamesSchema = z.object({
  serverTime: z.number(),
  games: z.partialRecord(PublicGameTypeSchema, z.array(InternalGameInfoSchema)),
});

// --- Worker Messages ---

// Worker tells the master about its lobbies.
const WorkerLobbyListSchema = z.object({
  type: z.literal("lobbyList"),
  lobbies: z.array(InternalGameInfoSchema),
});

const WorkerReadySchema = z.object({
  type: z.literal("workerReady"),
  workerId: z.number(),
});

export const WorkerMessageSchema = z.discriminatedUnion("type", [
  WorkerLobbyListSchema,
  WorkerReadySchema,
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
});

// Master sends a message to worker to schedule a new public game/lobby.
const MasterCreateGameSchema = z.object({
  type: z.literal("createGame"),
  gameID: z.string(),
  gameConfig: GameConfigSchema,
  publicGameType: PublicGameTypeSchema,
});

export const MasterMessageSchema = z.discriminatedUnion("type", [
  MasterLobbiesBroadcastSchema,
  MasterCreateGameSchema,
  MasterUpdateGameSchema,
]);
