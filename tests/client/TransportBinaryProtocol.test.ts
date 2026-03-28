import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SendAttackIntentEvent,
  SendHashEvent,
  Transport,
} from "../../src/client/Transport";
import { decodeBinaryClientGameplayMessage } from "../../src/core/BinaryCodec";
import { EventBus } from "../../src/core/EventBus";
import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
} from "../../src/core/game/Game";
import { binaryContextFromGameStartInfo } from "../../src/core/protocol/BinaryRuntime";
import type {
  GameConfig,
  ServerStartGameMessage,
} from "../../src/core/Schemas";

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  static instances: FakeWebSocket[] = [];

  public binaryType = "blob";
  public readyState = FakeWebSocket.OPEN;
  public onopen: (() => void) | null = null;
  public onmessage: ((event: MessageEvent) => void) | null = null;
  public onclose: ((event: CloseEvent) => void) | null = null;
  public onerror: ((event: Event) => void) | null = null;
  public readonly sent: Array<string | Uint8Array> = [];

  constructor(public readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  send(message: string | ArrayBufferLike | Blob | ArrayBufferView) {
    if (message instanceof Uint8Array) {
      this.sent.push(message);
      return;
    }
    if (ArrayBuffer.isView(message)) {
      this.sent.push(
        new Uint8Array(
          message.buffer.slice(
            message.byteOffset,
            message.byteOffset + message.byteLength,
          ),
        ),
      );
      return;
    }
    if (typeof message === "string") {
      this.sent.push(message);
      return;
    }
    throw new Error(`Unsupported fake WebSocket payload: ${typeof message}`);
  }

  close(code = 1000, reason = "") {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code, reason } as CloseEvent);
  }

  emitOpen() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  emitMessage(data: string | ArrayBuffer) {
    this.onmessage?.({ data } as MessageEvent);
  }
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

function createStartMessage(): ServerStartGameMessage {
  return {
    type: "start",
    turns: [],
    lobbyCreatedAt: 1,
    myClientID: "P0000001",
    gameStartInfo: {
      gameID: "TEST0001",
      lobbyCreatedAt: 1,
      config: createGameConfig(),
      players: [
        {
          clientID: "P0000001",
          username: "Alice",
          clanTag: null,
        },
        {
          clientID: "P0000002",
          username: "Bob",
          clanTag: null,
        },
      ],
    },
  };
}

describe("Transport binary gameplay reconnect handling", () => {
  const originalWebSocket = globalThis.WebSocket;

  beforeEach(() => {
    vi.useFakeTimers();
    FakeWebSocket.instances = [];
    vi.stubGlobal("WebSocket", FakeWebSocket as unknown as typeof WebSocket);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    globalThis.WebSocket = originalWebSocket;
    window.WebSocket = originalWebSocket;
  });

  it("queues gameplay messages during reconnect and flushes them as binary after start", () => {
    const eventBus = new EventBus();
    const onmessage = vi.fn();
    const transport = new Transport(
      {
        serverConfig: {
          workerPath: () => "w0",
        },
        cosmetics: {},
        playerName: "Alice",
        playerClanTag: null,
        gameID: "TEST0001",
        turnstileToken: null,
      } as any,
      eventBus,
    );
    const startMessage = createStartMessage();
    const binaryContext = binaryContextFromGameStartInfo(
      startMessage.gameStartInfo,
    );

    transport.connect(() => {}, onmessage);
    const firstSocket = FakeWebSocket.instances[0]!;
    firstSocket.emitOpen();
    firstSocket.emitMessage(JSON.stringify(startMessage));

    transport.reconnect();
    const reconnectSocket = FakeWebSocket.instances[1]!;
    reconnectSocket.emitOpen();

    eventBus.emit(new SendAttackIntentEvent("P0000002", 12));
    eventBus.emit(new SendHashEvent(7, 1234));
    vi.advanceTimersByTime(5_000);

    expect(reconnectSocket.sent).toEqual([]);

    reconnectSocket.emitMessage(JSON.stringify(startMessage));

    const decodedMessages = reconnectSocket.sent.map((payload) =>
      decodeBinaryClientGameplayMessage(payload as Uint8Array, binaryContext),
    );
    expect(decodedMessages).toEqual([
      {
        type: "intent",
        intent: {
          type: "attack",
          targetID: "P0000002",
          troops: 12,
        },
      },
      {
        type: "hash",
        turnNumber: 7,
        hash: 1234,
      },
      {
        type: "ping",
      },
    ]);
    expect(onmessage).toHaveBeenCalledTimes(2);
  });
});
