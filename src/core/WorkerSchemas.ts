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
    success: z.literal(false),
    exists: z.literal(false),
    error: z.literal("Game not found"),
  }),
  z.object({
    success: z.literal(false),
    exists: z.literal(true),
    error: z.literal("Version mismatch"),
    details: z.object({
      expectedCommit: z.string(),
      actualCommit: z.string(),
    }),
  }),
  z.object({
    success: z.literal(true),
    exists: z.literal(true),
    gameRecord: GameRecordSchema,
  }),
]);
export type WorkerApiArchivedGameLobby = z.infer<
  typeof WorkerApiArchivedGameLobbySchema
>;
