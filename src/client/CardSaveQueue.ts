import {
  type CardLoadoutBody,
  type SaveCardResult,
  saveCardLoadout,
} from "./CardLoadoutApi";

// Card saves, shared by every editor (a My Card tab, and one made after
// the player left it and came back). Each PUT replaces the whole loadout,
// so they go one at a time: a change made while one is in flight waits and
// is sent on top of it, and no answer can overwrite a newer one.
export interface CardSaveOutcome {
  // The last save in the run: ok when the newest loadout asked for is stored.
  result: SaveCardResult;
  // What the server holds after the run (the last loadout it stored), or
  // null when nothing in it was stored.
  saved: CardLoadoutBody | null;
}

// A My Card tab's "card-saved" event: `publicId` is the account it saved for.
export interface CardSavedDetail {
  publicId: string;
  loadout: CardLoadoutBody;
}

let wanted: CardLoadoutBody | null = null;
let running: Promise<CardSaveOutcome> | null = null;

// Saves `loadout`, after any save in flight. Resolves when every save asked
// for so far has run; all callers of one run get the same outcome.
export function requestCardSave(
  loadout: CardLoadoutBody,
): Promise<CardSaveOutcome> {
  wanted = loadout;
  running ??= (async () => {
    let saved: CardLoadoutBody | null = null;
    try {
      for (;;) {
        const sending: CardLoadoutBody = wanted!;
        const result = await saveCardLoadout(sending);
        if (!result.ok) return { result, saved };
        saved = result.loadout;
        if (wanted === sending) return { result, saved };
      }
    } finally {
      wanted = null;
      running = null;
    }
  })();
  return running;
}

// The newest loadout asked for while saves are running, or null when none
// is: what an editor made meanwhile shows and builds on.
export function cardSaveInFlight(): CardLoadoutBody | null {
  return wanted;
}

// The run in flight, to hear how it ends (null when none is running).
export function cardSaveRunning(): Promise<CardSaveOutcome> | null {
  return running;
}
