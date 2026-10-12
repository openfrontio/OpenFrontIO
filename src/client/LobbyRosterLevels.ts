import { ClientID, GameID } from "@openfront/engine-api/Schemas";
import { LevelBadge, unpackLevelBadge } from "@openfront/shared/LevelBadgeWire";
import { ClientInfo } from "@openfront/shared/WireSchemas";

// Level badges from the last lobby roster this tab was sent, for in-game UI.
// The start message carries no levels, so a tab that never saw the lobby (a
// refresh or late join) has none. Kept in wire form, as a roster arrives every
// second and a badge is read only when a panel opens.

let rosterGameID: GameID | null = null;
let badges = new Map<ClientID, number>();

export function rememberLobbyRoster(
  gameID: GameID,
  clients: readonly ClientInfo[] | undefined,
): void {
  const next = new Map<ClientID, number>();
  for (const c of clients ?? []) {
    if (c.levelBadge !== undefined) next.set(c.clientID, c.levelBadge);
  }
  rosterGameID = gameID;
  badges = next;
}

// The player's badge in game `gameID`, or undefined when they have none (a
// guest, an anonymized name, progression off, their level hidden, a value out
// of range) or this tab never saw them in that game's lobby.
export function lobbyLevelBadge(
  gameID: GameID,
  clientID: ClientID | null,
): LevelBadge | undefined {
  if (clientID === null || gameID !== rosterGameID) return undefined;
  return unpackLevelBadge(badges.get(clientID));
}
