// The rules for the per-game grouping token on the client: where it comes
// from, what may be logged of the message that carried it, how often it is
// worth telling the shell, and how it joins a presence payload.
//
// They live here rather than inline in ClientGameRunner and Main because both
// are unreachable from a test — one drags in WebGL, the other the whole boot
// sequence — and these are precisely the parts that must not drift: a token
// picked up from only one of its two carrier messages silently leaves late
// joiners out of the group, one merged in unconditionally would publish
// `groupToken: undefined` for every singleplayer game, and a strip that only
// exists as a line inside a console.log call is a strip nothing defends.

import type { ServerMessage, ServerStartGameMessage } from "../core/Schemas";
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

// The start message as it is safe to log: everything except the token.
//
// ClientGameRunner dumps the whole start message to the console, and players
// paste consoles into bug reports and Discord threads. Every other field in it
// is already public to that player; the token is the one that is not, and a
// log line is a copy of it in a file, a log shipper and a support ticket.
export function loggableStartMessage(
  message: ServerStartGameMessage,
): Record<string, unknown> {
  const loggable: Record<string, unknown> = { ...message };
  delete loggable.groupToken;
  return loggable;
}

// The token seen so far, and whether a newly arrived one is worth acting on.
//
// lobby_info arrives once a second for the whole lobby phase and carries the
// token every time, but the token never changes within a game. Re-emitting
// presence on each one would double the presence IPC rate for no new
// information — and worse, this event is handled before the LobbyInfoEvent
// from the same frame, so the extra emit would publish the previous tick's
// roster. Only a genuine change is worth telling the shell about.
//
// `clear()` and the token live together so the two Main reset paths (leaving
// to the menu, joining a different game) cannot forget one: a tracker that
// remembered a token across a reset would drop the next game's identical
// token as a duplicate.
export class GroupTokenTracker {
  private token: string | undefined;

  current(): string | undefined {
    return this.token;
  }

  // True when this call changed the tracked token, i.e. the caller should
  // re-emit presence.
  accept(token: string): boolean {
    if (this.token === token) return false;
    this.token = token;
    return true;
  }

  clear(): void {
    this.token = undefined;
  }
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
