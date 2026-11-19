import {
  Difficulty,
  GameMapType,
  GameMode,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { TeamCountConfigSchema } from "@openfront/engine-api/Schemas";
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
  teamCount: TeamCountConfigSchema,
  bots: z.number().int().min(0).max(400),
  nations: z
    .union([
      z.number().int().min(0).max(400),
      z.literal("default"),
      z.literal("disabled"),
    ])
    .optional(),
  infiniteGold: z.boolean().optional(),
  donateGold: z.boolean().optional(),
  infiniteTroops: z.boolean().optional(),
  donateTroops: z.boolean().optional(),
  instantBuild: z.boolean().optional(),
  randomSpawn: z.boolean().optional(),
  maxTimer: z.boolean().optional(),
  maxTimerValue: z.number().int().min(1).max(120).optional(),
  disabledUnits: z.enum(UnitType).array().optional(),
  goldMultiplier: z.boolean().optional(),
  goldMultiplierValue: z.number().min(0.1).max(1000).optional(),
  startingGold: z.boolean().optional(),
  startingGoldValue: z.number().min(0.1).max(1000).optional(),
  customAlliances: z.boolean().optional(),
  customAllianceMinutes: z.number().int().min(0).max(15).optional(),
  waterNukes: z.boolean().optional(),
  doomsdayClock: z.boolean().optional(),
  doomsdayClockSpeed: z.enum(DOOMSDAY_CLOCK_SPEEDS).optional(),
  overtime: z.boolean().optional(),
  overtimeStartMinutes: z.number().int().min(1).max(120).optional(),

  // Host-specific options
  spawnImmunity: z.boolean().optional(),
  spawnImmunityDurationMinutes: z.number().int().min(0).max(120).optional(),
  playerLimit: z.boolean().optional(),
  playerLimitValue: z.number().int().min(2).max(1000).optional(),
  startDelayValue: z.number().int().min(0).max(600).optional(),
  anonymizeNames: z.boolean().optional(),
  whitelistEnabled: z.boolean().optional(),
  allowedPublicIds: z.string().optional(),
  hostCheatsEnabled: z.boolean().optional(),
  hostCheatInfiniteGold: z.boolean().optional(),
  hostCheatInfiniteTroops: z.boolean().optional(),
  hostCheatGoldMultiplier: z.boolean().optional(),
  hostCheatGoldMultiplierValue: z.number().min(0.1).max(1000).optional(),
  hostCheatStartingGold: z.boolean().optional(),
  hostCheatStartingGoldValue: z.number().min(0.1).max(1000).optional(),
});

export type LobbyPresetConfig = z.infer<typeof LobbyPresetConfigSchema>;

export const LobbyPresetSchema = z.object({
  name: z.string().trim().min(1).max(MAX_PRESET_NAME_LENGTH),
  createdAt: z.number().optional(),
  config: LobbyPresetConfigSchema,
});

export type LobbyPreset = z.infer<typeof LobbyPresetSchema>;

/**
 * Safely parses raw JSON from storage into an array of validated LobbyPreset objects.
 * Returns an empty array if parsing fails, input is null/empty, or no valid presets exist.
 */
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

function matchesPresetName(entry: unknown, name: string): boolean {
  if (!entry || typeof entry !== "object") return false;
  const entryName = (entry as { name?: unknown }).name;
  return (
    typeof entryName === "string" &&
    entryName.trim().toLowerCase() === name.toLowerCase()
  );
}

/**
 * Saves or updates a named lobby preset in user settings.
 * Trims and clamps the preset name, updates an existing preset (case-insensitive) or appends a new one,
 * operating on the raw stored array so presets that fail current validation and unknown fields are preserved.
 * Returns the updated valid preset list or null if saving fails.
 */
export function saveLobbyPreset(
  name: string,
  config: LobbyPresetConfig,
  userSettings: UserSettings,
): LobbyPreset[] | null {
  const trimmed = name.trim().slice(0, MAX_PRESET_NAME_LENGTH);
  if (!trimmed) return null;

  const raw =
    typeof userSettings.getRawLobbyPresets === "function"
      ? userSettings.getRawLobbyPresets()
      : userSettings.getLobbyPresets();

  const existingIndex = raw.findIndex((entry) =>
    matchesPresetName(entry, trimmed),
  );

  const existing = existingIndex >= 0 ? raw[existingIndex] : undefined;
  const existingCreatedAt =
    existing &&
    typeof existing === "object" &&
    typeof (existing as { createdAt?: unknown }).createdAt === "number"
      ? (existing as { createdAt: number }).createdAt
      : undefined;

  const updatedPreset: LobbyPreset = {
    name: trimmed,
    createdAt: existingCreatedAt ?? Date.now(),
    config,
  };

  let newRaw: unknown[];
  if (existingIndex >= 0) {
    newRaw = [...raw];
    newRaw[existingIndex] = updatedPreset;
  } else {
    newRaw = [...raw, updatedPreset];
  }

  const success = userSettings.setLobbyPresets(newRaw);
  return success ? userSettings.getLobbyPresets() : null;
}

/**
 * Deletes a named lobby preset from user settings (case-insensitive).
 * Removes only the entry matching the given name from the raw stored array so unrecognized presets are preserved.
 * Persists the updated preset list and returns the valid presets, or returns null if the deletion could not be saved.
 */
export function deleteLobbyPreset(
  name: string,
  userSettings: UserSettings,
): LobbyPreset[] | null {
  const trimmed = name.trim();
  if (!trimmed) return null;

  const raw =
    typeof userSettings.getRawLobbyPresets === "function"
      ? userSettings.getRawLobbyPresets()
      : userSettings.getLobbyPresets();

  const newRaw = raw.filter((entry) => !matchesPresetName(entry, trimmed));
  const success = userSettings.setLobbyPresets(newRaw);
  return success ? userSettings.getLobbyPresets() : null;
}
