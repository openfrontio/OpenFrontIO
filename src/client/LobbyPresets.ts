import { z } from "zod";
import { GameConfig, GameConfigSchema } from "../core/Schemas";
import { generateCryptoRandomUUID } from "./Utils";

const LOBBY_PRESET_STORAGE_KEY = "lobbyPresets.v1";

export const LobbyPresetSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(40),
  createdAt: z.number(),
  updatedAt: z.number(),
  config: GameConfigSchema.partial(),
});
export type LobbyPreset = z.infer<typeof LobbyPresetSchema>;

export const LobbyPresetStoreSchema = z.object({
  version: z.literal(1),
  presets: LobbyPresetSchema.array(),
  lastUsedPresetId: z.string().optional(),
  autoApplyLastUsed: z.boolean().optional(),
});
export type LobbyPresetStore = z.infer<typeof LobbyPresetStoreSchema>;

function emptyLobbyPresetStore(): LobbyPresetStore {
  return {
    version: 1,
    presets: [],
  };
}

export function loadLobbyPresetStore(): LobbyPresetStore {
  if (typeof localStorage === "undefined") {
    return emptyLobbyPresetStore();
  }

  const raw = localStorage.getItem(LOBBY_PRESET_STORAGE_KEY);
  if (!raw) {
    return emptyLobbyPresetStore();
  }

  try {
    const parsed = JSON.parse(raw);
    const result = LobbyPresetStoreSchema.safeParse(parsed);
    if (result.success) {
      return result.data;
    }
  } catch {
    return emptyLobbyPresetStore();
  }

  return emptyLobbyPresetStore();
}

export function saveLobbyPresetStore(store: LobbyPresetStore): void {
  if (typeof localStorage === "undefined") {
    return;
  }

  const result = LobbyPresetStoreSchema.safeParse(store);
  if (!result.success) {
    return;
  }

  try {
    localStorage.setItem(LOBBY_PRESET_STORAGE_KEY, JSON.stringify(result.data));
  } catch {
    return;
  }
}

export function listPresets(): LobbyPreset[] {
  return loadLobbyPresetStore().presets;
}

export function upsertPreset(input: {
  id?: string;
  name: string;
  config: Partial<GameConfig>;
}): LobbyPreset {
  const store = loadLobbyPresetStore();
  const now = Date.now();
  let preset: LobbyPreset | undefined;

  const existingIndex = input.id
    ? store.presets.findIndex((candidate) => candidate.id === input.id)
    : -1;
  if (existingIndex >= 0) {
    const existing = store.presets[existingIndex];
    // If the name differs, treat this as "save as" and create a new preset.
    if (existing.name === input.name) {
      preset = {
        ...existing,
        name: input.name,
        config: input.config,
        updatedAt: now,
      };
      store.presets[existingIndex] = preset;
    }
  }

  if (!preset) {
    preset = {
      id:
        existingIndex >= 0
          ? generateCryptoRandomUUID()
          : (input.id ?? generateCryptoRandomUUID()),
      name: input.name,
      createdAt: now,
      updatedAt: now,
      config: input.config,
    };
    store.presets.push(preset);
  }

  saveLobbyPresetStore(store);
  return preset;
}

export function deletePreset(id: string): void {
  const store = loadLobbyPresetStore();
  store.presets = store.presets.filter((preset) => preset.id !== id);
  if (store.lastUsedPresetId === id) {
    delete store.lastUsedPresetId;
  }
  saveLobbyPresetStore(store);
}

export function setLastUsedPresetId(id: string | undefined): void {
  const store = loadLobbyPresetStore();
  if (id === undefined) {
    delete store.lastUsedPresetId;
  } else {
    store.lastUsedPresetId = id;
  }
  saveLobbyPresetStore(store);
}

export function setAutoApplyLastUsed(enabled: boolean): void {
  const store = loadLobbyPresetStore();
  store.autoApplyLastUsed = enabled;
  saveLobbyPresetStore(store);
}
