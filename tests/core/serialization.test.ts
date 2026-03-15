/**
 * Tests for src/core/serialization.ts
 *
 * Covers:
 *  1. isBinaryMessage frame discrimination
 *  2. Primitive encode/decode round-trips
 *  3. Every ServerMessage type round-trip through Zod
 *  4. Key ClientMessage types round-trip through Zod
 *  5. Backward-compatibility: old clients without msgpack flag still parse
 *  6. Size reduction sanity check
 *  7. Buffer / ArrayBuffer / Uint8Array decode compatibility
 */

import { describe, expect, it } from "vitest";
import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
  UnitType,
} from "../../src/core/game/Game";
import {
  ClientHashMessage,
  ClientIntentMessage,
  ClientJoinMessage,
  ClientMessageSchema,
  ServerDesyncMessage,
  ServerLobbyInfoMessage,
  ServerPingMessage,
  ServerStartGameMessage,
  ServerTurnMessage,
  ServerMessageSchema,
} from "../../src/core/Schemas";
import {
  decodeMsgPack,
  encodeMsgPack,
  isBinaryMessage,
} from "../../src/core/serialization";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function roundTrip(obj: unknown): unknown {
  return decodeMsgPack(encodeMsgPack(obj));
}

/** Generate a valid 8-char alphanumeric ID (matches GAME_ID_REGEX) */
function id(s: string): string {
  // pad/truncate to 8 chars
  return s.padEnd(8, "0").slice(0, 8);
}

/** A valid UUID for use as a token (TokenSchema accepts UUID or JWT) */
const VALID_TOKEN = "550e8400-e29b-41d4-a716-446655440000";

// ---------------------------------------------------------------------------
// 1. isBinaryMessage discrimination
// ---------------------------------------------------------------------------

describe("isBinaryMessage", () => {
  it("returns true for Buffer", () => {
    expect(isBinaryMessage(Buffer.from([1, 2, 3]))).toBe(true);
  });

  it("returns true for Uint8Array", () => {
    expect(isBinaryMessage(new Uint8Array([1, 2, 3]))).toBe(true);
  });

  it("returns true for ArrayBuffer", () => {
    expect(isBinaryMessage(new ArrayBuffer(8))).toBe(true);
  });

  it("returns false for string", () => {
    expect(isBinaryMessage('{"type":"ping"}')).toBe(false);
  });

  it("returns false for null", () => {
    expect(isBinaryMessage(null)).toBe(false);
  });

  it("returns false for plain number", () => {
    expect(isBinaryMessage(42)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. Primitive round-trips
// ---------------------------------------------------------------------------

describe("encodeMsgPack / decodeMsgPack — primitives", () => {
  it("round-trips null", () => expect(roundTrip(null)).toBeNull());
  it("round-trips true", () => expect(roundTrip(true)).toBe(true));
  it("round-trips false", () => expect(roundTrip(false)).toBe(false));
  it("round-trips integer", () => expect(roundTrip(42)).toBe(42));
  it("round-trips negative integer", () => expect(roundTrip(-1)).toBe(-1));
  it("round-trips large integer (>2^30)", () =>
    expect(roundTrip(2_147_483_647)).toBe(2_147_483_647));
  it("round-trips negative large int", () =>
    expect(roundTrip(-832_145_623)).toBe(-832_145_623));
  it("round-trips float", () =>
    expect(roundTrip(3.14) as number).toBeCloseTo(3.14));
  it("round-trips empty string", () => expect(roundTrip("")).toBe(""));
  it("round-trips non-ASCII string", () =>
    expect(roundTrip("héllo wörld")).toBe("héllo wörld"));
  it("round-trips array", () => expect(roundTrip([1, 2, 3])).toEqual([1, 2, 3]));
  it("round-trips nested object", () =>
    expect(roundTrip({ a: { b: { c: 99 } } })).toEqual({ a: { b: { c: 99 } } }));
  it("round-trips array of objects", () =>
    expect(roundTrip([{ x: 1 }, { x: 2 }])).toEqual([{ x: 1 }, { x: 2 }]));
});

// ---------------------------------------------------------------------------
// 3. ServerMessage round-trips (Zod-validated)
// ---------------------------------------------------------------------------

describe("ServerMessage round-trips", () => {
  it("ServerPingMessage", () => {
    const msg: ServerPingMessage = { type: "ping" };
    const result = ServerMessageSchema.safeParse(roundTrip(msg));
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(msg);
  });

  it("ServerTurnMessage — empty turn", () => {
    const msg: ServerTurnMessage = {
      type: "turn",
      turn: { turnNumber: 0, intents: [], hash: null },
    };
    const result = ServerMessageSchema.safeParse(roundTrip(msg));
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(msg);
  });

  it("ServerTurnMessage — single attack intent", () => {
    const msg: ServerTurnMessage = {
      type: "turn",
      turn: {
        turnNumber: 142,
        intents: [
          {
            type: "attack",
            targetID: id("player5x"),
            troops: 2500,
            clientID: id("clientab"),
          },
        ],
        hash: null,
      },
    };
    const result = ServerMessageSchema.safeParse(roundTrip(msg));
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(msg);
  });

  it("ServerTurnMessage — mixed intents with hash", () => {
    const msg: ServerTurnMessage = {
      type: "turn",
      turn: {
        turnNumber: 300,
        intents: [
          {
            type: "attack",
            targetID: id("player3a"),
            troops: 1000,
            clientID: id("clientab"),
          },
          { type: "spawn", tile: 450_000, clientID: id("clientcd") },
          {
            type: "emoji",
            recipient: id("player5b"),
            emoji: 0,
            clientID: id("clientef"),
          },
          {
            type: "mark_disconnected",
            clientID: id("clientgh"),
            isDisconnected: true,
          },
        ],
        hash: -832_145_623,
      },
    };
    const result = ServerMessageSchema.safeParse(roundTrip(msg));
    expect(result.success).toBe(true);
    if (result.success) {
      const parsed = result.data as ServerTurnMessage;
      expect(parsed.turn.intents).toHaveLength(4);
      expect(parsed.turn.hash).toBe(-832_145_623);
    }
  });

  it("ServerTurnMessage — 50 attack intents", () => {
    const intents = Array.from({ length: 50 }, (_, i) => ({
      type: "attack" as const,
      targetID: id("tgt" + i.toString().padStart(5, "0")),
      troops: 1000 + i * 13,
      clientID: id("cli" + i.toString().padStart(5, "0")),
    }));
    const msg: ServerTurnMessage = {
      type: "turn",
      turn: { turnNumber: 999, intents, hash: null },
    };
    const result = ServerMessageSchema.safeParse(roundTrip(msg));
    expect(result.success).toBe(true);
    if (result.success) {
      const parsed = result.data as ServerTurnMessage;
      expect(parsed.turn.intents).toHaveLength(50);
    }
  });

  it("ServerDesyncMessage", () => {
    const msg: ServerDesyncMessage = {
      type: "desync",
      turn: 42,
      correctHash: 123_456_789,
      clientsWithCorrectHash: 3,
      totalActiveClients: 4,
      yourHash: 999_888_777,
    };
    const result = ServerMessageSchema.safeParse(roundTrip(msg));
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(msg);
  });

  it("ServerDesyncMessage — null correctHash", () => {
    const msg: ServerDesyncMessage = {
      type: "desync",
      turn: 5,
      correctHash: null,
      clientsWithCorrectHash: 0,
      totalActiveClients: 2,
    };
    const result = ServerMessageSchema.safeParse(roundTrip(msg));
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(msg);
  });

  it("ServerLobbyInfoMessage", () => {
    const msg: ServerLobbyInfoMessage = {
      type: "lobby_info",
      lobby: {
        gameID: id("lobbyabc"),
        clients: [
          { clientID: id("clientaa"), username: "Alice" },
          { clientID: id("clientbb"), username: "Bob" },
        ],
        serverTime: 1_741_234_567_890,
      },
      myClientID: id("clientaa"),
    };
    const result = ServerMessageSchema.safeParse(roundTrip(msg));
    expect(result.success).toBe(true);
  });

  it("ServerStartGameMessage — minimal", () => {
    const msg: ServerStartGameMessage = {
      type: "start",
      turns: [],
      gameStartInfo: {
        gameID: id("game0001"),
        lobbyCreatedAt: 1_741_234_567_890,
        config: {
          gameType: GameType.Public,
          gameMap: GameMapType.World,
          gameMapSize: GameMapSize.Normal,
          difficulty: Difficulty.Hard,
          bots: 2,
          nations: "default" as const,
          disabledUnits: [],
          infiniteGold: false,
          infiniteTroops: false,
          donateGold: true,
          donateTroops: true,
          instantBuild: false,
          randomSpawn: true,
          spawnImmunityDuration: 180,
          gameMode: GameMode.FFA,
          disableAlliances: false,
        },
        players: [
          {
            clientID: id("playerAA"),
            username: "TestPlayer",
            isLobbyCreator: true,
          },
        ],
      },
      myClientID: id("playerAA"),
      lobbyCreatedAt: 1_741_234_567_890,
    };
    const result = ServerMessageSchema.safeParse(roundTrip(msg));
    expect(result.success).toBe(true);
    if (result.success) {
      const parsed = result.data as ServerStartGameMessage;
      expect(parsed.gameStartInfo.gameID).toBe(id("game0001"));
      expect(parsed.gameStartInfo.players[0].username).toBe("TestPlayer");
    }
  });
});

// ---------------------------------------------------------------------------
// 4. ClientMessage round-trips (Zod-validated)
// ---------------------------------------------------------------------------

describe("ClientMessage round-trips", () => {
  it("ClientPingMessage", () => {
    const msg = { type: "ping" as const };
    const result = ClientMessageSchema.safeParse(roundTrip(msg));
    expect(result.success).toBe(true);
  });

  it("ClientIntentMessage — attack", () => {
    const msg: ClientIntentMessage = {
      type: "intent",
      intent: {
        type: "attack",
        targetID: id("target12"),
        troops: 1_500,
      },
    };
    const result = ClientMessageSchema.safeParse(roundTrip(msg));
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(msg);
  });

  it("ClientIntentMessage — spawn", () => {
    const msg: ClientIntentMessage = {
      type: "intent",
      intent: { type: "spawn", tile: 512_000 },
    };
    const result = ClientMessageSchema.safeParse(roundTrip(msg));
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(msg);
  });

  it("ClientIntentMessage — emoji to specific player", () => {
    const msg: ClientIntentMessage = {
      type: "intent",
      intent: {
        type: "emoji",
        recipient: id("player5x"),
        emoji: 0,
      },
    };
    const result = ClientMessageSchema.safeParse(roundTrip(msg));
    expect(result.success).toBe(true);
  });

  it("ClientIntentMessage — build_unit", () => {
    const msg: ClientIntentMessage = {
      type: "intent",
      intent: { type: "build_unit", unit: UnitType.City, tile: 123_456 },
    };
    const result = ClientMessageSchema.safeParse(roundTrip(msg));
    expect(result.success).toBe(true);
  });

  it("ClientHashMessage", () => {
    const msg: ClientHashMessage = {
      type: "hash",
      turnNumber: 200,
      hash: -1_234_567_890,
    };
    const result = ClientMessageSchema.safeParse(roundTrip(msg));
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(msg);
  });

  it("ClientJoinMessage with msgpack: true (new client)", () => {
    const msg: ClientJoinMessage = {
      type: "join",
      gameID: id("game0001"),
      username: "TestUser",
      token: VALID_TOKEN,
      turnstileToken: null,
      msgpack: true,
    };
    const result = ClientMessageSchema.safeParse(roundTrip(msg));
    expect(result.success).toBe(true);
    if (result.success) {
      const parsed = result.data as ClientJoinMessage;
      expect(parsed.msgpack).toBe(true);
    }
  });

  it("ClientJoinMessage without msgpack field (backward-compat old client)", () => {
    const msg = {
      type: "join" as const,
      gameID: id("game0001"),
      username: "OldClient",
      token: VALID_TOKEN,
      turnstileToken: null,
      // No msgpack field — simulates an old client payload
    };
    const result = ClientMessageSchema.safeParse(roundTrip(msg));
    expect(result.success).toBe(true);
    if (result.success) {
      const parsed = result.data as ClientJoinMessage;
      // msgpack should be absent/undefined — default JSON fallback path
      expect(parsed.msgpack).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Output type verification — @msgpack/msgpack returns plain objects
// ---------------------------------------------------------------------------

describe("Zod compatibility — plain object output", () => {
  it("decoded map fields are plain objects, not ES6 Map", () => {
    const obj = { nested: { foo: "bar" } };
    const decoded = decodeMsgPack(encodeMsgPack(obj));
    // Must be a plain object (not a Map) for Zod to validate
    expect(decoded).toEqual(obj);
    expect(decoded).not.toBeInstanceOf(Map);
    expect((decoded as Record<string, unknown>).nested).not.toBeInstanceOf(Map);
  });
});

// ---------------------------------------------------------------------------
// 6. Size reduction
// ---------------------------------------------------------------------------

describe("MessagePack size reduction", () => {
  it("is smaller than JSON for a 20-intent ServerTurnMessage (>15%)", () => {
    const msg: ServerTurnMessage = {
      type: "turn",
      turn: {
        turnNumber: 142,
        intents: Array.from({ length: 20 }, (_, i) => ({
          type: "attack" as const,
          targetID: id("tgt" + i.toString().padStart(5, "0")),
          troops: 1200 + i * 37,
          clientID: id("cli" + i.toString().padStart(5, "0")),
        })),
        hash: null,
      },
    };
    const jsonBytes = new TextEncoder().encode(JSON.stringify(msg)).byteLength;
    const mpBytes = encodeMsgPack(msg).byteLength;
    expect(mpBytes).toBeLessThan(jsonBytes * 0.85);
  });

  it("encodeMsgPack returns Uint8Array", () => {
    expect(encodeMsgPack({ type: "ping" })).toBeInstanceOf(Uint8Array);
  });
});

// ---------------------------------------------------------------------------
// 7. Binary input compatibility (ArrayBuffer, Buffer, Uint8Array)
// ---------------------------------------------------------------------------

describe("decodeMsgPack input type compatibility", () => {
  const original = { type: "ping" };

  it("accepts Uint8Array", () => {
    const enc = encodeMsgPack(original);
    expect(decodeMsgPack(enc)).toEqual(original);
  });

  it("accepts ArrayBuffer", () => {
    const enc = encodeMsgPack(original);
    const ab = enc.buffer.slice(enc.byteOffset, enc.byteOffset + enc.byteLength);
    expect(decodeMsgPack(ab)).toEqual(original);
  });

  it("accepts Node.js Buffer (subclass of Uint8Array)", () => {
    const enc = encodeMsgPack(original);
    const buf = Buffer.from(enc);
    expect(decodeMsgPack(buf)).toEqual(original);
  });
});
