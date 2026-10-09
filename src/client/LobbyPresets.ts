import {
  Difficulty,
  GameMapType,
  GameMode,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { TeamCountConfig } from "@openfront/engine-api/Schemas";
import { DOOMSDAY_CLOCK_SPEEDS } from "@openfront/engine-lib/game/DoomsdayClock";
import { z } from "zod";
import type { UserSettings } from "./UserSettings";

export const LOBBY_PRESETS_KEY = "settings.lobbyPresets";
export const MAX_PRESET_NAME_LENGTH = 50;

export const LobbyPresetConfigSchema = z.object({
  gameMap: z.enum(GameMapType),
  useRandomMap: z.boolean().optional(),
  compactMap: z.boolean().optional(),
  difficulty: z.enum(Difficulty),
  gameMode: z.enum(GameMode),
  teamCount: z.union([z.number(), z.string()]) as z.ZodType<TeamCountConfig>,
  bots: z.number(),
  nations: z.number().optional(),
  infiniteGold: z.boolean().optional(),
  donateGold: z.boolean().optional(),
  infiniteTroops: z.boolean().optional(),
  donateTroops: z.boolean().optional(),
  instantBuild: z.boolean().optional(),
  randomSpawn: z.boolean().optional(),
  maxTimer: z.boolean().optional(),
  maxTimerValue: z.number().optional(),
  disabledUnits: z.enum(UnitType).array().optional(),
  goldMultiplier: z.boolean().optional(),
  goldMultiplierValue: z.number().optional(),
  startingGold: z.boolean().optional(),
  startingGoldValue: z.number().optional(),
  customAlliances: z.boolean().optional(),
  customAllianceMinutes: z.number().optional(),
  waterNukes: z.boolean().optional(),
  doomsdayClock: z.boolean().optional(),
  doomsdayClockSpeed: z.enum(DOOMSDAY_CLOCK_SPEEDS).optional(),
  overtime: z.boolean().optional(),
  overtimeStartMinutes: z.number().optional(),

  // Host-specific options
  spawnImmunity: z.boolean().optional(),
  spawnImmunityDurationMinutes: z.number().optional(),
  playerLimit: z.boolean().optional(),
  playerLimitValue: z.number().optional(),
  startDelayValue: z.number().optional(),
  anonymizeNames: z.boolean().optional(),
  whitelistEnabled: z.boolean().optional(),
  allowedPublicIds: z.string().optional(),
  hostCheatsEnabled: z.boolean().optional(),
  hostCheatInfiniteGold: z.boolean().optional(),
  hostCheatInfiniteTroops: z.boolean().optional(),
  hostCheatGoldMultiplier: z.boolean().optional(),
  hostCheatGoldMultiplierValue: z.number().optional(),
  hostCheatStartingGold: z.boolean().optional(),
  hostCheatStartingGoldValue: z.number().optional(),
});

export type LobbyPresetConfig = z.infer<typeof LobbyPresetConfigSchema>;

export const LobbyPresetSchema = z.object({
  name: z.string().trim().min(1).max(MAX_PRESET_NAME_LENGTH),
  createdAt: z.number().optional(),
  config: LobbyPresetConfigSchema,
});

export type LobbyPreset = z.infer<typeof LobbyPresetSchema>;

export function parseLobbyPresetsJson(rawJson: string | null): LobbyPreset[] {
  if (!rawJson) return [];
  try {
    const parsed = JSON.parse(rawJson);
    if (!Array.isArray(parsed)) return [];
    const valid: LobbyPreset[] = [];
    for (const item of parsed) {
      const result = LobbyPresetSchema.safeParse(item);
      if (result.success) {
        valid.push(result.data);
      }
    }
    return valid;
  } catch {
    return [];
  }
}

export function saveLobbyPreset(
  name: string,
  config: LobbyPresetConfig,
  userSettings: UserSettings,
): LobbyPreset[] | null {
  const trimmed = name.trim().slice(0, MAX_PRESET_NAME_LENGTH);
  if (!trimmed) return null;

  const presets = userSettings.getLobbyPresets();
  const existingIndex = presets.findIndex(
    (p) => p.name.toLowerCase() === trimmed.toLowerCase(),
  );

  const updatedPreset: LobbyPreset = {
    name: trimmed,
    createdAt:
      existingIndex >= 0 && presets[existingIndex].createdAt
        ? presets[existingIndex].createdAt
        : Date.now(),
    config,
  };

  let newPresets: LobbyPreset[];
  if (existingIndex >= 0) {
    newPresets = [...presets];
    newPresets[existingIndex] = updatedPreset;
  } else {
    newPresets = [...presets, updatedPreset];
  }

  const success = userSettings.setLobbyPresets(newPresets);
  return success ? newPresets : null;
}

export function deleteLobbyPreset(
  name: string,
  userSettings: UserSettings,
): LobbyPreset[] {
  const trimmed = name.trim();
  if (!trimmed) return userSettings.getLobbyPresets();

  const presets = userSettings.getLobbyPresets();
  const newPresets = presets.filter(
    (p) => p.name.toLowerCase() !== trimmed.toLowerCase(),
  );
  userSettings.setLobbyPresets(newPresets);
  return newPresets;
}
