import type { GameID } from "@openfront/engine-api/Schemas";
import type { PublicGameType } from "@openfront/shared/WireSchemas";

// The public lobby slot (ffa/team/special/hosted) from the last lobby_info
// this tab was sent. The game config doesn't say which slot a game filled,
// and the start message carries no lobby info, so a tab that never saw the
// lobby (a refresh mid-game) doesn't know it.

let lobbyGameID: GameID | null = null;
let slot: PublicGameType | undefined;

export function rememberLobbyPublicGameType(
  gameID: GameID,
  publicGameType: PublicGameType | undefined,
): void {
  lobbyGameID = gameID;
  slot = publicGameType;
}

/** The slot game `gameID` filled, or undefined when this tab doesn't know. */
export function lobbyPublicGameType(
  gameID: GameID,
): PublicGameType | undefined {
  return gameID === lobbyGameID ? slot : undefined;
}
