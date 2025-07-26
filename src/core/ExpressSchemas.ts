// This file contians schemas for the openfront express server
import { z } from "zod";

export const ApiEnvResponseSchema = z.object({
  game_env: z.string(),
});
export type ApiEnvResponse = z.infer<typeof ApiEnvResponseSchema>;
