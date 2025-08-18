import { z } from "zod";
import { translateText } from "../Utils";

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

export const ReplaySpeedLabels: Record<ReplaySpeedMultiplier, string> = {
  slow: "×0.5",
  normal: "×1",
  fast: "×2",
  fastest: translateText("replay_panel.fastest_game_speed"),
};

export const defaultReplaySpeedMultiplier = ReplaySpeedValues.normal;
