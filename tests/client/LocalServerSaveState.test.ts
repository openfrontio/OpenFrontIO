import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "../../src/core/EventBus";
import type { ClientMessage, GameStartInfo } from "../../src/core/Schemas";

const saveSoloGameMock = vi.fn();
const clearSoloSaveMock = vi.fn();

vi.mock("../../src/client/SinglePlayerSaveManager", () => ({
  saveSoloGame: (...args: any[]) => saveSoloGameMock(...args),
  clearSoloSave: (...args: any[]) => clearSoloSaveMock(...args),
}));

vi.mock("../../src/client/Auth", () => ({
  getAuthHeader: vi.fn(async () => "Bearer test-jwt"),
  getPersistentID: vi.fn(() => "123e4567-e89b-12d3-a456-426614174000"),
}));

vi.mock("../../src/client/Api", () => ({
  getApiBase: vi.fn(() => "https://api.test"),
}));

vi.mock("src/client/ClientEnv", () => ({
  ClientEnv: {
    turnIntervalMs: vi.fn(() => 100),
    gitCommit: vi.fn(() => "DEV"),
  },
}));

import { LocalServer } from "../../src/client/LocalServer";

const CLIENT_ID = "abCD1234";

function makeGameStartInfo(): GameStartInfo {
  return {
    gameID: "gameID12",
    lobbyCreatedAt: 1000,
    config: {
      gameMap: "Africa",
      difficulty: "Medium",
      gameType: "Singleplayer",
      gameMode: "Free For All",
      gameMapSize: "Normal",
      donateGold: false,
      donateTroops: false,
      nations: "default",
      bots: 400,
      infiniteGold: false,
      infiniteTroops: false,
      instantBuild: false,
      randomSpawn: false,
    },
    players: [
      {
        clientID: CLIENT_ID,
        username: "TestUser",
        clanTag: null,
      },
    ],
  } as unknown as GameStartInfo;
}

function makeServer(): LocalServer {
  const server = new LocalServer(
    {
      gameStartInfo: makeGameStartInfo(),
      playerName: "TestUser",
      playerClanTag: null,
    } as any,
    false,
    new EventBus(),
  );
  server.updateCallback(
    () => {},
    () => {},
  );
  return server;
}

describe("LocalServer save state lifecycle", () => {
  beforeEach(() => {
    saveSoloGameMock.mockClear();
    clearSoloSaveMock.mockClear();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 200 })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("saves solo game on endGame when save is enabled and game is ongoing", () => {
    const server = makeServer();
    server.start();

    // Simulate 1 turn so turns.length > 0
    (server as any).turns.push({ turnNumber: 0, intents: [] });

    server.endGame();
    expect(saveSoloGameMock).toHaveBeenCalledTimes(1);
    expect(saveSoloGameMock).toHaveBeenCalledWith(
      expect.objectContaining({ gameID: "gameID12" }),
      expect.any(Array),
    );
  });

  it("does not save on endGame or beforeunload when save is disabled after player death", () => {
    const server = makeServer();
    server.start();
    (server as any).turns.push({ turnNumber: 0, intents: [] });

    server.disableSave();
    server.endGame();

    expect(saveSoloGameMock).not.toHaveBeenCalled();

    // Also trigger beforeunload handler directly
    (server as any).handleBeforeUnload();
    expect(saveSoloGameMock).not.toHaveBeenCalled();
  });

  it("disables save and clears solo save when winner message arrives", () => {
    const server = makeServer();
    server.start();
    (server as any).turns.push({ turnNumber: 0, intents: [] });

    const winnerMsg: ClientMessage = {
      type: "winner",
      winner: ["player", CLIENT_ID],
      allPlayersStats: {},
    };
    server.onMessage(winnerMsg);

    expect(clearSoloSaveMock).toHaveBeenCalledWith("gameID12");

    // Later endGame call must not re-save
    server.endGame();
    expect(saveSoloGameMock).not.toHaveBeenCalled();
  });
});
