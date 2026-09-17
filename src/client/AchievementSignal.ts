import { PlayerAchievement } from "../core/ApiSchemas";
import { getUserMe, invalidateUserMe } from "./Api";
import { desktopAchievements } from "./DesktopAchievements";

// Which achievement names have already been handed to the shell.
//
// NAMES, not timestamps. A high-water timestamp permanently loses any row
// that appears behind it, and rows do: `achievedAt` is the GAME's end time
// rather than the ingest time, concurrently ingested games land out of order,
// and a failed ingest replayed by hand arrives carrying its original old
// timestamp. Names are immune to ordering, and since a platform unlock is
// binary the fact that feats recur per game does not matter here.
//
// This record is an OPTIMISATION, never load-bearing: the shell filters what
// it receives against what the platform already holds, so a lost or stale
// record costs a redundant no-op call and can never cause a missed unlock.
// That holds only while every write corresponds to a delivery -- a name
// recorded without a shell to receive it is lost for good, which is why both
// the write below and syncAchievements are gated on the shell being capable.
const KEY = "achievements.pushed";

// Keyed by player: two accounts on one machine would otherwise have the first
// one's record suppress the second's achievements.
function read(playerId: string): Set<string> {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return new Set();
    const parsed = JSON.parse(raw) as { playerId?: string; names?: string[] };
    if (parsed.playerId !== playerId) return new Set();
    return new Set(parsed.names ?? []);
  } catch {
    return new Set();
  }
}

function write(playerId: string, names: Set<string>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ playerId, names: [...names] }));
  } catch {
    // Private windows and blocked site data both throw. Losing the record
    // only costs a redundant push next time.
  }
}

/**
 * Hand every earned name not yet in the record to the shell, and record it.
 * Returns the names newly pushed.
 */
export function pushEarnedAchievements(
  playerId: string,
  rows: PlayerAchievement[],
): string[] {
  const known = read(playerId);
  const fresh: string[] = [];
  for (const { achievement } of rows) {
    if (known.has(achievement)) continue;
    known.add(achievement);
    fresh.push(achievement);
  }
  if (fresh.length === 0) return [];
  desktopAchievements.unlock(fresh);
  // Only record what was actually delivered. unlock() is a no-op on a shell
  // that does not support achievements, and marking a name as pushed when
  // nothing received it would lose it for good. syncAchievements already
  // refuses to get this far in that case; this is the second lock on the door.
  if (desktopAchievements.isAvailable()) write(playerId, known);
  return fresh;
}

// Bounded and deliberately unhurried. Ingest runs synchronously inside the
// API's POST /game, which the game server fires as soon as the winner vote
// resolves, so the first or second attempt normally lands while the win modal
// is still on screen. A poll that misses entirely is not a lost achievement --
// the next startup reconcile catches it -- so there is no reason to be
// aggressive.
const RETRY_DELAYS_MS = [2_000, 5_000, 15_000];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Fetch, diff and push.
 *
 * With no `gameId` this is the startup reconcile: one fetch, push whatever is
 * new. With a `gameId` it retries until that game's achievements have been
 * ingested, because the row we are waiting for may not exist yet.
 */
export async function syncAchievements(opts?: {
  gameId?: string;
}): Promise<void> {
  // Nothing downstream can receive an achievement unless a capable shell is
  // present, and running anyway would be actively harmful, not merely
  // wasteful: every name fetched would be written to the record as "pushed"
  // while nothing received it, so a player running a shell too old to take
  // them would have their whole back catalogue marked delivered and would
  // never see it once a capable shell arrived. It also saves a /users/@me
  // round trip per launch and per game for everyone playing in a browser.
  //
  // REMOVE THIS when the same signal is reused to drive an in-page toast:
  // there is no shell to gate on in that future, and the record would then
  // need to be keyed by consumer rather than shared.
  if (!desktopAchievements.isAvailable()) return;

  const attempts = opts?.gameId === undefined ? 1 : RETRY_DELAYS_MS.length + 1;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await sleep(RETRY_DELAYS_MS[attempt - 1]);
    try {
      // The profile is memoised for the session. The startup reconcile reads
      // the profile the session just fetched during boot, which is already
      // fresh, so invalidating there would only force a redundant round trip
      // for every player on every launch. The post-game poll always
      // invalidates: its cached copy predates the game ending, so it must be
      // dropped before every attempt or every retry would read the same
      // stale answer.
      if (opts?.gameId !== undefined || attempt > 0) invalidateUserMe();
      const me = await getUserMe();
      if (me === false) return; // Signed out; nothing to attribute.
      const rows = me.player.achievements.player;
      if (
        opts?.gameId !== undefined &&
        !rows.some((r) => r.game === opts.gameId)
      ) {
        continue; // Not ingested yet.
      }
      pushEarnedAchievements(me.player.publicId, rows);
      return;
    } catch {
      // Network failures are ordinary here. The next attempt, or the next
      // startup, will do.
    }
  }
}
