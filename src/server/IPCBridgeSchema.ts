import { z } from "zod";
import {
  GameConfigSchema,
  PublicGameInfoSchema,
  PublicGamesSchema,
} from "../core/Schemas";

export type WorkerLobbyList = z.infer<typeof WorkerLobbyListSchema>;
export type WorkerReady = z.infer<typeof WorkerReadySchema>;
export type MasterLobbiesBroadcast = z.infer<
  typeof MasterLobbiesBroadcastSchema
>;
export type MasterCreateGame = z.infer<typeof MasterCreateGameSchema>;
export type WorkerMessage = z.infer<typeof WorkerMessageSchema>;
export type MasterMessage = z.infer<typeof MasterMessageSchema>;

// --- Worker Messages ---

// Worker tells the master about its lobbies.
const WorkerLobbyListSchema = z.object({
  type: z.literal("lobbyList"),
  lobbies: z.array(PublicGameInfoSchema),
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

// Broadcasts all public game info to all workers.
// Workers need information on all public lobbies so
// it can send it to the client.
const MasterLobbiesBroadcastSchema = z.object({
  type: z.literal("lobbiesBroadcast"),
  publicGames: PublicGamesSchema,
});

// Master sends a message to worker to schedule a new public game/lobby.
const MasterCreateGameSchema = z.object({
  type: z.literal("createGame"),
  gameID: z.string(),
  gameConfig: GameConfigSchema,
  startsAt: z.number(),
});

export const MasterMessageSchema = z.discriminatedUnion("type", [
  MasterLobbiesBroadcastSchema,
  MasterCreateGameSchema,
]);
