import { GameID, GameStartInfo, Turn } from "../core/Schemas";
import { decompressSnapshot } from "../core/snapshot/GameSnapshot";
import { getPersistentID } from "./Auth";
import { clientPlatform } from "./ClientPlatform";
import { steamSDK } from "./SteamSDK";

export function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = "";
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export const LEGACY_SOLO_SAVE_KEY = "openfront_solo_save_v1";

export interface SoloSaveState {
  version: 1;
  gameID: GameID;
  savedAt: number;
  gameStartInfo: GameStartInfo;
  turns?: Turn[];
  numTurns: number;
  platform?: string;
  userId?: string;
  steamId?: string;
  snapshot?: string; // base64-encoded compressed Uint8Array
}

/**
 * Returns the active platform-specific user ID.
 * On Steam, returns the player's 64-bit Steam ID when available, or null if not yet resolved.
 */
export function getActiveIdentity(): { id: string; steamId?: string } | null {
  const platform = clientPlatform();
  if (platform === "steam") {
    const steamId = steamSDK.getSteamIdSync();
    if (steamId) {
      return { id: steamId, steamId };
    }
    // Eagerly prewarm the Steam user for future reads
    void steamSDK.getUser();
    return null;
  }
  return { id: getPersistentID() };
}

/**
 * Constructs a scoped storage key for singleplayer saves, or null if identity is unresolved.
 */
export function getScopedSoloSaveKey(): string | null {
  const platform = clientPlatform();
  const identity = getActiveIdentity();
  if (!identity) return null;
  return `openfront_solo_save:${platform}:${identity.id}:v1`;
}

/**
 * Migrates an old unscoped singleplayer save to the current account key if needed.
 */
export function migrateLegacySoloSave(): void {
  try {
    const scopedKey = getScopedSoloSaveKey();
    if (!scopedKey) return;
    if (localStorage.getItem(scopedKey)) {
      return;
    }
    const legacy = localStorage.getItem(LEGACY_SOLO_SAVE_KEY);
    if (!legacy) return;

    localStorage.setItem(scopedKey, legacy);
    localStorage.removeItem(LEGACY_SOLO_SAVE_KEY);
  } catch (e) {
    console.warn("Failed to migrate legacy singleplayer save", e);
  }
}

/**
 * Persists a singleplayer save state to localStorage scoped to the active account.
 */
export function saveSoloSnapshot(
  gameStartInfo: GameStartInfo,
  compressedSnapshot: Uint8Array,
  numTurns: number,
): void {
  try {
    const identity = getActiveIdentity();
    const scopedKey = getScopedSoloSaveKey();
    if (!identity || !scopedKey) return;

    const saveState: SoloSaveState = {
      version: 1,
      gameID: gameStartInfo.gameID,
      savedAt: Date.now(),
      gameStartInfo,
      numTurns,
      platform: clientPlatform(),
      userId: identity.id,
      steamId: identity.steamId,
      snapshot: uint8ArrayToBase64(compressedSnapshot),
    };
    localStorage.setItem(scopedKey, JSON.stringify(saveState));
  } catch (e) {
    console.error("Failed to save singleplayer snapshot to localStorage", e);
  }
}

/**
 * Legacy compatibility: saves solo game with optional compressed snapshot.
 */
export function saveSoloGame(
  gameStartInfo: GameStartInfo,
  turns: Turn[],
  compressedSnapshot?: Uint8Array,
): void {
  try {
    const existing = getSoloSave();
    const identity = getActiveIdentity();
    const scopedKey = getScopedSoloSaveKey();
    if (!identity || !scopedKey) return;

    const saveState: SoloSaveState = {
      version: 1,
      gameID: gameStartInfo.gameID,
      savedAt: Date.now(),
      gameStartInfo,
      turns,
      numTurns:
        existing?.gameID === gameStartInfo.gameID && existing.snapshot
          ? existing.numTurns
          : turns.length,
      platform: clientPlatform(),
      userId: identity.id,
      steamId: identity.steamId,
      snapshot: compressedSnapshot
        ? uint8ArrayToBase64(compressedSnapshot)
        : existing?.gameID === gameStartInfo.gameID
          ? existing?.snapshot
          : undefined,
    };
    localStorage.setItem(scopedKey, JSON.stringify(saveState));
  } catch (e) {
    console.error("Failed to save singleplayer game to localStorage", e);
  }
}

/**
 * Retrieves the saved singleplayer match for the active account.
 */
export function getSoloSave(): SoloSaveState | null {
  try {
    const scopedKey = getScopedSoloSaveKey();
    if (!scopedKey) return null;
    migrateLegacySoloSave();
    const raw = localStorage.getItem(scopedKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SoloSaveState;
    if (parsed.version === 1 && parsed.gameStartInfo && parsed.gameID) {
      return parsed;
    }
    return null;
  } catch (e) {
    console.error("Failed to read singleplayer save from localStorage", e);
    return null;
  }
}

/**
 * Loads and decompresses the raw snapshot bytes from the saved singleplayer match.
 */
export async function getSoloSnapshot(): Promise<{
  gameStartInfo: GameStartInfo;
  snapshot: Uint8Array;
  numTurns: number;
} | null> {
  const save = getSoloSave();
  if (!save || !save.snapshot) return null;
  try {
    const compressed = base64ToUint8Array(save.snapshot);
    const uncompressed = await decompressSnapshot(compressed);
    return {
      gameStartInfo: save.gameStartInfo,
      snapshot: uncompressed,
      numTurns: save.numTurns,
    };
  } catch (e) {
    console.error("Failed to decompress saved snapshot", e);
    return null;
  }
}

/**
 * Clears the saved singleplayer game for the active account.
 */
export function clearSoloSave(): void {
  try {
    const scopedKey = getScopedSoloSaveKey();
    if (scopedKey) {
      localStorage.removeItem(scopedKey);
    }
    localStorage.removeItem(LEGACY_SOLO_SAVE_KEY);
  } catch (e) {
    console.error("Failed to clear singleplayer save from localStorage", e);
  }
}

/**
 * Expands sparse saved turns sequentially.
 */
export function decompressSoloTurns(
  sparseTurns: Turn[],
  totalTurns: number,
): Turn[] {
  const result: Turn[] = new Array(totalTurns);
  let sparseIdx = 0;
  for (let i = 0; i < totalTurns; i++) {
    if (
      sparseIdx < sparseTurns.length &&
      sparseTurns[sparseIdx].turnNumber === i
    ) {
      result[i] = sparseTurns[sparseIdx];
      sparseIdx++;
    } else {
      result[i] = { turnNumber: i, intents: [] };
    }
  }
  return result;
}
