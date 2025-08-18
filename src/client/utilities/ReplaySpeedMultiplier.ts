import { z } from "zod";

export const ReplaySpeedMultiplierSchema = z.enum([
  "slow",
  "normal",
  "fast",
  "fastest",
]);
export type ReplaySpeedMultiplier = z.infer<typeof ReplaySpeedMultiplierSchema>;

export const ReplaySpeedValues: Record<ReplaySpeedMultiplier, number> = {
  slow: 2,
  normal: 1,
  fast: 0.5,
  fastest: 0,
};

export const defaultReplaySpeedMultiplier = ReplaySpeedValues.normal;
