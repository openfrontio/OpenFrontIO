import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearSoloSave,
  decompressSoloTurns,
  getActiveIdentity,
  getScopedSoloSaveKey,
  getSoloSave,
  getSoloSnapshot,
  LEGACY_SOLO_SAVE_KEY,
  saveSoloGame,
  saveSoloSnapshot,
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
    gameID: "game_test_1" as GameID,
    lobbyCreatedAt: Date.now(),
    config: {
      gameMap: "World",
      playerTeams: 0,
      difficulty: "Medium",
    } as any,
  } as GameStartInfo;
}

describe("SinglePlayerSaveManager", () => {
  beforeEach(() => {
    localStorage.clear();
    mockPlatform = "web";
    mockPersistentId = "user_abc_123";
    mockSteamId = null;
  });

  it("constructs platform and account-scoped storage keys", () => {
    expect(getScopedSoloSaveKey()).toBe(
      "openfront_solo_save:web:user_abc_123:v1",
    );

    mockPlatform = "steam";
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
      { turnNumber: 1, intents: [{ type: "attack" } as any] },
    ];

    saveSoloGame(dummyStartInfo(), turns);

    const save = getSoloSave();
    expect(save).not.toBe(null);
    expect(save?.gameID).toBe("game_test_1");
    expect(save?.platform).toBe("steam");
    expect(save?.userId).toBe("76561198000000001");
    expect(save?.steamId).toBe("76561198000000001");

    // Switching Steam accounts isolates saves
    mockSteamId = "76561198000000002";
    expect(getSoloSave()).toBe(null);

    // Switching back returns save
    mockSteamId = "76561198000000001";
    expect(getSoloSave()).not.toBe(null);

    clearSoloSave();
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

  it("persists and restores compressed snapshot bytes", async () => {
    const rawBytes = new Uint8Array([1, 2, 3, 4, 5, 42, 99, 128, 255]);
    const compressed = await compressSnapshot(rawBytes);

    saveSoloSnapshot(dummyStartInfo(), compressed, 150);

    const restored = await getSoloSnapshot();
    expect(restored).not.toBeNull();
    expect(restored?.gameStartInfo.gameID).toBe("game_test_1");
    expect(restored?.numTurns).toBe(150);
    expect(restored?.snapshot).toEqual(rawBytes);
  });
});
