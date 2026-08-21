// Binary framing for the game and lobby WebSockets, built on the zbin library
// (/zbin). Every frame on both sockets is a zbin payload — there is no JSON
// fallback, no negotiation, and no version byte.
//
// That is only safe because OpenFront ships the client and the server from one
// build: a zbin payload is a bare positional byte stream, so peers built from
// different commits mis-decode each other (see zbin/README.md, "Compatibility").
// If the client and the server ever stop being pinned together, a version has
// to be negotiated before the first frame.
//
// HTTP stays JSON everywhere — the API worker is closed-source and the
// archived game records are read by tools that expect JSON.
//
// The clientID dictionary is seeded identically on both sides from
// GameStartInfo.players (array order matters — it IS the wire contract). The
// roster is fixed at game start and the start message always precedes the
// first dictionary-encoded frame, so the tables cannot diverge. The start
// message itself is encoded WITHOUT a context, because it is what seeds the
// receiver's table; ids outside the roster (e.g. ADMIN_BOT_CLIENT_ID) ride the
// escape path inline.

import { ZbContext } from "../../zbin";
import {
  CLIENT_ID_MAPPING,
  ClientMessage,
  ClientMessageSchema,
  PublicLobbyMessage,
  PublicLobbyMessageSchema,
  ServerMessage,
  ServerMessageSchema,
} from "./Schemas";

// One byte per id needs the table to stay under the escape byte; a game holds
// far fewer players than this.
const MAX_MAPPED_CLIENTS = 250;

export function createGameWireContext(
  players: ReadonlyArray<{ clientID: string }>,
): ZbContext {
  const ctx = new ZbContext();
  ctx.mapping(CLIENT_ID_MAPPING, { max: MAX_MAPPED_CLIENTS });
  for (const p of players.slice(0, MAX_MAPPED_CLIENTS)) {
    ctx.assign(CLIENT_ID_MAPPING, p.clientID);
  }
  return ctx;
}

export function encodeServerMessage(
  msg: ServerMessage,
  ctx: ZbContext | undefined,
): Uint8Array<ArrayBuffer> {
  // The start message carries the roster the receiver seeds its table from, so
  // it cannot itself be dictionary-encoded.
  return ServerMessageSchema.serialize(
    msg,
    msg.type === "start" ? undefined : ctx,
  );
}

// Decode + full zod validation; throws ZbDecodeError / ZodError on bad input.
export function decodeServerMessage(
  bytes: Uint8Array,
  ctx: ZbContext | undefined,
): ServerMessage {
  return ServerMessageSchema.parseBytes(bytes, ctx);
}

export function encodeClientMessage(
  msg: ClientMessage,
  ctx: ZbContext | undefined,
): Uint8Array<ArrayBuffer> {
  return ClientMessageSchema.serialize(msg, ctx);
}

export function decodeClientMessage(
  bytes: Uint8Array,
  ctx: ZbContext | undefined,
): ClientMessage {
  return ClientMessageSchema.parseBytes(bytes, ctx);
}

// The lobby list socket is broadcast-only and carries no player ids, so it
// needs no dictionary context.
export function encodeLobbyMessage(
  msg: PublicLobbyMessage,
): Uint8Array<ArrayBuffer> {
  return PublicLobbyMessageSchema.serialize(msg);
}

export function decodeLobbyMessage(bytes: Uint8Array): PublicLobbyMessage {
  return PublicLobbyMessageSchema.parseBytes(bytes);
}
