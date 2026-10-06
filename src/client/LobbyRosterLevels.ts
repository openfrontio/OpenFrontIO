import { ClientID, GameID } from "@openfront/engine-api/Schemas";
import { LevelBadge, unpackLevelBadge } from "@openfront/shared/LevelBadgeWire";
import { ClientInfo } from "@openfront/shared/WireSchemas";
import {
  ownHiddenLevelBadge,
  refreshOwnHiddenLevelBadge,
} from "./OwnLevelBadge";

// Level badges from the last lobby roster this tab was sent, so in-game UI
// can show them after the lobby is gone. The roster (lobby_info) only flows
// while the game is in its lobby, and the start message carries no levels,
// so this is the only copy the client keeps. Keyed by clientID, which is
// the same id PlayerView.clientID() returns in-game.
//
// Limits, all of which simply mean "no badge": a player who joined in the
// last broadcast interval before start, and anyone viewed from a tab that
// never saw the lobby (a late-joining spectator, or a page refresh mid-game,
// which rejoins straight into the game).
//
// Per-viewer like the roster itself: anonymized entries arrive without a
// badge, so nothing here can reveal one.
//
// Kept in wire form (packLevelBadge) — a roster arrives every second, a badge
// is read only when a panel opens — and unpacked on read.

let rosterGameID: GameID | null = null;
let badges = new Map<ClientID, number>();
// The viewer's own clientID when they were on that roster.
let rosterSelf: ClientID | null = null;

export function rememberLobbyRoster(
  gameID: GameID,
  clients: readonly ClientInfo[] | undefined,
  myClientID?: ClientID,
): void {
  const next = new Map<ClientID, number>();
  let self: ClientID | null = null;
  for (const c of clients ?? []) {
    if (c.levelBadge !== undefined) next.set(c.clientID, c.levelBadge);
    if (c.clientID === myClientID) self = myClientID;
  }
  if (gameID !== rosterGameID) {
    // Once per game: the viewer's own badge if they hide their level (their
    // roster entry carries none). From the memoised /users/@me.
    void refreshOwnHiddenLevelBadge();
  }
  rosterGameID = gameID;
  badges = next;
  rosterSelf = self;
}

// The player's badge in game `gameID`, or undefined when they have none (a
// guest, an anonymized name, progression off, their level hidden, a value out
// of range) or this tab never saw them in that game's lobby. The viewer's own
// badge still shows while they hide their level: it comes from their own
// /users/@me then.
export function lobbyLevelBadge(
  gameID: GameID,
  clientID: ClientID | null,
): LevelBadge | undefined {
  if (clientID === null || gameID !== rosterGameID) return undefined;
  return (
    unpackLevelBadge(badges.get(clientID)) ??
    (clientID === rosterSelf ? ownHiddenLevelBadge() : undefined)
  );
}
