import { afterEach, describe, expect, it, vi } from "vitest";
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

import { ReplaySpeedChangeEvent } from "../../src/client/InputHandler";
import { LocalServer } from "../../src/client/LocalServer";
import { ReplaySpeedMultiplier } from "../../src/client/utilities/ReplaySpeedMultiplier";

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

describe("LocalServer replay speed", () => {
  let server: LocalServer;

  afterEach(() => {
    clearInterval((server as any).turnCheckInterval);
    vi.useRealTimers();
  });

  it("emitting ReplaySpeedChangeEvent stretches the turn interval", () => {
    vi.useFakeTimers();
    const bus = new EventBus();
    server = new LocalServer(
      {
        gameID: "gameID12",
        playerName: "TestUser",
        playerClanTag: null,
        gameStartInfo: makeGameStartInfo(),
      } as any,
      false,
      bus,
    );
    let turns = 0;
    server.updateCallback(
      () => {},
      (msg: ServerMessage) => {
        if (msg.type === "turn") {
          turns++;
          // Ack immediately so the backlog gate never throttles pacing.
          server.turnComplete();
        }
      },
    );
    server.start();

    vi.advanceTimersByTime(1000);
    const atNormalSpeed = turns;
    // 100ms interval at the default 1x multiplier: ~10 turns a second.
    expect(atNormalSpeed).toBeGreaterThanOrEqual(4);

    bus.emit(new ReplaySpeedChangeEvent(ReplaySpeedMultiplier.slow));
    turns = 0;
    vi.advanceTimersByTime(1000);

    // The 2x interval multiplier must roughly halve the cadence.
    expect(turns).toBeGreaterThan(0);
    expect(turns).toBeLessThan(atNormalSpeed);
  });
});
