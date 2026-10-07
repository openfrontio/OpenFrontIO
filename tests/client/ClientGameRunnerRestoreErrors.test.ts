import { GameMapType, GameType } from "@openfront/engine-api/game/GameTypes";
import { GameID } from "@openfront/engine-api/Schemas";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockWorkerInstance = {
  initialize: vi.fn(async () => {}),
  cleanup: vi.fn(),
};

vi.mock("../../src/client/WorkerClient", () => ({
  WorkerClient: vi.fn().mockImplementation(function () {
    return mockWorkerInstance;
  }),
}));

vi.mock("@openfront/engine-lib/game/TerrainMapLoader", () => ({
  loadTerrainMap: vi.fn(async () => ({
    gameMap: {},
    miniGameMap: {},
  })),
}));

vi.mock("@openfront/shared/GameMapLoader", () => ({
  loadMapFiles: vi.fn(async () => ({})),
}));

vi.mock("../../src/client/render/gl", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/client/render/gl")>();
  return {
    ...actual,
    preloadAtlasData: vi.fn(async () => {}),
  };
});

const mockRestoreMaps = vi.fn();
const mockReadHeader = vi.fn();

vi.mock("@openfront/engine/snapshot/GameSnapshot", () => ({
  restoreMapsFromSnapshot: (...args: any[]) => mockRestoreMaps(...args),
  readSnapshotHeader: (...args: any[]) => mockReadHeader(...args),
}));

vi.mock("../../src/client/view/GameView", () => ({
  GameView: class {},
}));

import { createClientGame } from "../../src/client/ClientGameRunner";

describe("createClientGame worker cleanup on restore failure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  const dummyLobby = {
    gameStartInfo: {
      gameID: "game123" as GameID,
      players: [{ clientID: "c1", username: "Player 1" }],
      config: {
        gameMap: GameMapType.World,
        gameType: GameType.Singleplayer,
      },
    },
    playerName: "Player 1",
    resumeSnapshot: new Uint8Array([1, 2, 3]),
  } as any;

  it("calls worker.cleanup() when restoreMapsFromSnapshot throws", async () => {
    mockRestoreMaps.mockImplementationOnce(() => {
      throw new Error("corrupt map data");
    });

    await expect(
      createClientGame(
        dummyLobby,
        "c1",
        {} as any,
        {} as any,
        {} as any,
        null,
        {} as any,
      ),
    ).rejects.toThrow("corrupt map data");

    expect(mockWorkerInstance.cleanup).toHaveBeenCalledTimes(1);
  });

  it("calls worker.cleanup() when readSnapshotHeader throws", async () => {
    mockRestoreMaps.mockImplementationOnce(() => {});
    mockReadHeader.mockImplementationOnce(() => {
      throw new Error("malformed header");
    });

    await expect(
      createClientGame(
        dummyLobby,
        "c1",
        {} as any,
        {} as any,
        {} as any,
        null,
        {} as any,
      ),
    ).rejects.toThrow("malformed header");

    expect(mockWorkerInstance.cleanup).toHaveBeenCalledTimes(1);
  });
});
