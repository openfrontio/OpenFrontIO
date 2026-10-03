import { ClientID, ClientInfo, GameID, LevelBadge } from "../core/Schemas";

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

let rosterGameID: GameID | null = null;
let badges = new Map<ClientID, LevelBadge>();

export function rememberLobbyRoster(
  gameID: GameID,
  clients: readonly ClientInfo[] | undefined,
): void {
  const next = new Map<ClientID, LevelBadge>();
  for (const c of clients ?? []) {
    if (c.levelBadge !== undefined) next.set(c.clientID, c.levelBadge);
  }
  rosterGameID = gameID;
  badges = next;
}

// The player's badge in game `gameID`, or undefined when they have none (a
// guest, an anonymized name, progression off) or this tab never saw them in
// that game's lobby.
export function lobbyLevelBadge(
  gameID: GameID,
  clientID: ClientID | null,
): LevelBadge | undefined {
  if (clientID === null || gameID !== rosterGameID) return undefined;
  return badges.get(clientID);
}
