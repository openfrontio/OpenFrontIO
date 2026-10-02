import {
  GameID,
  GameStartInfo,
  GameStartInfoSchema,
  Turn,
  TurnSchema,
} from "../core/Schemas";
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

export const SNAPSHOT_DB_NAME = "openfront_snapshots";
export const SNAPSHOT_STORE_NAME = "snapshots";
export const SNAPSHOT_DB_VERSION = 1;
const OPEN_TIMEOUT_MS = 3000;

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export function openSnapshotDatabase(
  idb: IDBFactory | undefined = globalThis.indexedDB,
  timeoutMs = OPEN_TIMEOUT_MS,
): Promise<IDBDatabase | null> {
  if (!idb) return Promise.resolve(null);
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      console.warn("snapshot store: the database didn't open in time");
      resolve(null);
    }, timeoutMs);

    let req: IDBOpenDBRequest;
    try {
      req = idb.open(SNAPSHOT_DB_NAME, SNAPSHOT_DB_VERSION);
    } catch (e) {
      settled = true;
      clearTimeout(timer);
      console.warn("snapshot store: failed to open database", e);
      resolve(null);
      return;
    }

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(SNAPSHOT_STORE_NAME)) {
        db.createObjectStore(SNAPSHOT_STORE_NAME);
      }
    };

    req.onsuccess = () => {
      if (settled) {
        req.result.close();
        return;
      }
      settled = true;
      clearTimeout(timer);
      const db = req.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };

    req.onerror = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      console.warn("snapshot store: database open error", req.error);
      resolve(null);
    };
  });
}

let sharedDbPromise: Promise<IDBDatabase | null> | null = null;

export function closeSnapshotDatabase(): void {
  if (sharedDbPromise) {
    const pending = sharedDbPromise;
    sharedDbPromise = null;
    void pending.then((db) => {
      try {
        db?.close();
      } catch {
        // Ignore close errors
      }
    });
  }
}

export async function getSharedSnapshotDatabase(): Promise<IDBDatabase | null> {
  sharedDbPromise ??= openSnapshotDatabase()
    .then((db) => {
      if (!db) {
        sharedDbPromise = null;
        return null;
      }
      db.onversionchange = () => {
        try {
          db.close();
        } catch {
          // Ignore
        }
        sharedDbPromise = null;
      };
      db.onclose = () => {
        sharedDbPromise = null;
      };
      return db;
    })
    .catch((err) => {
      console.warn("snapshot store: failed to open shared database", err);
      sharedDbPromise = null;
      return null;
    });
  return sharedDbPromise;
}

async function getSnapshotDatabase(
  idb?: IDBFactory,
): Promise<{ db: IDBDatabase | null; isShared: boolean }> {
  if (!idb || idb === globalThis.indexedDB) {
    const db = await getSharedSnapshotDatabase();
    return { db, isShared: true };
  }
  const db = await openSnapshotDatabase(idb);
  return { db, isShared: false };
}

const memorySnapshots = new Map<string, Uint8Array>();

export function clearMemorySnapshots(): void {
  closeSnapshotDatabase();
  memorySnapshots.clear();
}

export async function saveSnapshotBytes(
  gameID: string,
  bytes: Uint8Array,
  idb?: IDBFactory,
): Promise<void> {
  let connection: { db: IDBDatabase | null; isShared: boolean } | null = null;
  try {
    connection = await getSnapshotDatabase(idb);
    const db = connection.db;
    if (!db) {
      memorySnapshots.set(gameID, bytes);
      return;
    }
    const tx = db.transaction(SNAPSHOT_STORE_NAME, "readwrite");
    tx.objectStore(SNAPSHOT_STORE_NAME).put(bytes, gameID);
    await done(tx);
    memorySnapshots.set(gameID, bytes);
  } catch (e) {
    console.warn(
      "Failed to persist snapshot to IndexedDB, falling back to memory",
      e,
    );
    memorySnapshots.set(gameID, bytes);
    if (connection?.isShared) {
      closeSnapshotDatabase();
    }
  } finally {
    if (connection && !connection.isShared && connection.db) {
      try {
        connection.db.close();
      } catch {
        // Ignore
      }
    }
  }
}

export async function getSnapshotBytes(
  gameID: string,
  idb?: IDBFactory,
): Promise<Uint8Array | null> {
  let connection: { db: IDBDatabase | null; isShared: boolean } | null = null;
  try {
    connection = await getSnapshotDatabase(idb);
    const db = connection.db;
    if (!db) {
      return memorySnapshots.get(gameID) ?? null;
    }
    const tx = db.transaction(SNAPSHOT_STORE_NAME, "readonly");
    const result = await request<unknown>(
      tx.objectStore(SNAPSHOT_STORE_NAME).get(gameID),
    );
    if (result instanceof Uint8Array) {
      return result;
    }
    if (result instanceof ArrayBuffer) {
      return new Uint8Array(result);
    }
    return memorySnapshots.get(gameID) ?? null;
  } catch (e) {
    console.warn("Failed to read snapshot from IndexedDB", e);
    if (connection?.isShared) {
      closeSnapshotDatabase();
    }
    return memorySnapshots.get(gameID) ?? null;
  } finally {
    if (connection && !connection.isShared && connection.db) {
      try {
        connection.db.close();
      } catch {
        // Ignore
      }
    }
  }
}

export async function deleteSnapshotBytes(
  gameID: string,
  idb?: IDBFactory,
): Promise<void> {
  memorySnapshots.delete(gameID);
  let connection: { db: IDBDatabase | null; isShared: boolean } | null = null;
  try {
    connection = await getSnapshotDatabase(idb);
    const db = connection.db;
    if (!db) return;
    const tx = db.transaction(SNAPSHOT_STORE_NAME, "readwrite");
    tx.objectStore(SNAPSHOT_STORE_NAME).delete(gameID);
    await done(tx);
  } catch (e) {
    console.warn("Failed to delete snapshot from IndexedDB", e);
    if (connection?.isShared) {
      closeSnapshotDatabase();
    }
  } finally {
    if (connection && !connection.isShared && connection.db) {
      try {
        connection.db.close();
      } catch {
        // Ignore
      }
    }
  }
}

export async function clearAllSnapshotBytes(idb?: IDBFactory): Promise<void> {
  memorySnapshots.clear();
  let connection: { db: IDBDatabase | null; isShared: boolean } | null = null;
  try {
    connection = await getSnapshotDatabase(idb);
    const db = connection.db;
    if (!db) return;
    const tx = db.transaction(SNAPSHOT_STORE_NAME, "readwrite");
    tx.objectStore(SNAPSHOT_STORE_NAME).clear();
    await done(tx);
  } catch (e) {
    console.warn("Failed to clear snapshots from IndexedDB", e);
    if (connection?.isShared) {
      closeSnapshotDatabase();
    }
  } finally {
    if (connection && !connection.isShared && connection.db) {
      try {
        connection.db.close();
      } catch {
        // Ignore
      }
    }
  }
}

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
  hasSnapshot?: boolean;
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
 * Persists a singleplayer snapshot: compressed bytes in IndexedDB, metadata in localStorage.
 */
export async function saveSoloSnapshot(
  gameStartInfo: GameStartInfo,
  compressedSnapshot: Uint8Array,
  numTurns: number,
  idb?: IDBFactory,
): Promise<void> {
  try {
    const identity = getActiveIdentity();
    const scopedKey = getScopedSoloSaveKey();
    if (!identity || !scopedKey) return;

    const existingSave = getSoloSave();
    if (existingSave && existingSave.gameID !== gameStartInfo.gameID) {
      return;
    }

    await saveSnapshotBytes(gameStartInfo.gameID, compressedSnapshot, idb);

    const currentSave = getSoloSave();
    if (currentSave && currentSave.gameID !== gameStartInfo.gameID) {
      await deleteSnapshotBytes(gameStartInfo.gameID, idb);
      return;
    }

    const saveState: SoloSaveState = {
      version: 1,
      gameID: gameStartInfo.gameID,
      savedAt: Date.now(),
      gameStartInfo,
      numTurns,
      platform: clientPlatform(),
      userId: identity.id,
      steamId: identity.steamId,
      hasSnapshot: true,
    };
    localStorage.setItem(scopedKey, JSON.stringify(saveState));
  } catch (e) {
    console.error("Failed to save singleplayer snapshot", e);
  }
}

/**
 * Saves solo game turns to localStorage.
 */
export function saveSoloGame(
  gameStartInfo: GameStartInfo,
  turns: Turn[],
): void {
  try {
    const existing = getSoloSave();
    const identity = getActiveIdentity();
    const scopedKey = getScopedSoloSaveKey();
    if (!identity || !scopedKey) return;

    const hasSnapshot =
      existing?.gameID === gameStartInfo.gameID
        ? (existing?.hasSnapshot ?? false)
        : false;

    const saveState: SoloSaveState = {
      version: 1,
      gameID: gameStartInfo.gameID,
      savedAt: Date.now(),
      gameStartInfo,
      turns,
      numTurns:
        existing?.gameID === gameStartInfo.gameID && hasSnapshot
          ? existing.numTurns
          : turns.length,
      platform: clientPlatform(),
      userId: identity.id,
      steamId: identity.steamId,
      hasSnapshot,
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
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) return null;
    const record = parsed as Record<string, unknown>;

    if (record.version !== 1) return null;
    if (typeof record.gameID !== "string" || !record.gameID) return null;
    if (!GameStartInfoSchema.safeParse(record.gameStartInfo).success) {
      return null;
    }
    if (
      typeof record.numTurns !== "number" ||
      !Number.isInteger(record.numTurns) ||
      record.numTurns < 0
    ) {
      return null;
    }
    if (record.snapshot !== undefined && typeof record.snapshot !== "string") {
      return null;
    }
    if (
      record.hasSnapshot !== undefined &&
      typeof record.hasSnapshot !== "boolean"
    ) {
      return null;
    }
    if (record.turns !== undefined) {
      if (!Array.isArray(record.turns)) return null;
      for (const turn of record.turns) {
        if (!TurnSchema.safeParse(turn).success) {
          return null;
        }
      }
    }
    const hasSnapshot =
      record.hasSnapshot === true ||
      (typeof record.snapshot === "string" && record.snapshot.length > 0);

    return {
      version: 1,
      gameID: record.gameID as GameID,
      savedAt: record.savedAt as number,
      gameStartInfo: record.gameStartInfo as GameStartInfo,
      turns: record.turns as Turn[] | undefined,
      numTurns: record.numTurns as number,
      platform: record.platform as string | undefined,
      userId: record.userId as string | undefined,
      steamId: record.steamId as string | undefined,
      hasSnapshot,
    };
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
  if (!save || !save.hasSnapshot) return null;
  try {
    let compressed = await getSnapshotBytes(save.gameID);
    if (!compressed) {
      // Check for legacy base64 snapshot in localStorage
      const scopedKey = getScopedSoloSaveKey();
      if (scopedKey) {
        const raw = localStorage.getItem(scopedKey);
        if (raw) {
          const parsed = JSON.parse(raw) as Record<string, unknown>;
          if (typeof parsed.snapshot === "string" && parsed.snapshot) {
            compressed = base64ToUint8Array(parsed.snapshot);
            // Migrate to IndexedDB and remove base64 payload from localStorage
            await saveSnapshotBytes(save.gameID, compressed);
            delete parsed.snapshot;
            parsed.hasSnapshot = true;
            localStorage.setItem(scopedKey, JSON.stringify(parsed));
          }
        }
      }
    }
    if (!compressed) return null;
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
 * If gameID is supplied, only clears if the stored save matches that gameID.
 */
export function clearSoloSave(gameID?: GameID): void {
  try {
    const current = getSoloSave();
    if (gameID && current && current.gameID !== gameID) {
      return;
    }
    const targetGameID = gameID ?? current?.gameID;
    const scopedKey = getScopedSoloSaveKey();
    if (scopedKey) {
      localStorage.removeItem(scopedKey);
    }
    localStorage.removeItem(LEGACY_SOLO_SAVE_KEY);
    if (targetGameID) {
      void deleteSnapshotBytes(targetGameID);
    }
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
