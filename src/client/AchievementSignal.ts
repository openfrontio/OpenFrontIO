import { PlayerAchievement } from "../core/ApiSchemas";
import { fetchUserMeUncached, getUserMe } from "./Api";
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
// recorded without a shell to receive it is lost for good, which is why the
// write below waits for unlock() to confirm delivery and syncAchievements
// does not run at all without a capable shell.
const KEY = "achievements.pushed";

// The session a request was issued under.
//
// A /users/@me issued before a logout can still be in flight when the session
// goes, and an answer fetched under the old session must not be acted on
// under the new one: the names are the previous account's, while the platform
// account behind the shell does not change when the OpenFront account does,
// so pushing them would hand one player's achievements to another. Auth's
// clearLocalSession announces every logout, expiry and 401 as
// `session-cleared`, so a sign-out bumps this whether or not a different
// account signs back in.
//
// Same idea as Main.ts's authGeneration, which guards profile application
// against the same race; that counter is a local inside Main's boot path and
// cannot be read from here, so this module keeps its own off the same event.
let authGeneration = 0;
document.addEventListener("session-cleared", () => {
  authGeneration++;
});

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
 * Hand every earned name not yet in the record to the shell, and record what
 * the shell actually took. Returns the names delivered -- empty when delivery
 * failed, so a caller deciding whether to try again treats them as still owed.
 */
export async function pushEarnedAchievements(
  playerId: string,
  rows: PlayerAchievement[],
): Promise<string[]> {
  const known = read(playerId);
  const fresh: string[] = [];
  for (const { achievement } of rows) {
    if (known.has(achievement)) continue;
    known.add(achievement);
    fresh.push(achievement);
  }
  if (fresh.length === 0) return [];
  // Only record what was actually delivered: marking a name as pushed when
  // nothing received it would lose it for good. unlock() answers false both
  // for a shell that cannot take achievements at all and for one whose
  // handler failed, which is the whole condition -- a rejected call delivered
  // nothing however capable the shell looked.
  if (!(await desktopAchievements.unlock(fresh))) return [];
  write(playerId, known);
  return fresh;
}

// The post-game schedule, as the delay BEFORE each attempt.
//
// Ingest runs synchronously inside the API's POST /game, which the game
// server fires as the winner vote resolves -- the very update that triggers
// this poll -- so at t=0 there is provably nothing new to read yet. The first
// attempt waits rather than spending a round trip on a certain miss.
//
// Two attempts, ~7s. Only players on a shell that implements the bridge poll.
// They run this at the same instant, so each extra attempt costs one /users/@me
// per capable player. A bounded budget is affordable because the cost scales
// with players, and a poll that misses entirely is not a lost achievement --
// the next startup reconcile catches it.
const POST_GAME_DELAYS_MS = [2_000, 5_000];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Fetch, diff and push.
 *
 * With no `gameId` this is the startup reconcile: one fetch of the session's
 * profile, push whatever is new. With a `gameId` it is the post-game poll,
 * which gives ingest a bounded moment to land before reading (see
 * POST_GAME_DELAYS_MS) and deliberately does not disturb that shared profile.
 *
 * Callers must not invoke the post-game form for a game the server never
 * archives -- singleplayer and replays -- where no row can ever appear.
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

  const gameId = opts?.gameId;

  // Captured once, not per request: everything below belongs to the session
  // that is live right now, and a sign-out at any point -- while a request is
  // in flight, or while the schedule below is sleeping between them -- retires
  // all of it. See authGeneration above.
  const generation = authGeneration;

  if (gameId === undefined) {
    // Startup reconcile. The profile is memoised for the session and the one
    // the session just fetched during boot is already fresh, so this reads
    // the cached copy rather than forcing a redundant round trip on every
    // player on every launch.
    const me = await getUserMe();
    if (me === false) return;
    if (generation !== authGeneration) return;
    await pushEarnedAchievements(
      me.player.publicId,
      me.player.achievements.player,
    );
    return;
  }

  for (let attempt = 0; attempt < POST_GAME_DELAYS_MS.length; attempt++) {
    await sleep(POST_GAME_DELAYS_MS[attempt]);
    if (generation !== authGeneration) return;
    // Uncached, and deliberately NOT invalidateUserMe() + getUserMe(): the
    // memo is the session's shared profile, and a refetch that fails would
    // replace it with `false` for every other consumer. See
    // fetchUserMeUncached in Api.ts. It answers rather than throws, on every
    // outcome, so there is nothing here to catch.
    const me = await fetchUserMeUncached();
    // Answered for a session that has since gone. Abandon the poll rather than
    // retry it: the game it was started for belongs to that retired session
    // too, so there is nothing left here worth another request.
    if (generation !== authGeneration) return;
    if (me === false) {
      // `false` is every unhappy answer the contract can give -- signed out,
      // a 401, a 500, a dropped connection, a self-imposed timeout -- and it
      // cannot tell them apart, so this cannot conclude "signed out" and
      // stop. Retrying is right for the transient half and costs a genuinely
      // signed-out player one extra request per game.
      continue;
    }
    const rows = me.player.achievements.player;
    const fresh = await pushEarnedAchievements(me.player.publicId, rows);
    // The fetch landed and the diff has been applied, so this attempt did its
    // job; what remains is deciding whether ingest is worth waiting for. A
    // row for this game, or a name we just handed over, says it is not. The
    // ordinary game is one where the player earned nothing and neither will
    // ever be true, which is why the schedule above -- not this condition --
    // is what bounds the loop.
    if (fresh.length > 0 || rows.some((r) => r.game === gameId)) return;
  }
}
