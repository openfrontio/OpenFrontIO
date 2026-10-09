import { GameID, GameStartInfo, Turn } from "@openfront/engine-api/Schemas";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearMemorySnapshots,
  clearSoloSave,
  closeSnapshotDatabase,
  compressSnapshot,
  decompressSoloTurns,
  deleteSnapshotBytes,
  getActiveIdentity,
  getScopedSoloSaveKey,
  getSharedSnapshotDatabase,
  getSnapshotBytes,
  getSoloSave,
  getSoloSnapshot,
  LEGACY_SOLO_SAVE_KEY,
  openSnapshotDatabase,
  saveSnapshotBytes,
  saveSoloGame,
  saveSoloSnapshot,
  uint8ArrayToBase64,
} from "../../src/client/SinglePlayerSaveManager";

let mockPlatform = "web";
let mockPersistentId = "user_abc_123";
let mockSteamId: string | null = null;

vi.mock("../../src/client/ClientPlatform", () => ({
  clientPlatform: () => mockPlatform,
}));

vi.mock("../../src/client/Auth", () => ({
  getPersistentID: () => mockPersistentId,
}));

vi.mock("../../src/client/SteamSDK", () => ({
  steamSDK: {
    getSteamIdSync: () => mockSteamId,
    getUser: vi.fn(async () =>
      mockSteamId ? { steamId: mockSteamId, name: "SteamTester" } : null,
    ),
  },
}));

function dummyStartInfo(gameID: string = "gameID1234"): GameStartInfo {
  return {
    gameID: gameID as GameID,
    lobbyCreatedAt: Date.now(),
    config: {
      gameMap: "World",
      difficulty: "Medium",
      donateGold: false,
      donateTroops: false,
      gameType: "Singleplayer",
      gameMode: "Free For All",
      gameMapSize: "Normal",
      nations: "default",
      bots: 400,
      infiniteGold: false,
      infiniteTroops: false,
      instantBuild: false,
      randomSpawn: false,
    },
    players: [
      {
        clientID: "client1234",
        username: "Tester",
        clanTag: null,
      },
    ],
  } as GameStartInfo;
}

function createMockIndexedDb() {
  const store = new Map<string, unknown>();
  const db = {
    close: vi.fn(),
    onversionchange: null as (() => void) | null,
    onclose: null as (() => void) | null,
    objectStoreNames: {
      contains: (name: string) => name === "snapshots",
    },
    createObjectStore: vi.fn(),
    transaction: vi.fn((_storeName: string, _mode: string) => {
      const tx = {
        objectStore: vi.fn(() => ({
          put: vi.fn((value: unknown, key: string) => {
            store.set(key, value);
            const req = { onsuccess: null as any, onerror: null as any };
            setTimeout(() => req.onsuccess?.(), 0);
            return req;
          }),
          get: vi.fn((key: string) => {
            const req = {
              onsuccess: null as any,
              onerror: null as any,
              result: store.get(key),
            };
            setTimeout(() => req.onsuccess?.(), 0);
            return req;
          }),
          delete: vi.fn((key: string) => {
            store.delete(key);
            const req = { onsuccess: null as any, onerror: null as any };
            setTimeout(() => req.onsuccess?.(), 0);
            return req;
          }),
        })),
        oncomplete: null as (() => void) | null,
        onerror: null as ((err: unknown) => void) | null,
        onabort: null as (() => void) | null,
      };
      setTimeout(() => tx.oncomplete?.(), 0);
      return tx;
    }),
  };

  const idb = {
    open: vi.fn(() => {
      const req = {
        result: db,
        onsuccess: null as (() => void) | null,
        onerror: null as (() => void) | null,
        onupgradeneeded: null as (() => void) | null,
      };
      setTimeout(() => {
        req.onupgradeneeded?.();
        req.onsuccess?.();
      }, 0);
      return req as unknown as IDBOpenDBRequest;
    }),
  } as unknown as IDBFactory;

  return { idb, db, store };
}

describe("SinglePlayerSaveManager", () => {
  const originalIndexedDB = globalThis.indexedDB;
  let mockIdb: ReturnType<typeof createMockIndexedDb>;

  beforeEach(() => {
    localStorage.clear();
    clearMemorySnapshots();
    mockPlatform = "web";
    mockPersistentId = "user_abc_123";
    mockSteamId = null;
    mockIdb = createMockIndexedDb();
    (globalThis as any).indexedDB = mockIdb.idb;
  });

  afterEach(() => {
    closeSnapshotDatabase();
    (globalThis as any).indexedDB = originalIndexedDB;
  });

  it("constructs platform and account-scoped storage keys", () => {
    expect(getScopedSoloSaveKey()).toBe(
      "openfront_solo_save:web:user_abc_123:v1",
    );

    mockPlatform = "steam";
    mockSteamId = null;
    expect(getActiveIdentity()).toBeNull();
    expect(getScopedSoloSaveKey()).toBeNull();
    expect(getSoloSave()).toBeNull();

    mockSteamId = "76561198012345678";
    expect(getScopedSoloSaveKey()).toBe(
      "openfront_solo_save:steam:76561198012345678:v1",
    );
    expect(getActiveIdentity()).toEqual({
      id: "76561198012345678",
      steamId: "76561198012345678",
    });

    mockPlatform = "crazygames";
    mockPersistentId = "cg_player_456";
    expect(getScopedSoloSaveKey()).toBe(
      "openfront_solo_save:crazygames:cg_player_456:v1",
    );
  });

  it("saves, retrieves, and clears games scoped to the active Steam account", () => {
    mockPlatform = "steam";
    mockSteamId = "76561198000000001";

    expect(getSoloSave()).toBe(null);

    const turns: Turn[] = [
      { turnNumber: 0, intents: [] },
      { turnNumber: 1, intents: [] },
    ];

    saveSoloGame(dummyStartInfo(), turns);

    const save = getSoloSave();
    expect(save).not.toBe(null);
    expect(save?.gameID).toBe("gameID1234");
    expect(save?.platform).toBe("steam");
    expect(save?.userId).toBe("76561198000000001");
    expect(save?.steamId).toBe("76561198000000001");

    // Switching Steam accounts isolates saves
    mockSteamId = "76561198000000002";
    expect(getSoloSave()).toBe(null);

    // Switching back returns save
    mockSteamId = "76561198000000001";
    expect(getSoloSave()).not.toBe(null);

    // Mismatched gameID does not clear save
    clearSoloSave("gameOther12" as GameID);
    expect(getSoloSave()).not.toBe(null);

    // Matching gameID clears save
    clearSoloSave("gameID1234" as GameID);
    expect(getSoloSave()).toBe(null);
  });

  it("migrates legacy unscoped save to the active account key", () => {
    mockPlatform = "web";
    mockPersistentId = "user_legacy_test";

    const legacyState = {
      version: 1,
      gameID: "legacy_game",
      savedAt: 12345,
      gameStartInfo: dummyStartInfo(),
      turns: [],
      numTurns: 10,
    };
    localStorage.setItem(LEGACY_SOLO_SAVE_KEY, JSON.stringify(legacyState));

    const save = getSoloSave();
    expect(save?.gameID).toBe("legacy_game");

    expect(localStorage.getItem(LEGACY_SOLO_SAVE_KEY)).toBe(null);
    expect(
      localStorage.getItem("openfront_solo_save:web:user_legacy_test:v1"),
    ).not.toBe(null);
  });

  it("clearSoloSave with gameID returns without clearing if current save is missing, but clears unconditionally without gameID", () => {
    // When no scoped key resolves (e.g. steam unresolved) and a legacy save is in localStorage
    mockPlatform = "steam";
    mockSteamId = null;

    const legacyState = {
      version: 1,
      gameID: "legacy_game",
      savedAt: 12345,
      gameStartInfo: dummyStartInfo(),
      turns: [],
      numTurns: 10,
    };
    localStorage.setItem(LEGACY_SOLO_SAVE_KEY, JSON.stringify(legacyState));
    expect(getSoloSave()).toBe(null);

    // Call clearSoloSave with a gameID when current save is missing: does not clear legacy save
    clearSoloSave("some_other_game" as GameID);
    expect(localStorage.getItem(LEGACY_SOLO_SAVE_KEY)).not.toBe(null);

    // Call clearSoloSave without gameID: clears unconditionally
    clearSoloSave();
    expect(localStorage.getItem(LEGACY_SOLO_SAVE_KEY)).toBe(null);
  });

  it("re-expands sparse turns sequentially", () => {
    const sparseTurns: Turn[] = [
      { turnNumber: 1, intents: [{ type: "attack" } as any] },
      { turnNumber: 4, intents: [{ type: "build" } as any] },
    ];
    const expanded = decompressSoloTurns(sparseTurns, 6);
    expect(expanded).toHaveLength(6);
    expect(expanded[0].turnNumber).toBe(0);
    expect(expanded[0].intents).toHaveLength(0);
    expect(expanded[1].turnNumber).toBe(1);
    expect(expanded[1].intents).toHaveLength(1);
    expect(expanded[4].turnNumber).toBe(4);
    expect(expanded[4].intents).toHaveLength(1);
    expect(expanded[5].turnNumber).toBe(5);
  });

  it("persists and restores compressed snapshot bytes while keeping only metadata in localStorage", async () => {
    const rawBytes = new Uint8Array([1, 2, 3, 4, 5, 42, 99, 128, 255]);
    const compressed = await compressSnapshot(rawBytes);

    await saveSoloSnapshot(dummyStartInfo(), compressed, 150);

    // Verify localStorage has only metadata and no base64 snapshot payload
    const key = getScopedSoloSaveKey()!;
    const rawStored = JSON.parse(localStorage.getItem(key)!) as Record<
      string,
      unknown
    >;
    expect(rawStored.hasSnapshot).toBe(true);
    expect(rawStored.snapshot).toBeUndefined();
    expect(rawStored.numTurns).toBe(150);

    const save = getSoloSave();
    expect(save).not.toBeNull();
    expect(save?.hasSnapshot).toBe(true);

    const restored = await getSoloSnapshot();
    expect(restored.status).toBe("success");
    if (restored.status === "success") {
      expect(restored.gameStartInfo.gameID).toBe("gameID1234");
      expect(restored.numTurns).toBe(150);
      expect(restored.snapshot).toEqual(rawBytes);
    }
  });

  it("preserves an existing snapshot when saveSoloGame is called with matching gameID", async () => {
    const rawBytes = new Uint8Array([10, 20, 30, 40]);
    const compressed = await compressSnapshot(rawBytes);
    await saveSoloSnapshot(dummyStartInfo(), compressed, 50);

    // Save turns for the same match
    saveSoloGame(dummyStartInfo(), []);

    const save = getSoloSave();
    expect(save?.hasSnapshot).toBe(true);
    expect(save?.numTurns).toBe(50);
    const restored = await getSoloSnapshot();
    expect(restored.status).toBe("success");
    if (restored.status === "success") {
      expect(restored.snapshot).toEqual(rawBytes);
    }
  });

  it("skips writing snapshot bytes entirely if stored save belongs to a different game before write starts", async () => {
    const rawBytes = new Uint8Array([1, 2, 3, 4]);
    const compressed = await compressSnapshot(rawBytes);

    const oldGame = dummyStartInfo("gameOLD123");
    const newGame = dummyStartInfo("gameNEW456");

    saveSoloGame(newGame, []);

    const fakeIdb = {
      open: vi.fn(),
    } as unknown as IDBFactory;

    await saveSoloSnapshot(oldGame, compressed, 10, fakeIdb);

    // fakeIdb.open was never called because it returned early before write
    expect(fakeIdb.open).not.toHaveBeenCalled();

    // Newer save is preserved
    const save = getSoloSave();
    expect(save?.gameID).toBe("gameNEW456");
  });

  it("discards stale snapshot bytes and does not overwrite newer save if a different game was saved during snapshot write", async () => {
    const rawBytes = new Uint8Array([5, 6, 7, 8]);
    const compressed = await compressSnapshot(rawBytes);

    const oldGame = dummyStartInfo("gameOLD123");
    const newGame = dummyStartInfo("gameNEW456");

    // Initialize with oldGame save so pre-write check passes
    saveSoloGame(oldGame, []);

    const store = {
      put: vi.fn(),
      delete: vi.fn(),
    };
    const dbStub = {
      close: vi.fn(),
      transaction: vi.fn((_storeName: string, mode: string) => {
        const tx = {
          objectStore: vi.fn(() => store),
          oncomplete: null as (() => void) | null,
          onerror: null as any,
          onabort: null as any,
        };
        if (mode === "readwrite" && store.put.mock.calls.length === 0) {
          // While write is in flight, a new game is saved
          saveSoloGame(newGame, []);
        }
        setTimeout(() => tx.oncomplete?.(), 0);
        return tx;
      }),
    };
    const injectedIdb = {
      open: vi.fn(() => {
        const req = {
          result: dbStub,
          onsuccess: null as (() => void) | null,
        } as unknown as IDBOpenDBRequest & { onsuccess: () => void };
        queueMicrotask(() => req.onsuccess?.());
        return req;
      }),
    } as unknown as IDBFactory;

    await saveSoloSnapshot(oldGame, compressed, 30, injectedIdb);

    // The newer save is preserved in localStorage
    const save = getSoloSave();
    expect(save).not.toBeNull();
    expect(save?.gameID).toBe("gameNEW456");

    // Snapshot bytes were written, then deleted once replacement was detected
    expect(store.put).toHaveBeenCalled();
    expect(store.delete).toHaveBeenCalledWith("gameOLD123");
  });

  it("migrates legacy base64 snapshot in localStorage to snapshot store on restore", async () => {
    const rawBytes = new Uint8Array([11, 22, 33, 44]);
    const compressed = await compressSnapshot(rawBytes);
    const legacyState = {
      version: 1,
      gameID: "legacy1234",
      savedAt: Date.now(),
      gameStartInfo: {
        ...dummyStartInfo(),
        gameID: "legacy1234",
      },
      numTurns: 75,
      snapshot: uint8ArrayToBase64(compressed),
    };
    const key = getScopedSoloSaveKey()!;
    localStorage.setItem(key, JSON.stringify(legacyState));

    // getSoloSave recognises legacy snapshot as having a snapshot
    const save = getSoloSave();
    expect(save?.hasSnapshot).toBe(true);

    // getSoloSnapshot decodes and migrates to snapshot store, removing snapshot from localStorage
    const restored = await getSoloSnapshot();
    expect(restored.status).toBe("success");
    if (restored.status === "success") {
      expect(restored.snapshot).toEqual(rawBytes);
    }

    const rawAfter = JSON.parse(localStorage.getItem(key)!) as Record<
      string,
      unknown
    >;
    expect(rawAfter.snapshot).toBeUndefined();
    expect(rawAfter.hasSnapshot).toBe(true);

    // Snapshot store now has the bytes directly
    const storedBytes = await getSnapshotBytes("legacy1234");
    expect(storedBytes).not.toBeNull();
  });

  it("clears snapshot bytes from storage when clearSoloSave is called", async () => {
    const rawBytes = new Uint8Array([7, 8, 9]);
    const compressed = await compressSnapshot(rawBytes);
    await saveSoloSnapshot(dummyStartInfo(), compressed, 20);

    expect(await getSnapshotBytes("gameID1234")).not.toBeNull();

    clearSoloSave("gameID1234" as GameID);
    expect(getSoloSave()).toBeNull();
    expect(await getSnapshotBytes("gameID1234")).toBeNull();
  });

  it("handles IndexedDB opening timeouts and version changes gracefully", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});

    function fakeIndexedDb() {
      const db = {
        close: vi.fn(),
        onversionchange: null as (() => void) | null,
      };
      const req = {
        result: db,
        onsuccess: null as (() => void) | null,
      } as unknown as IDBOpenDBRequest & { onsuccess: () => void };
      const idb = { open: () => req } as unknown as IDBFactory;
      return { idb, db, succeed: () => req.onsuccess() };
    }

    // Timeout case
    const timeoutSetup = fakeIndexedDb();
    const timeoutPromise = openSnapshotDatabase(timeoutSetup.idb, 5);
    expect(await timeoutPromise).toBeNull();

    // If onsuccess fires after timeout, it closes the db
    timeoutSetup.succeed();
    expect(timeoutSetup.db.close).toHaveBeenCalled();

    // Versionchange case
    const successSetup = fakeIndexedDb();
    const openPromise = openSnapshotDatabase(successSetup.idb, 1000);
    successSetup.succeed();
    const opened = await openPromise;
    expect(opened).not.toBeNull();
    successSetup.db.onversionchange?.();
    expect(successSetup.db.close).toHaveBeenCalledTimes(1);

    vi.restoreAllMocks();
  });

  it("reuses the shared cached IndexedDB connection across multiple operations and invalidates on version change", async () => {
    const dbStub = {
      close: vi.fn(),
      onversionchange: null as (() => void) | null,
      onclose: null as (() => void) | null,
    };
    let openCount = 0;
    const req = {
      result: dbStub,
      onsuccess: null as (() => void) | null,
    } as unknown as IDBOpenDBRequest & { onsuccess: () => void };
    const fakeIdb = {
      open: () => {
        openCount++;
        return req;
      },
    } as unknown as IDBFactory;

    const originalIndexedDB = globalThis.indexedDB;
    try {
      (globalThis as any).indexedDB = fakeIdb;

      // First request opens the database
      const db1Promise = getSharedSnapshotDatabase();
      req.onsuccess();
      const db1 = await db1Promise;
      expect(db1).toBe(dbStub);
      expect(openCount).toBe(1);

      // Second request reuses the cached connection without calling open again
      const db2 = await getSharedSnapshotDatabase();
      expect(db2).toBe(dbStub);
      expect(openCount).toBe(1);

      // Triggering version change closes the db and clears the shared connection
      dbStub.onversionchange?.();
      expect(dbStub.close).toHaveBeenCalledTimes(1);

      // Next request opens a new database connection
      const db3Promise = getSharedSnapshotDatabase();
      req.onsuccess();
      const db3 = await db3Promise;
      expect(db3).toBe(dbStub);
      expect(openCount).toBe(2);
    } finally {
      (globalThis as any).indexedDB = originalIndexedDB;
      closeSnapshotDatabase();
    }
  });

  it("keeps explicitly injected factories isolated from the shared connection pool and closes them after use", async () => {
    const tx = {
      objectStore: vi.fn(() => ({
        put: vi.fn(),
      })),
      oncomplete: null as (() => void) | null,
      onerror: null as any,
      onabort: null as any,
    };
    const isolatedDbStub = {
      close: vi.fn(),
      transaction: vi.fn(() => {
        setTimeout(() => tx.oncomplete?.(), 0);
        return tx;
      }),
    };
    const req = {
      result: isolatedDbStub,
      onsuccess: null as (() => void) | null,
    } as unknown as IDBOpenDBRequest & { onsuccess: () => void };
    const injectedIdb = {
      open: vi.fn(() => req),
    } as unknown as IDBFactory;

    const savePromise = saveSnapshotBytes(
      "isolated_game",
      new Uint8Array([1, 2, 3]),
      injectedIdb,
    );
    req.onsuccess();

    await savePromise;

    // Injected connection was opened and closed after use
    expect(injectedIdb.open).toHaveBeenCalledTimes(1);
    expect(isolatedDbStub.close).toHaveBeenCalledTimes(1);

    closeSnapshotDatabase();
  });

  it("closes and resets the shared connection pool when an operation throws an error on a shared connection", async () => {
    const originalIndexedDB = globalThis.indexedDB;
    const dbStub = {
      close: vi.fn(),
      transaction: vi.fn(() => {
        throw new Error("IndexedDB transaction failure");
      }),
    };
    const req = {
      result: dbStub,
      onsuccess: null as (() => void) | null,
    } as unknown as IDBOpenDBRequest & { onsuccess: () => void };

    const fakeIndexedDb = {
      open: vi.fn(() => req),
    } as unknown as IDBFactory;

    (globalThis as any).indexedDB = fakeIndexedDb;

    try {
      const savePromise = saveSnapshotBytes(
        "fail_game",
        new Uint8Array([1, 2, 3]),
      );
      req.onsuccess();
      await savePromise;

      // The error triggered closeSnapshotDatabase(), which closed the shared db
      expect(dbStub.close).toHaveBeenCalledTimes(1);

      // Subsequent requests will re-open rather than reusing the dead connection
      const dbNextPromise = getSharedSnapshotDatabase();
      req.onsuccess();
      await dbNextPromise;
      expect(fakeIndexedDb.open).toHaveBeenCalledTimes(2);
    } finally {
      (globalThis as any).indexedDB = originalIndexedDB;
      closeSnapshotDatabase();
    }
  });

  it("validates persisted save state and rejects records with malformed numTurns, snapshot, or turns", () => {
    const validBase = {
      version: 1,
      gameID: "game_valid",
      savedAt: Date.now(),
      gameStartInfo: dummyStartInfo(),
      numTurns: 10,
    };
    const key = getScopedSoloSaveKey()!;

    // Valid base save
    localStorage.setItem(key, JSON.stringify(validBase));
    expect(getSoloSave()).not.toBeNull();

    // Invalid gameStartInfo (fails GameStartInfoSchema)
    localStorage.setItem(
      key,
      JSON.stringify({ ...validBase, gameStartInfo: { invalid: true } }),
    );
    expect(getSoloSave()).toBeNull();

    // Invalid numTurns (negative, float, string)
    localStorage.setItem(key, JSON.stringify({ ...validBase, numTurns: -1 }));
    expect(getSoloSave()).toBeNull();

    localStorage.setItem(key, JSON.stringify({ ...validBase, numTurns: 3.14 }));
    expect(getSoloSave()).toBeNull();

    localStorage.setItem(key, JSON.stringify({ ...validBase, numTurns: "10" }));
    expect(getSoloSave()).toBeNull();

    // Invalid snapshot (not a string)
    localStorage.setItem(
      key,
      JSON.stringify({ ...validBase, snapshot: 12345 }),
    );
    expect(getSoloSave()).toBeNull();

    // Invalid turns (not an array)
    localStorage.setItem(
      key,
      JSON.stringify({ ...validBase, turns: "not-an-array" }),
    );
    expect(getSoloSave()).toBeNull();

    // Invalid turn entry (fails TurnSchema.safeParse)
    localStorage.setItem(
      key,
      JSON.stringify({
        ...validBase,
        turns: [{ turnNumber: -1, intents: [] }],
      }),
    );
    expect(getSoloSave()).toBeNull();

    localStorage.setItem(
      key,
      JSON.stringify({
        ...validBase,
        turns: [{ turnNumber: 0, intents: [{ type: "bogus_intent" }] }],
      }),
    );
    expect(getSoloSave()).toBeNull();

    // Valid turns
    localStorage.setItem(
      key,
      JSON.stringify({
        ...validBase,
        turns: [{ turnNumber: 0, intents: [] }],
      }),
    );
    expect(getSoloSave()).not.toBeNull();
  });

  it("reports IndexedDB persistence status from saveSnapshotBytes and skips saveSoloSnapshot metadata when persistence fails", async () => {
    const rawBytes = new Uint8Array([1, 2, 3, 4]);
    const compressed = await compressSnapshot(rawBytes);

    // With working mock IndexedDB
    const success = await saveSnapshotBytes("gamesucc12", compressed);
    expect(success).toBe(true);

    try {
      // When IndexedDB is unavailable
      (globalThis as any).indexedDB = undefined;
      closeSnapshotDatabase();
      const fallbackOnly = await saveSnapshotBytes("gamefall12", compressed);
      expect(fallbackOnly).toBe(false);

      // saveSoloSnapshot skips writing metadata to localStorage when persistence returns false
      await saveSoloSnapshot(dummyStartInfo("failidb123"), compressed, 100);
      const key = getScopedSoloSaveKey()!;
      expect(localStorage.getItem(key)).toBeNull();
      expect(getSoloSave()).toBeNull();
    } finally {
      (globalThis as any).indexedDB = mockIdb.idb;
      closeSnapshotDatabase();
    }
  });

  it("distinguishes missing, corrupt, and storage unavailable states in getSoloSnapshot", async () => {
    // 1. Missing: no save at all
    expect(await getSoloSnapshot()).toEqual({ status: "missing" });

    // Save metadata with hasSnapshot: true
    const startInfo = dummyStartInfo("gamestat12");
    const rawBytes = new Uint8Array([1, 2, 3, 4]);
    const compressed = await compressSnapshot(rawBytes);
    await saveSoloSnapshot(startInfo, compressed, 50);

    // 2. Success
    const successRes = await getSoloSnapshot();
    expect(successRes.status).toBe("success");

    // 3. Corrupt: snapshot bytes corrupted in store
    mockIdb.store.set("gamestat12", new Uint8Array([99, 98, 97, 96])); // invalid compressed header
    const corruptRes = await getSoloSnapshot();
    expect(corruptRes.status).toBe("corrupt");

    // 4. Missing: key removed from store
    await deleteSnapshotBytes("gamestat12");
    const missingRes = await getSoloSnapshot();
    expect(missingRes.status).toBe("missing");

    try {
      // 5. Unavailable: database open times out or fails
      closeSnapshotDatabase();
      const timeoutSetup = {
        open: () => ({}) as unknown as IDBOpenDBRequest, // never resolves
      } as unknown as IDBFactory;
      (globalThis as any).indexedDB = timeoutSetup;
      const unavailableRes = await getSoloSnapshot(timeoutSetup);
      expect(unavailableRes.status).toBe("unavailable");
    } finally {
      (globalThis as any).indexedDB = mockIdb.idb;
      closeSnapshotDatabase();
    }
  });

  it("retains legacy base64 snapshot in localStorage when IndexedDB persistence fails during migration", async () => {
    const rawBytes = new Uint8Array([1, 2, 3, 4]);
    const compressed = await compressSnapshot(rawBytes);
    const base64 = uint8ArrayToBase64(compressed);

    const key = getScopedSoloSaveKey()!;
    const legacySave = {
      version: 1,
      gameID: "legacydb12",
      savedAt: Date.now(),
      gameStartInfo: dummyStartInfo("legacydb12"),
      snapshot: base64,
      numTurns: 10,
    };
    localStorage.setItem(key, JSON.stringify(legacySave));

    // Simulate failing IndexedDB
    const failingIdb = {
      open: vi.fn(() => {
        const req = {
          onerror: null as any,
          error: new Error("IDB write failed"),
        } as unknown as IDBOpenDBRequest;
        setTimeout(() => req.onerror?.(new Event("error")), 0);
        return req;
      }),
    } as unknown as IDBFactory;

    const restored = await getSoloSnapshot(failingIdb);
    // Even if IndexedDB write failed, snapshot was read from memory/localStorage and returned
    expect(restored.status).toBe("success");

    // But legacy base64 snapshot is RETAINED in localStorage because persistence failed!
    const rawStored = JSON.parse(localStorage.getItem(key)!) as Record<
      string,
      unknown
    >;
    expect(rawStored.snapshot).toBe(base64);
  });

  it("does not resurrect save if clearSoloSave is called during in-flight saveSoloSnapshot", async () => {
    const gameID = "gameRACE01";
    const startInfo = dummyStartInfo(gameID);
    saveSoloGame(startInfo, []);
    expect(getSoloSave()?.gameID).toBe(gameID);

    // Start saveSoloSnapshot; it will await saveSnapshotBytes
    const savePromise = saveSoloSnapshot(
      startInfo,
      new Uint8Array([1, 2, 3]),
      1,
      mockIdb.idb,
    );

    // While save is in-flight, clear the save
    clearSoloSave(gameID as GameID);
    expect(getSoloSave()).toBeNull();

    // Await saveSoloSnapshot to complete
    await savePromise;

    // The cleared save should NOT be resurrected in localStorage
    expect(getSoloSave()).toBeNull();

    // Further saves for the cleared gameID should also be rejected
    saveSoloGame(startInfo, []);
    expect(getSoloSave()).toBeNull();

    await saveSoloSnapshot(
      startInfo,
      new Uint8Array([1, 2, 3]),
      2,
      mockIdb.idb,
    );
    expect(getSoloSave()).toBeNull();
  });
});
