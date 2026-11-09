import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
} from "@openfront/engine-api/game/GameTypes";
import type { SnapshotHeader } from "@openfront/engine-api/game/SnapshotHeader";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/Cosmetics", () => ({
  getPlayerCosmetics: vi.fn(async () => ({})),
  prewarmCosmetics: vi.fn(async () => {}),
}));

vi.mock("../../src/client/CrazyGamesSDK", () => ({
  crazyGamesSDK: {
    isOnCrazyGames: vi.fn(() => false),
    requestMidgameAd: vi.fn(async () => {}),
  },
}));

vi.mock("../../src/client/TerrainMapFileLoader", () => ({
  terrainMapFileLoader: { getMapData: vi.fn() },
}));

const api = vi.hoisted(() => ({
  downloadSavedGame: vi.fn(),
}));
vi.mock("../../src/client/SavedGamesApi", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  downloadSavedGame: api.downloadSavedGame,
}));

const worker = vi.hoisted(() => ({ readSnapshotHeader: vi.fn() }));
vi.mock("../../src/client/WorkerClient", () => ({
  readSnapshotHeader: worker.readSnapshotHeader,
}));

const dialogs = vi.hoisted(() => ({
  showInGameAlert: vi.fn(async () => true),
  showInGameConfirm: vi.fn(async () => true),
}));
vi.mock("../../src/client/InGameModal", () => dialogs);

// Side-effect import so the custom element registers.
import "../../src/client/SinglePlayerModal";

const SNAPSHOT = new Uint8Array([7, 7, 7]);
const SAVE_ID = "abcdefghijklmnopqrstuv";

function header(overrides: Partial<SnapshotHeader> = {}): SnapshotHeader {
  return {
    format: 1,
    gitCommit: "abc123",
    gameID: "origGame",
    tick: 4200,
    gameConfig: {
      gameMap: GameMapType.Africa,
      difficulty: Difficulty.Hard,
      donateGold: false,
      donateTroops: false,
      gameType: GameType.Singleplayer,
      gameMode: GameMode.FFA,
      gameMapSize: GameMapSize.Normal,
      nations: "default",
      bots: 100,
      infiniteGold: false,
      infiniteTroops: false,
      instantBuild: false,
      randomSpawn: false,
    },
    humans: [{ clientID: "SAVEDCID", name: "TheSaver" }],
    ...overrides,
  } as SnapshotHeader;
}

function createModal(): any {
  const modal = document.createElement("single-player-modal") as any;
  const events: any[] = [];
  modal.addEventListener("join-lobby", (e: Event) =>
    events.push((e as CustomEvent).detail),
  );
  return { modal, events };
}

describe("SinglePlayerModal saved games", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.downloadSavedGame.mockResolvedValue(SNAPSHOT);
    worker.readSnapshotHeader.mockResolvedValue(header());
  });

  it("resumes a shared save as its own player, on a fresh game id", async () => {
    const { modal, events } = createModal();

    await modal.startSavedGame(SAVE_ID, true);

    expect(api.downloadSavedGame).toHaveBeenCalledWith(SAVE_ID, true);
    expect(worker.readSnapshotHeader).toHaveBeenCalledWith(SNAPSHOT);
    expect(events).toHaveLength(1);
    const detail = events[0];
    expect(detail.source).toBe("singleplayer");
    expect(detail.snapshot).toBe(SNAPSHOT);
    expect(detail.gameID).not.toBe("origGame");
    expect(detail.gameStartInfo.gameID).toBe(detail.gameID);
    // The engine matches intents to players by clientID.
    expect(detail.gameStartInfo.players).toHaveLength(1);
    expect(detail.gameStartInfo.players[0].clientID).toBe("SAVEDCID");
    expect(detail.gameStartInfo.config).toEqual(header().gameConfig);
    expect(dialogs.showInGameAlert).not.toHaveBeenCalled();
  });

  it("downloads the player's own save through their account", async () => {
    const { modal, events } = createModal();
    await modal.startSavedGame(SAVE_ID, false);
    expect(api.downloadSavedGame).toHaveBeenCalledWith(SAVE_ID, false);
    expect(events).toHaveLength(1);
  });

  it("refuses a save that isn't a singleplayer game", async () => {
    worker.readSnapshotHeader.mockResolvedValue(
      header({
        gameConfig: { ...header().gameConfig, gameType: GameType.Private },
      }),
    );
    const { modal, events } = createModal();

    await modal.startSavedGame(SAVE_ID, true);

    expect(events).toEqual([]);
    expect(dialogs.showInGameAlert).toHaveBeenCalledWith(
      "saved_games.error.not_singleplayer",
    );
    // A failed start hands the Start button back.
    expect(modal.starting).toBe(false);
  });

  it("says so when the save is gone", async () => {
    api.downloadSavedGame.mockResolvedValue("not_found");
    const { modal, events } = createModal();

    await modal.startSavedGame(SAVE_ID, true);

    expect(events).toEqual([]);
    expect(worker.readSnapshotHeader).not.toHaveBeenCalled();
    expect(dialogs.showInGameAlert).toHaveBeenCalledWith(
      "saved_games.error.not_found",
    );
  });

  it("says so when this build can't read the save", async () => {
    worker.readSnapshotHeader.mockRejectedValue(new Error("format 9"));
    const { modal, events } = createModal();

    await modal.startSavedGame(SAVE_ID, true);

    expect(events).toEqual([]);
    expect(dialogs.showInGameAlert).toHaveBeenCalledWith(
      "saved_games.error.unreadable",
    );
  });

  it("offers the save a link names, and ignores one that isn't a save id", () => {
    const { modal } = createModal();
    modal.onOpen({ save: SAVE_ID });
    expect(modal.sharedSaveId).toBe(SAVE_ID);

    modal.onOpen({ save: "../../users/@me" });
    expect(modal.sharedSaveId).toBeNull();

    modal.onOpen();
    expect(modal.sharedSaveId).toBeNull();
  });
});
