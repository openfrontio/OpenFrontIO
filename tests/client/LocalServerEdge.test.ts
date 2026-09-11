import { describe, expect, it, vi } from "vitest";
import { EventBus } from "../../src/core/EventBus";
import type { GameStartInfo, ServerMessage } from "../../src/core/Schemas";

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
        clientID: CLIENT_ID,
        username: "TestUser",
        clanTag: null,
      },
    ],
  } as GameStartInfo;
}

describe("LocalServer edge cases", () => {
  it("refuses to start or archive a lobby without gameStartInfo", () => {
    const server = new LocalServer(
      { playerName: "TestUser", playerClanTag: null } as any,
      false,
      new EventBus(),
    );
    server.updateCallback(
      () => {},
      () => {},
    );

    expect(() => server.start()).toThrow("missing gameStartInfo");
    // endGame -> archiveGameRecord hits the same guard (and stops the
    // turn-check interval start() had already begun).
    expect(() => server.endGame()).toThrow("missing gameStartInfo");
  });

  it("reports a desync when a replay hash disagrees with the archived one", () => {
    const messages: ServerMessage[] = [];
    const gameRecord = {
      turns: [{ turnNumber: 0, intents: [], hash: 1111 }],
      info: { num_turns: 1 },
    };
    const server = new LocalServer(
      {
        gameStartInfo: makeGameStartInfo(),
        gameRecord,
        playerName: "TestUser",
        playerClanTag: null,
      } as any,
      true,
      new EventBus(),
    );
    server.updateCallback(
      () => {},
      (message) => messages.push(message),
    );
    server.start();
    server.endGame(); // stop the turn loop; replays never archive

    server.onMessage({ type: "hash", turnNumber: 0, hash: 2222 });

    expect(messages.filter((m) => m.type === "desync")).toEqual([
      {
        type: "desync",
        turn: 0,
        correctHash: 1111,
        clientsWithCorrectHash: 0,
        totalActiveClients: 1,
        yourHash: 2222,
      },
    ]);

    // A matching hash verifies silently.
    server.onMessage({ type: "hash", turnNumber: 0, hash: 1111 });
    expect(messages.filter((m) => m.type === "desync")).toHaveLength(1);
  });
});
