import type { ClientID, GameID } from "@openfront/engine-api/Schemas";
import type { LoadoutItem } from "./LoadoutItems";

// Looks the viewer saved from the player panel ("Get the look") to buy on the
// end screen: buying mid-game reloads the page and would end their game. Kept
// in memory for one game only: reading or saving under another game's id
// starts empty, and leaving the game clears them (ClientGameRunner.stop).

export interface SavedLook {
  clientID: ClientID;
  // The player's name as the viewer saw it, for "Get {name}'s look".
  name: string;
  // What the viewer doesn't own yet, as the end screen's loadout offers it
  // (loadoutItems).
  items: LoadoutItem[];
}

export const MAX_SAVED_LOOKS = 3;

let lookGameID: GameID | null = null;
let looks: SavedLook[] = [];

function forGame(gameID: GameID): SavedLook[] {
  if (gameID !== lookGameID) {
    lookGameID = gameID;
    looks = [];
  }
  return looks;
}

// Newest first, one per player, at most MAX_SAVED_LOOKS. A look with nothing
// left to get isn't kept.
export function saveLook(gameID: GameID, look: SavedLook): void {
  const rest = forGame(gameID).filter((l) => l.clientID !== look.clientID);
  looks =
    look.items.length === 0 ? rest : [look, ...rest].slice(0, MAX_SAVED_LOOKS);
}

export function unsaveLook(gameID: GameID, clientID: ClientID): void {
  looks = forGame(gameID).filter((l) => l.clientID !== clientID);
}

export function isLookSaved(gameID: GameID, clientID: ClientID): boolean {
  return forGame(gameID).some((l) => l.clientID === clientID);
}

export function savedLooks(gameID: GameID): readonly SavedLook[] {
  return forGame(gameID);
}

export function clearSavedLooks(): void {
  lookGameID = null;
  looks = [];
}
