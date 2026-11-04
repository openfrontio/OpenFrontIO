// The party socket: a small group of players who stay together across games.
//
// A party lives on one game-server worker, addressed exactly like a game: its
// id is minted by the server with generateGameID, so the client routes to it
// with the same gameWsBase/gameWorkerPath helpers it uses for a lobby, and the
// id doubles as the invite code. The socket only coordinates; it never touches
// a simulation. What the party changes in a game is carried separately: each
// member tells the game server which party they came with (the "party" client
// message), and the game server turns that into a per-game party number that
// team assignment seats together (PlayerInfo.party).
//
// Like every other WebSocket here the frames are zbin, so both ends must run
// the same build.

import {
  ClanTagSchema,
  ID,
  JoinUsernameSchema,
} from "@openfront/engine-api/Schemas";
import { zb } from "@openfront/zbin";
import { z } from "zod";

// Most players a party holds. Large enough for a full Quads team plus a
// couple of friends; the leader can always split a bigger group.
export const PARTY_MAX_SIZE = 8;

// How long a member who dropped (a reload, a cross-host navigation into a
// game) keeps their seat and, for the leader, the lead.
export const PARTY_RESUME_GRACE_MS = 60_000;

const MemberIDSchema = z.string().regex(/^[A-Za-z0-9]{8}$/);
const ResumeTokenSchema = z.string().regex(/^[A-Za-z0-9]{16,32}$/);

//
// Client -> server
//

// First frame on every party socket. No partyID creates a new party with the
// sender as leader; a partyID joins it. resumeToken reclaims the seat the
// sender held before a disconnect (see PARTY_RESUME_GRACE_MS).
export const PartyHelloSchema = z.object({
  type: z.literal("hello"),
  partyID: ID.optional(),
  resumeToken: ResumeTokenSchema.optional(),
  username: JoinUsernameSchema,
  clanTag: ClanTagSchema,
});

// Leader only: the leader just joined this game; every other member follows.
export const PartyFollowRequestSchema = z.object({
  type: z.literal("follow"),
  gameID: ID,
});

// Leader only.
export const PartyKickSchema = z.object({
  type: z.literal("kick"),
  memberID: MemberIDSchema,
});

// Leader only: hand the lead to another member.
export const PartyPromoteSchema = z.object({
  type: z.literal("promote"),
  memberID: MemberIDSchema,
});

// Leave for good, without the resume grace a dropped socket gets.
export const PartyLeaveSchema = z.object({
  type: z.literal("leave"),
});

export const PartyClientMessageSchema = zb.discriminatedUnion("type", [
  PartyHelloSchema,
  PartyFollowRequestSchema,
  PartyKickSchema,
  PartyPromoteSchema,
  PartyLeaveSchema,
]);

export type PartyClientMessage = z.infer<typeof PartyClientMessageSchema>;

//
// Server -> client
//

export const PartyMemberSchema = z.object({
  memberID: MemberIDSchema,
  username: JoinUsernameSchema,
  clanTag: ClanTagSchema,
  // False while a dropped member is inside the resume grace.
  connected: z.boolean(),
});

export type PartyMember = z.infer<typeof PartyMemberSchema>;

// The whole party as the recipient sees it, sent on every change.
export const PartyStateSchema = z.object({
  type: z.literal("state"),
  partyID: ID,
  selfID: MemberIDSchema,
  // The recipient's own token, for reclaiming the seat after a reload.
  resumeToken: ResumeTokenSchema,
  leaderID: MemberIDSchema,
  members: PartyMemberSchema.array().max(PARTY_MAX_SIZE),
  // The game the leader joined last, so a member who (re)connects after the
  // leader moved can still follow.
  gameID: ID.optional(),
});

// The leader joined a game: join it too.
export const PartyFollowSchema = z.object({
  type: z.literal("follow"),
  gameID: ID,
});

export const PartyClosedReasonSchema = z.enum([
  // Removed by the leader.
  "kicked",
  // The party is already at PARTY_MAX_SIZE.
  "full",
  // No party with that id on this server (it emptied, or the code is wrong).
  "not_found",
  // The member left on purpose.
  "left",
  // The first frame was not a valid hello.
  "invalid",
]);

export type PartyClosedReason = z.infer<typeof PartyClosedReasonSchema>;

// Sent right before the server closes the socket, so the client knows not
// to reconnect.
export const PartyClosedSchema = z.object({
  type: z.literal("closed"),
  reason: PartyClosedReasonSchema,
});

export const PartyServerMessageSchema = zb.discriminatedUnion("type", [
  PartyStateSchema,
  PartyFollowSchema,
  PartyClosedSchema,
]);

export type PartyState = z.infer<typeof PartyStateSchema>;
export type PartyServerMessage = z.infer<typeof PartyServerMessageSchema>;

export function encodePartyClientMessage(
  msg: PartyClientMessage,
): Uint8Array<ArrayBuffer> {
  return PartyClientMessageSchema.serialize(msg);
}

export function decodePartyClientMessage(
  bytes: Uint8Array,
): PartyClientMessage {
  return PartyClientMessageSchema.parseBytes(bytes);
}

export function encodePartyServerMessage(
  msg: PartyServerMessage,
): Uint8Array<ArrayBuffer> {
  return PartyServerMessageSchema.serialize(msg);
}

export function decodePartyServerMessage(
  bytes: Uint8Array,
): PartyServerMessage {
  return PartyServerMessageSchema.parseBytes(bytes);
}
