import { EventEmitter } from "events";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/Archive", () => ({
  archive: vi.fn(),
  finalizeGameRecord: vi.fn((record) => record),
}));

import {
  binaryContextFromGameStartInfo,
  decodeBinaryServerGameplayMessage,
  encodeBinaryClientGameplayMessage,
} from "../../src/core/BinaryCodec";
import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
} from "../../src/core/game/Game";
import type { GameConfig } from "../../src/core/Schemas";
import { Client } from "../../src/server/Client";
import { GameServer } from "../../src/server/GameServer";

class MockWebSocket extends EventEmitter {
  public readonly sent: Array<string | Uint8Array> = [];
  public readyState = 1;

  send(message: string | Uint8Array) {
    this.sent.push(message);
  }

  close(_code?: number, _reason?: string) {
    this.readyState = 3;
    this.emit("close");
  }
}

function createMockLogger() {
  return {
    child: vi.fn().mockReturnThis(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function createGameConfig(): GameConfig {
  return {
    donateGold: false,
    donateTroops: false,
    gameMap: GameMapType.World,
    gameType: GameType.Private,
    gameMapSize: GameMapSize.Normal,
    difficulty: Difficulty.Easy,
    nations: "default",
    infiniteGold: false,
    infiniteTroops: false,
    instantBuild: false,
    randomSpawn: false,
    gameMode: GameMode.FFA,
    bots: 0,
    disabledUnits: [],
  };
}

function createClient(
  clientID: string,
  persistentID: string,
  username: string,
) {
  const ws = new MockWebSocket();
  const client = new Client(
    clientID as any,
    persistentID,
    null,
    undefined,
    undefined,
    "127.0.0.1",
    username,
    null,
    ws as any,
    undefined,
  );
  return { client, ws };
}

describe("GameServer binary gameplay protocol", () => {
  it("keeps start JSON and emits live turns as binary", async () => {
    const logger = createMockLogger();
    const game = new GameServer(
      "TEST0001",
      logger as any,
      Date.now(),
      {
        turnIntervalMs: () => 100,
        env: () => 0,
      } as any,
      createGameConfig(),
    );

    const clientA = createClient(
      "P0000001",
      "11111111-1111-4111-8111-111111111111",
      "Alice",
    );
    const clientB = createClient(
      "P0000002",
      "22222222-2222-4222-8222-222222222222",
      "Bob",
    );

    expect(game.joinClient(clientA.client)).toBe("joined");
    expect(game.joinClient(clientB.client)).toBe("joined");

    game.start();

    const startPayload = clientA.ws.sent.find(
      (message): message is string =>
        typeof message === "string" && message.includes('"type":"start"'),
    );
    expect(startPayload).toBeDefined();

    const binaryContext = binaryContextFromGameStartInfo(
      JSON.parse(startPayload!).gameStartInfo,
    );
    const spawnMessage = encodeBinaryClientGameplayMessage(
      {
        type: "intent",
        intent: {
          type: "spawn",
          tile: 123,
        },
      },
      binaryContext,
    );

    clientA.ws.emit("message", spawnMessage, true);
    (game as any).endTurn();

    const binaryTurn = clientA.ws.sent.find(
      (message): message is Uint8Array =>
        message instanceof Uint8Array && message[1] === 2,
    );
    expect(binaryTurn).toBeDefined();

    const decodedTurn = decodeBinaryServerGameplayMessage(
      binaryTurn!,
      binaryContext,
    );
    expect(decodedTurn.type).toBe("turn");
    if (decodedTurn.type !== "turn") {
      throw new Error("Expected binary turn message");
    }
    expect(decodedTurn.turn.intents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "spawn",
          tile: 123,
          clientID: "P0000001",
        }),
      ]),
    );
  });

  it("accepts JSON rejoin after start and responds with JSON start", () => {
    const logger = createMockLogger();
    const game = new GameServer(
      "TEST0002",
      logger as any,
      Date.now(),
      {
        turnIntervalMs: () => 100,
        env: () => 0,
      } as any,
      createGameConfig(),
    );

    const clientA = createClient(
      "P0000001",
      "33333333-3333-4333-8333-333333333333",
      "Alice",
    );
    expect(game.joinClient(clientA.client)).toBe("joined");
    game.start();

    clientA.ws.sent.length = 0;
    clientA.ws.emit(
      "message",
      JSON.stringify({
        type: "rejoin",
        gameID: "TEST0002",
        lastTurn: 0,
        token: "33333333-3333-4333-8333-333333333333",
      }),
      false,
    );

    expect(clientA.ws.sent).toHaveLength(1);
    expect(typeof clientA.ws.sent[0]).toBe("string");
    expect(clientA.ws.sent[0]).toContain('"type":"start"');
  });
});
