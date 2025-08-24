// This file contians schemas for the openfront worker express server

import { z } from "zod";
import { GameConfigSchema, GameRecordSchema } from "./Schemas";

export const CreateGameInputSchema = GameConfigSchema.or(
  z
    .object({})
    .strict()
    .transform((val) => undefined),
);

export const GameInputSchema = GameConfigSchema.partial();

export const WorkerApiGameIdExistsSchema = z.object({
  exists: z.boolean(),
});
export type WorkerApiGameIdExists = z.infer<typeof WorkerApiGameIdExistsSchema>;

export const WorkerApiArchivedGameLobbySchema = z.union([
  z.object({
    error: z.literal("Game not found"),
    exists: z.literal(false),
    success: z.literal(false),
  }),
  z.object({
    details: z.object({
      actualCommit: z.string(),
      expectedCommit: z.string(),
    }),
    error: z.literal("Version mismatch"),
    exists: z.literal(true),
    success: z.literal(false),
  }),
  z.object({
    exists: z.literal(true),
    gameRecord: GameRecordSchema,
    success: z.literal(true),
  }),
]);
export type WorkerApiArchivedGameLobby = z.infer<
  typeof WorkerApiArchivedGameLobbySchema
>;
