import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearMemorySnapshots,
  clearSoloSave,
  decompressSoloTurns,
  getActiveIdentity,
  getScopedSoloSaveKey,
  getSnapshotBytes,
  getSoloSave,
  getSoloSnapshot,
  LEGACY_SOLO_SAVE_KEY,
  openSnapshotDatabase,
  saveSoloGame,
  saveSoloSnapshot,
  uint8ArrayToBase64,
} from "../../src/client/SinglePlayerSaveManager";
import { GameID, GameStartInfo, Turn } from "../../src/core/Schemas";
import { compressSnapshot } from "../../src/core/snapshot/GameSnapshot";

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

function dummyStartInfo(): GameStartInfo {
  return {
    gameID: "gameID1234" as GameID,
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

describe("SinglePlayerSaveManager", () => {
  beforeEach(() => {
    localStorage.clear();
    clearMemorySnapshots();
    mockPlatform = "web";
    mockPersistentId = "user_abc_123";
    mockSteamId = null;
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
    expect(restored).not.toBeNull();
    expect(restored?.gameStartInfo.gameID).toBe("gameID1234");
    expect(restored?.numTurns).toBe(150);
    expect(restored?.snapshot).toEqual(rawBytes);
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
    expect(restored?.snapshot).toEqual(rawBytes);
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
    expect(restored).not.toBeNull();
    expect(restored?.snapshot).toEqual(rawBytes);

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
});
