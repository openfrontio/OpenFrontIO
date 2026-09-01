// Helpers for tests that drive the game WebSocket, which carries zbin binary
// frames rather than JSON (see src/core/ZbinWire.ts).

import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
} from "../../src/core/game/Game";
import {
  ClientMessage,
  GameConfig,
  PublicLobbyMessage,
  PublicLobbyMessageSchema,
  ServerMessage,
  ServerMessageSchema,
} from "../../src/core/Schemas";
import {
  encodeClientMessage,
  encodeLobbyMessage,
} from "../../src/core/ZbinWire";
import { ZbContext } from "../../zbin";

// A frame as a client would put it on the wire. Tests hand these to the
// server's "message" listener.
export function clientFrame(msg: ClientMessage): Buffer {
  return Buffer.from(encodeClientMessage(msg, undefined));
}

// Every server message a mocked `ws.send` captured, decoded back to objects.
//
// Without `ctx`, frames are decoded with no dictionary context, which is what
// a peer that has not yet seen the start message does; ids then ride inline.
// Once the game has started the server dictionary-encodes player ids, so a
// test reading post-start frames passes the same context the server built
// (createGameWireContext over the start-info players). Validation is skipped:
// the question these helpers answer is "what did the server put on the wire",
// and server-test fixtures routinely use placeholder clientIDs ("creator-cid")
// that were never ID-schema-valid. Structural corruption still throws — that
// is the decoder, not the validator.
export function sentServerMessages(
  ws: { send: { mock: { calls: unknown[][] } } },
  ctx?: ZbContext,
): ServerMessage[] {
  return ws.send.mock.calls.map(([frame]) =>
    decodeSentServerMessage(frame, ctx),
  );
}

export function decodeSentServerMessage(
  frame: unknown,
  ctx?: ZbContext,
): ServerMessage {
  return ServerMessageSchema.decodeBytesUnvalidated(frame as Uint8Array, ctx);
}

export function lobbyFrame(msg: PublicLobbyMessage): Uint8Array {
  return encodeLobbyMessage(msg);
}

export function decodeSentLobbyMessage(frame: unknown): PublicLobbyMessage {
  return PublicLobbyMessageSchema.decodeBytesUnvalidated(frame as Uint8Array);
}

// A complete, schema-valid GameConfig. Server tests used to get away with
// `{ gameType } as any` because JSON.stringify happily serialized a partial
// config; the binary encoder rejects a missing required field, so fixtures now
// have to be whole.
export function testGameConfig(
  overrides: Partial<GameConfig> = {},
): GameConfig {
  return {
    gameMap: GameMapType.World,
    gameMapSize: GameMapSize.Normal,
    difficulty: Difficulty.Medium,
    gameType: GameType.Private,
    gameMode: GameMode.FFA,
    donateGold: true,
    donateTroops: true,
    nations: "default",
    bots: 0,
    infiniteGold: false,
    infiniteTroops: false,
    instantBuild: false,
    randomSpawn: false,
    ...overrides,
  };
}
