// The two rules for the per-game grouping token on the client: where it comes
// from, and how it joins a presence payload.
//
// They live here rather than inline in ClientGameRunner and Main because both
// are unreachable from a test — one drags in WebGL, the other the whole boot
// sequence — and these are precisely the parts that must not drift: a token
// picked up from only one of its two carrier messages silently leaves late
// joiners out of the group, and one merged in unconditionally would publish
// `groupToken: undefined` for every singleplayer game.

import type { ServerMessage } from "../core/Schemas";
import type { PresencePayload } from "./DesktopPresence";

// The token this server message carries, if it carries one.
//
// Two messages carry it, and every participant of a server game sees at least
// one: lobby_info reaches everyone present during the lobby phase (players and
// spectators alike, once a second), and the start message reaches everyone at
// start plus anyone who joins afterwards. Every other message type, and any
// message from a game with no server behind it (singleplayer, replays), has
// none.
export function groupTokenOf(message: ServerMessage): string | undefined {
  if (message.type === "lobby_info" || message.type === "start") {
    return message.groupToken;
  }
  return undefined;
}

// Attach the token to a presence payload, or leave the payload alone.
//
// Omitting the key entirely rather than setting it to undefined matters: the
// shell diffs payloads, and `{ groupToken: undefined }` is not the same object
// as one without the key.
export function withGroupToken(
  payload: PresencePayload,
  groupToken: string | undefined,
): PresencePayload {
  return groupToken === undefined ? payload : { ...payload, groupToken };
}
