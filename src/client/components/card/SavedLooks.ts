import type { ClientID, GameID } from "@openfront/engine-api/Schemas";
import { ownsPlayerCard } from "@openfront/shared/CosmeticSchemas";
import { type LoadoutItem, MAX_LOOK_ITEMS } from "./LoadoutItems";

// Looks the viewer saved from the player panel ("Get the look") to buy on the
// end screen: buying mid-game reloads the page and would end their game. Kept
// in memory for one game only: reading or saving under another game's id
// starts empty, and leaving the game clears them (ClientGameRunner.stop).

export interface SavedLook {
  clientID: ClientID;
  // The player's name as the viewer saw it, for "Get {name}'s look".
  name: string;
  // What the viewer doesn't own yet, as the end screen's loadout offers it
  // (loadoutItems): every candidate, uncapped.
  items: LoadoutItem[];
}

export const MAX_SAVED_LOOKS = 3;

let lookGameID: GameID | null = null;
let looks: SavedLook[] = [];
const listeners = new Set<() => void>();

// Whether a look offers anything the viewer can buy: an earned item can only
// be unlocked by playing, so a look of those alone isn't worth saving.
export function hasSomethingToBuy(items: readonly LoadoutItem[]): boolean {
  return items.some((i) => i.state === "buy");
}

function forGame(gameID: GameID): SavedLook[] {
  if (gameID !== lookGameID) {
    lookGameID = gameID;
    looks = [];
  }
  return looks;
}

function changed(): void {
  for (const listener of listeners) listener();
}

// Calls `listener` whenever a look is saved, removed or cleared (the end
// screen re-renders). Returns the unsubscribe.
export function onSavedLooksChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Newest first, one per player, at most MAX_SAVED_LOOKS. A look with nothing
// to buy (earned items alone don't count) isn't kept.
export function saveLook(gameID: GameID, look: SavedLook): void {
  const rest = forGame(gameID).filter((l) => l.clientID !== look.clientID);
  looks = hasSomethingToBuy(look.items)
    ? [look, ...rest].slice(0, MAX_SAVED_LOOKS)
    : rest;
  changed();
}

export function unsaveLook(gameID: GameID, clientID: ClientID): void {
  looks = forGame(gameID).filter((l) => l.clientID !== clientID);
  changed();
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
  changed();
}

// One "Get {name}'s look" row on the end screen.
export interface LookRow {
  clientID: ClientID;
  name: string;
  items: LoadoutItem[];
}

const itemKey = (i: LoadoutItem) => `${i.type}:${i.item.name}`;

/**
 * The end screen's rows, in order (the killer's row, when it shows, then the
 * saved looks), filtered against what the viewer owns now rather than when
 * the look was saved. The player card is offered in the first row shown only,
 * no item shows in two rows, each row shows at most MAX_LOOK_ITEMS (counted
 * after those filters, buyable items first so the cap never drops the one a
 * look was saved for), and a row left with nothing to buy is dropped (an
 * earned item alone doesn't keep it).
 */
export function endScreenLookRows(
  rows: readonly LookRow[],
  flares: readonly string[],
): LookRow[] {
  const owned = new Set(flares);
  const ownsCard = ownsPlayerCard(flares);
  const offered = new Set<string>();
  const out: LookRow[] = [];
  for (const row of rows) {
    const left = row.items.filter((i) => {
      const key = itemKey(i);
      if (owned.has(key) || offered.has(key)) return false;
      return i.type !== "playerCard" || (!ownsCard && out.length === 0);
    });
    // Buyable first, each kept in its own order: "has something to buy"
    // (the panel's save, the killer row) then holds after the cap too.
    const items = [
      ...left.filter((i) => i.state === "buy"),
      ...left.filter((i) => i.state !== "buy"),
    ].slice(0, MAX_LOOK_ITEMS);
    if (!items.some((i) => i.state === "buy")) continue;
    for (const i of items) offered.add(itemKey(i));
    out.push({ ...row, items });
  }
  return out;
}
