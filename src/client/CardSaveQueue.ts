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
  // The last save in the run: ok when the newest loadout asked for is
  // stored; "cancelled" when the account signed out (or another asked to
  // save) while it ran: what was queued was dropped, and the run is
  // superseded, even if its last PUT was stored.
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

// A run of saves for one account. It stops, sending nothing more, once that
// account signs out or another one asks to save: whatever was queued in it
// is dropped, never sent under the next sign-in.
interface Run {
  publicId: string;
  wanted: CardLoadoutBody;
  done: Promise<CardSaveOutcome>;
  cancelled: boolean;
}

let current: Run | null = null;

function cancelRun(): void {
  if (current !== null) current.cancelled = true;
  current = null;
}

// Sign-out (any path: Auth's clearLocalSession announces it), and a portal
// account change (reauthAfterPortalChange), which swaps the session without
// one.
if (typeof document !== "undefined") {
  document.addEventListener("session-cleared", cancelRun);
  document.addEventListener("session-reauth", cancelRun);
}

// Saves `loadout` for account `publicId`, after any save in flight for it.
// Resolves when every save asked for so far has run; all callers of one run
// get the same outcome.
export function requestCardSave(
  publicId: string,
  loadout: CardLoadoutBody,
): Promise<CardSaveOutcome> {
  if (current !== null && current.publicId === publicId) {
    current.wanted = loadout;
    return current.done;
  }
  cancelRun();
  const run: Run = {
    publicId,
    wanted: loadout,
    done: null as unknown as Promise<CardSaveOutcome>,
    cancelled: false,
  };
  current = run;
  run.done = (async () => {
    let saved: CardLoadoutBody | null = null;
    try {
      for (;;) {
        const sending = run.wanted;
        // Checked again once the token is read: that can wait on a JWT
        // refresh, and a sign-out meanwhile must not send this loadout
        // under the next session's token.
        const result = await saveCardLoadout(sending, () => !run.cancelled);
        if (!result.ok) return { result, saved };
        saved = result.loadout;
        // Cancelled while the PUT was out: a newer run (or session) owns the
        // card now, so this one never reports success.
        if (run.cancelled) {
          return { result: { ok: false, error: "cancelled" }, saved };
        }
        if (run.wanted === sending) return { result, saved };
      }
    } finally {
      if (current === run) current = null;
    }
  })();
  return run.done;
}

// The newest loadout asked for while saves for `publicId` are running, or
// null when none are: what an editor made meanwhile shows and builds on.
export function cardSaveInFlight(publicId: string): CardLoadoutBody | null {
  return current?.publicId === publicId ? current.wanted : null;
}

// The run in flight for `publicId`, to hear how it ends (null when none).
export function cardSaveRunning(
  publicId: string,
): Promise<CardSaveOutcome> | null {
  return current?.publicId === publicId ? current.done : null;
}

// Tests only: forget any run, so one test's pending save can't leak into
// the next.
export function resetCardSavesForTests(): void {
  cancelRun();
}
