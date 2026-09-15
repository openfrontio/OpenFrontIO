import { z } from "zod";
import { GameID } from "../core/Schemas";
import {
  commitsMatch,
  isCommitLike,
  isSiteLike,
  ownLetterIn,
  pickServerForBuild,
  ServerList,
  ServerListSchema,
  servesBuild,
  versionedPathForGame,
  versionMatches,
} from "../core/ServerList";
import { getApiBase } from "./ApiBase";
import { ClientEnv } from "./ClientEnv";
import { isDesktopShell } from "./DesktopShell";
import { pagePin } from "./PagePin";
import { isReplayShellHost } from "./VersionedReplay";

// Multi-server v2 (docs/MultiServer.md, "Server list v2"): the API says which
// servers are running, on which commit, and whether they take new games.
//
// The list is fetched once at page load (bounded, so offline singleplayer
// waits seconds at worst and never hangs) and kept warm by a heartbeat:
// every REFRESH_INTERVAL_MS on success, and on a backing-off schedule after
// a failure (retryDelayMs).
// Clicking Join or Create therefore never waits on the network — whatever
// the list's age, ensureServerList() answers from the cached copy and
// revalidates behind it. Only a page that has never seen a list waits for a
// fetch. A refresh that fails keeps the last good list rather than throwing
// it away: the API caches its answer for seconds anyway, so a blip must not
// flip a working page into fallback.
//
// Whatever it learns is handed to ClientEnv, whose synchronous accessors
// every socket and URL builder already reads; when the list is missing or
// was never reachable ClientEnv keeps answering from BOOTSTRAP_CONFIG, so
// the client behaves exactly as it does today until the API serves a list.
//
// The heartbeat doubles as the client's backend-reachability probe
// (backendReachable() for the raw per-attempt answer,
// backendUnreachableConfirmed() for the debounced one the UI gates on, and
// the "backend-reachability" document event carrying both), and it says when
// it is busy (attemptInFlight() plus the "server-list-attempt" event), which
// is what the desktop status bar's Retry button disables itself on.

// Bounded so an unreachable API costs one short wait, after which the
// bootstrap values take over.
const FETCH_TIMEOUT_MS = 4_000;
// Heartbeat: how long a list is served before it is revalidated in the
// background.
const REFRESH_INTERVAL_MS = 30_000;
// Retry schedule after an unanswered attempt: the first retry comes after
// RETRY_BASE_MS and each further consecutive failure doubles the wait, up to
// RETRY_MAX_MS. Any answer at all resets it to the base.
//
// The point of the backoff is the long tail. A player who closes their laptop
// lid, or sits on a train through a tunnel, should not have the page firing a
// 4s request every 10s for an hour; a backend that is genuinely down should
// not take that traffic from every open tab either. The base is short because
// the common case is a blip that the very next request clears, and the cap is
// a minute because past that point the player has almost certainly stopped
// waiting -- and the Retry button is the escape hatch for anyone who has not.
const RETRY_BASE_MS = 10_000;
const RETRY_MAX_MS = 60_000;
// How many attempts in a row must go unanswered before the UI calls it an
// outage. One failure is a blip -- a 4s timeout on a flaky connection, a
// worker restart mid-beat, a proxy hiccup -- and the cached list keeps
// serving straight through it, so gating multiplayer on the first one would
// take the game away from a player whose next request would have worked. Two
// in a row, which take RETRY_BASE_MS to accumulate, is evidence.
const CONFIRM_OUTAGE_AFTER_FAILURES = 2;
// Floor between player-initiated retries, so someone leaning on the button
// cannot outpace the request it started. Short enough that a deliberate
// second press still works, which is the whole point of a manual retry.
const MANUAL_RETRY_MIN_INTERVAL_MS = 1_000;
/**
 * How long a player-initiated retry stays unavailable after one, on top of
 * however long that attempt itself takes. The fetch is bounded at 4s, so
 * without this a failure would hand the affordance back within seconds and a
 * player watching an outage could sit there firing real requests at it. Five
 * seconds is long enough that leaning on it costs nothing and short enough
 * that someone who has just plugged their network back in is not left waiting
 * on something that looks broken.
 *
 * One number for both affordances: the desktop status bar's Retry button
 * (which disables itself for this long after a press) and the web's refused
 * multiplayer click, which doubles as a retry because there is no bar there
 * to press. manualRetryAvailable() below is what the latter asks.
 */
export const MANUAL_RETRY_COOLDOWN_MS = 5_000;

export type ServerListStatus =
  // The list is loaded and a server for this build was picked: own-server
  // calls go to it.
  | "api"
  // The page's own values are in charge. Either no list is known (missing,
  // unreachable, malformed, empty), or the list carries no server for this
  // build and the page names a server of its own — which is running this
  // build, because it served this page. A loaded list is still applied, so
  // a foreign letter keeps routing cross-host; only own-server calls fall
  // back.
  | "fallback"
  // The list is loaded, no server takes new games from this build, and
  // `latest` names a newer version — this page is behind. Said only to a
  // page that names no server of its own (the static Worker's), where a
  // reload really does fetch `latest`. The caller that starts something new
  // (the lobby list) turns it into the existing "update available" prompt,
  // and createLobby refuses; nothing here navigates the page.
  | "outdated"
  // As above, but there is nothing to update to either: this page IS
  // `latest`, or the list names none, so nothing is running. Own-server
  // calls fall back to the document's origin and multiplayer fails as it
  // does today when the server is gone.
  | "no-server";

let cached: { list: ServerList; fetchedAt: number } | null = null;
let inflight: Promise<ServerList | null> | null = null;
// When the last attempt settled, and whether it came back empty-handed. A
// page with no list at all uses this to stay off the network between
// heartbeats: see ensureServerList.
let lastAttempt: { at: number; failed: boolean } | null = null;
let pickedLetter: string | null = null;
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let polling = false;
let reachable: boolean | null = null;
// Consecutive unanswered attempts, reset by any answer. Only this, and not
// `reachable` alone, decides backendUnreachableConfirmed().
let consecutiveFailures = 0;
// The most recent player-initiated retry, for the throttle in
// retryServerList(). Holds the promise so a press inside the window can hand
// back the same attempt rather than start or skip one.
let lastManualRetry: { at: number; result: Promise<ServerListStatus> } | null =
  null;
let warnedMalformed = false;

/** Test-only. */
export function resetServerList(): void {
  stopServerListPolling();
  cached = null;
  inflight = null;
  lastAttempt = null;
  pickedLetter = null;
  reachable = null;
  consecutiveFailures = 0;
  lastManualRetry = null;
  warnedMalformed = false;
  ClientEnv.applyServerList(null, null);
}

/**
 * The site whose list this page reads. Lists are keyed by the hostname
 * players load the page from, so branch previews, main, nightly and prod
 * never share one. Decided by the shell, not by whether serverHost is
 * present: while game servers still render the page they inject serverHost
 * as their own host (blue.openfront.io), which is not a site.
 *
 * - Desktop: the injected serverHost, whose values are exactly the sites
 *   (openfront.io, nightly.openfront.dev, main.openfront.dev). Under
 *   app://openfront the document host means nothing.
 * - Web: the apex when the page was rendered behind one (siteHost), else
 *   the document host. A page fetched straight from a deployment host
 *   still asks for its site's list rather than a host nobody registers.
 */
export function serverListSite(): string | undefined {
  if (isDesktopShell()) return ClientEnv.serverHost();
  return ClientEnv.siteHost() ?? window.location.host;
}

/**
 * The site a ranked join names, so the API pools this page only with game
 * servers registered under the site whose list it reads: the same site the
 * list is fetched for, or undefined when there is none or it is not a name
 * the API would accept (a dev page's `localhost:9000`). See
 * docs/MultiServer.md, "The ranked queue is keyed by site".
 */
export function matchmakingSite(): string | undefined {
  const site = safeSite();
  return site !== undefined && isSiteLike(site) ? site : undefined;
}

export function serverListUrl(site: string): string {
  return `${getApiBase()}/cluster.json?site=${encodeURIComponent(site)}`;
}

/**
 * Whether the API answered our LAST attempt at all — any HTTP status, a 404
 * included. Null until the first attempt settles, false on a timeout or a
 * network error. "Answered" is not "served a usable list": a site with no
 * list is a reachable backend.
 *
 * This is the raw signal, and it is deliberately twitchy: one timed-out
 * heartbeat flips it. Anything that takes something AWAY from the player
 * should read backendUnreachableConfirmed() instead.
 */
export function backendReachable(): boolean | null {
  return reachable;
}

/**
 * Whether the backend is confirmed down, rather than having merely missed
 * once.
 *
 * The distinction is the whole reason this exists. The heartbeat's job is to
 * keep a list warm, and it is expected to miss occasionally — a 4s timeout on
 * a flaky connection, a worker restart mid-beat, a proxy hiccup — while the
 * cached list carries on serving and nothing about the player's session is
 * actually broken. Gating multiplayer on the first miss would dim every
 * button and refuse every join for at least a retry interval over a blip
 * whose next request would have succeeded, and on the web there is not even
 * a Retry to escape it with.
 *
 * So: false until CONFIRM_OUTAGE_AFTER_FAILURES attempts in a row have gone
 * unanswered, which takes a retry interval to accumulate. Any answer at all
 * resets the count, a player-initiated retry counts like any other attempt,
 * and this is never true before the first attempt settles — unknown is not
 * unreachable.
 *
 * Changes to either value are announced on the document as
 * "backend-reachability" with `{ reachable, confirmed }`, so UI can subscribe
 * rather than poll. A consumer needs BOTH the event and the accessor: the
 * event is one-shot, so a component mounting after the state settles would
 * otherwise never learn it and would gate on its default forever — OPE-396's
 * bug, and the reason getDesktopUpdateState() exists in the same shape.
 */
export function backendUnreachableConfirmed(): boolean {
  return (
    reachable === false && consecutiveFailures >= CONFIRM_OUTAGE_AFTER_FAILURES
  );
}

/**
 * Whether an attempt is out right now, automatic or manual. Synchronous, so
 * UI that gates on it can seed itself at mount; the "server-list-attempt"
 * event below carries every change.
 */
export function attemptInFlight(): boolean {
  return inflight !== null;
}

/**
 * Whether asking for a player-initiated retry right now would actually probe
 * the API, rather than be swallowed.
 *
 * For callers that have no button of their own to disable -- the web's
 * refused multiplayer click (GameModeSelector.reportMultiplayerRefusal),
 * which is the web's stand-in for the desktop status bar's Retry. The bar
 * renders its own disabled state from the same two conditions, so the two
 * affordances share one policy and one clock:
 *
 * - nothing while an attempt is already out, whoever started it. A press
 *   landing on top of one could only join it, so offering it is a lie.
 * - nothing for MANUAL_RETRY_COOLDOWN_MS after the last player-initiated
 *   attempt, so a player clicking at an outage cannot turn each click into a
 *   request.
 *
 * Advisory, not enforcement: retryServerList() has its own floor and
 * fetchOnce() dedupes underneath, so a caller that skips this check still
 * cannot hammer the API. This exists so such a caller can tell whether its
 * retry did anything.
 */
export function manualRetryAvailable(): boolean {
  if (attemptInFlight()) return false;
  if (lastManualRetry === null) return true;
  return Date.now() - lastManualRetry.at >= MANUAL_RETRY_COOLDOWN_MS;
}

/** The detail carried by the "server-list-attempt" document event. */
export interface ServerListAttemptDetail {
  inFlight: boolean;
}

/**
 * Announced on the document when an attempt starts and again when it settles.
 *
 * Separate from "backend-reachability" on purpose: that one fires only on a
 * CHANGE of reachability, so an attempt that fails exactly like the last one
 * announces nothing at all -- which is precisely the case the desktop status
 * bar's Retry button needs to see, since it disables itself while the
 * heartbeat is already trying. Pairs with attemptInFlight() for the same
 * reason every other signal here does: the event is one-shot, so a component
 * mounting mid-attempt has only the accessor to read (OPE-396).
 */
function announceAttempt(inFlight: boolean): void {
  document.dispatchEvent(
    new CustomEvent<ServerListAttemptDetail>("server-list-attempt", {
      detail: { inFlight },
    }),
  );
}

/** The detail carried by the "backend-reachability" document event. */
export interface BackendReachabilityDetail {
  reachable: boolean;
  confirmed: boolean;
}

/**
 * Records how one attempt ended, and announces it if anything a consumer can
 * see has changed.
 *
 * Both fields are compared, not just `reachable`: the second failure in a row
 * leaves `reachable` false exactly as the first did while flipping
 * `confirmed`, and that transition is the one every gate acts on.
 */
function recordAttempt(answered: boolean, cause?: unknown): void {
  const wasReachable = reachable;
  const wasConfirmed = backendUnreachableConfirmed();
  consecutiveFailures = answered ? 0 : consecutiveFailures + 1;
  reachable = answered;
  const confirmed = backendUnreachableConfirmed();
  if (wasReachable === answered && wasConfirmed === confirmed) return;
  // Only transitions are logged: the heartbeat runs forever and an offline
  // player must not get a console line on every beat.
  if (!answered && wasReachable !== false) {
    console.warn("Server list API unreachable, using known values", cause);
  } else if (!answered && confirmed && !wasConfirmed) {
    console.warn("Server list API still unreachable, treating as offline");
  } else if (answered && wasReachable === false) {
    console.info("Server list API reachable again");
  }
  document.dispatchEvent(
    new CustomEvent<BackendReachabilityDetail>("backend-reachability", {
      detail: { reachable: answered, confirmed },
    }),
  );
}

async function fetchServerList(site: string): Promise<ServerList | null> {
  let res: Response;
  try {
    res = await fetch(serverListUrl(site), {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (e) {
    // Timed out, offline, DNS, TLS: nothing answered.
    recordAttempt(false, e);
    return null;
  }
  recordAttempt(true);
  // A site nobody has registered under answers 404: reachable, no list.
  if (!res.ok) return null;
  try {
    const parsed = ServerListSchema.safeParse(await res.json());
    if (!parsed.success) {
      warnMalformedOnce(z.prettifyError(parsed.error));
      return null;
    }
    // A site with no servers is the same as no list.
    if (Object.keys(parsed.data.servers).length === 0) return null;
    return parsed.data;
  } catch (e) {
    warnMalformedOnce(e);
    return null;
  }
}

function warnMalformedOnce(detail: unknown): void {
  if (warnedMalformed) return;
  warnedMalformed = true;
  console.warn("Invalid server list", detail);
}

/**
 * One attempt, shared: concurrent callers (a click and the heartbeat) join
 * the fetch already in flight rather than starting a second one. A failed
 * attempt leaves `cached` alone — the last good list keeps serving.
 */
function fetchOnce(): Promise<ServerList | null> {
  if (inflight !== null) return inflight;
  const site = safeSite();
  if (site === undefined) return Promise.resolve(null);
  inflight = fetchServerList(site)
    .then((list) => {
      if (list !== null) cached = { list, fetchedAt: Date.now() };
      lastAttempt = { at: Date.now(), failed: list === null };
      return list;
    })
    .catch(() => {
      lastAttempt = { at: Date.now(), failed: true };
      return null;
    })
    .finally(() => {
      inflight = null;
      announceAttempt(false);
    });
  announceAttempt(true);
  return inflight;
}

/**
 * Start the page-load fetch and the heartbeat behind it. Idempotent, never
 * throws, and does nothing on a page that has no site to ask about (a
 * broken BOOTSTRAP_CONFIG) or on a replay shell, which talks to the archive
 * rather than to a live server.
 */
export function startServerListPolling(): void {
  if (polling) return;
  try {
    if (safeSite() === undefined) return;
    if (isReplayShellHost(window.location.hostname)) return;
  } catch {
    return;
  }
  polling = true;
  runPoll();
}

/** Test-only; also used by resetServerList. */
export function stopServerListPolling(): void {
  polling = false;
  if (pollTimer !== null) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
}

function runPoll(): void {
  void fetchOnce().then(
    (list) => scheduleNextPoll(list !== null),
    () => scheduleNextPoll(false),
  );
}

// Scheduled after each attempt settles, never on a fixed interval: a slow
// or hanging fetch must not stack attempts on top of each other.
//
// The retry side reads consecutiveFailures, which recordAttempt has already
// updated for the attempt that just settled -- so an answered attempt that
// carried no list (a 404 for this site) waits the base interval rather than
// inheriting an earlier outage's backoff.
function scheduleNextPoll(gotList: boolean): void {
  if (!polling) return;
  pollTimer = setTimeout(
    () => {
      pollTimer = null;
      runPoll();
    },
    gotList ? REFRESH_INTERVAL_MS : retryDelayMs(consecutiveFailures),
  );
}

/**
 * Make sure ClientEnv knows the server list, and that a server for new
 * games has been picked. Await this before anything that needs a server; it
 * never throws, and resolves with what happened.
 *
 * A known list answers immediately whatever its age — a click must never
 * wait on the network — and a stale one is revalidated in the background.
 * Only a page that has never got a list waits: for the fetch already in
 * flight (the page-load one, usually), or for one started here. A page that
 * has no list and whose last attempt just failed does not start another:
 * the heartbeat retries on its own schedule, so a per-second caller (the
 * matchmaking poll) cannot hammer a down API.
 *
 * The pick prefers an `open` server on this build and falls back to a
 * `draining` one on this build (never a `fenced` one): a player who loaded
 * before a deploy keeps playing on their own build's server until they
 * refresh, which is how rollovers feel today. It is sticky for the page's
 * lifetime while that server still takes this build's games, so the lobby
 * list and the games created from it land together. Ahead of the draw comes
 * the page's own server: a page a game server rendered stays on the server
 * that rendered it whenever the list carries it serving this build (see
 * ownServerLetter).
 *
 * Nothing here ever navigates the page. When no server takes this build's
 * games but `latest` names a newer one, the answer is "outdated" and the
 * caller that starts something new (PublicLobbySocket.start) raises the
 * existing "update available" prompt — but only on a page that names no
 * server of its own, where a reload really does fetch `latest`. A page a
 * game server rendered gets "fallback" instead: it came from a server
 * running this build, a reload re-serves the same page from that server,
 * and an update prompt there would loop forever (OPE-430). Joining or
 * rejoining an existing game, and every in-game request, can ignore the
 * status entirely: the list is applied either way, so a game's own letter
 * still routes.
 */
export async function ensureServerList(): Promise<ServerListStatus> {
  try {
    if (cached === null) {
      // Join the attempt in flight (the page-load one, usually); otherwise
      // start one, unless the last one failed less than a retry interval
      // ago. With the API down, callers that run on a timer would otherwise
      // start a fetch every time they fire.
      if (inflight !== null || retryDue()) await fetchOnce();
    } else if (
      Date.now() - cached.fetchedAt >= REFRESH_INTERVAL_MS &&
      inflight === null &&
      retryDue()
    ) {
      // Stale-while-revalidate: answer now, refresh behind the answer. Once
      // the list is stale it stays stale until an attempt succeeds, so
      // without retryDue() a failing API would get one background refresh
      // per caller here too — the list keeps serving either way.
      void fetchOnce();
    }
    return apply();
  } catch (e) {
    // The contract is "never throws": whatever went wrong, the page's own
    // values are still a complete answer.
    console.warn("Server list refresh failed, using page values", e);
    return "fallback";
  }
}

/**
 * Try the API again right now, at the player's request (OPE-439). Two
 * callers, one per shell: the Retry on the desktop status bar's offline
 * state, and -- because the web has no such bar -- a refused multiplayer
 * click on the web, which doubles as that press
 * (GameModeSelector.reportMultiplayerRefusal). Both gate themselves on
 * manualRetryAvailable()'s policy first.
 *
 * Deliberately ignores the heartbeat's retry schedule. That backoff exists
 * to stop TIMER-driven callers hammering a down API between beats, and a
 * person pressing a button is not one of those -- holding their click for up
 * to a minute (RETRY_MAX_MS, once an outage has been going a while) would
 * make the button look broken in exactly the situation it exists for.
 *
 * It does have a floor of its own, MANUAL_RETRY_MIN_INTERVAL_MS. Inside that
 * window a second press is a no-op that hands back the same promise, so a
 * player leaning on the button cannot outpace the request it started. Past
 * the throttle, fetchOnce() still dedupes: a press landing on top of a
 * heartbeat beat joins that attempt rather than starting a second. This is
 * the last line of defence, not the first: the button that calls this is
 * itself disabled while an attempt is out and for a cooldown after a press
 * (DesktopStatusBar), and the floor is what holds if anything ever calls
 * this without going through such a button, or through
 * manualRetryAvailable().
 *
 * A retry that fails counts towards the outage confirmation like any other
 * attempt -- pressing Retry against a backend that is genuinely down should
 * settle the question sooner, not reset it.
 *
 * Never throws, for the same reason ensureServerList does not.
 */
export function retryServerList(): Promise<ServerListStatus> {
  const now = Date.now();
  if (
    lastManualRetry !== null &&
    now - lastManualRetry.at < MANUAL_RETRY_MIN_INTERVAL_MS
  ) {
    return lastManualRetry.result;
  }
  const result = runManualRetry();
  lastManualRetry = { at: now, result };
  return result;
}

async function runManualRetry(): Promise<ServerListStatus> {
  try {
    await fetchOnce();
    return apply();
  } catch (e) {
    console.warn("Server list retry failed, using page values", e);
    return "fallback";
  }
}

/**
 * How long to wait before retrying, given how many attempts in a row have
 * gone unanswered. Pure, so the schedule can be read (and tested) without a
 * clock: RETRY_BASE_MS after the first failure, doubling on each further
 * consecutive failure, capped at RETRY_MAX_MS.
 *
 *   1 -> 10s   2 -> 20s   3 -> 40s   4+ -> 60s
 *
 * Zero (or anything lower, defensively) is the base too: that is the state
 * after an ANSWER, and the next beat's schedule should already be back to
 * the short interval rather than inheriting the outage's.
 */
export function retryDelayMs(consecutiveFailures: number): number {
  if (consecutiveFailures <= 1) return RETRY_BASE_MS;
  // Math.min before the shift ever gets big: 2 ** 30 * 10s is still finite,
  // but there is no reason to let a long outage compute an absurd number.
  const doublings = Math.min(consecutiveFailures - 1, 20);
  return Math.min(RETRY_BASE_MS * 2 ** doublings, RETRY_MAX_MS);
}

// Whether a caller may start a fresh attempt, or must leave it to the
// heartbeat's next beat. Only a failed attempt holds anything back, and only
// for the current backoff delay; the cached list (if any) keeps serving
// meanwhile.
function retryDue(): boolean {
  if (lastAttempt === null || !lastAttempt.failed) return true;
  return Date.now() - lastAttempt.at >= retryDelayMs(consecutiveFailures);
}

function apply(): ServerListStatus {
  const list = cached?.list ?? null;
  if (list === null) {
    pickedLetter = null;
    ClientEnv.applyServerList(null, null);
    return "fallback";
  }

  const own = safeOwnCommit();
  const ownServer = ownServerLetter(list, own);
  if (ownServer !== null) {
    // A server-rendered page prefers its own server (OPE-430). See
    // ownServerLetter.
    pickedLetter = ownServer;
  } else if (pickedLetter === null || !servesBuild(list, pickedLetter, own)) {
    // Sticky while the picked server still takes this build's games — a flip
    // from open to draining does not move the page, only fencing (or the
    // letter going away) does.
    pickedLetter = pickServerForBuild(list, own, randomIndex);
  }
  if (pickedLetter !== null) {
    ClientEnv.applyServerList(list, pickedLetter);
    return "api";
  }

  // No server takes new games from this build. Existing games still resolve
  // by letter from the list — that is why the list is applied either way —
  // and own-server calls fall back to the page's own values.
  ClientEnv.applyServerList(list, null);

  // The rule (docs/MultiServer.md, OPE-430): "outdated" is a statement
  // about what a RELOAD would fetch, so only a page that names no server of
  // its own can be told it. There — the static Worker's page — a reload
  // really does fetch `latest`.
  //
  // A page a game server rendered came from a server running exactly this
  // build, and a reload re-fetches the page from that same host. So
  // whatever the list says about that host — a registry that missed a
  // deploy, an entry naming another build, an entry fenced — the answer is
  // "fallback": the page's own server and its own values, exactly as when
  // the API is unreachable. Anything else would prompt, reload, come back
  // identical, and prompt again, forever. That is what OPE-430 was.
  //
  // Such a page is not left behind. The server it talks to tells it
  // itself, over the lobby feed it is already connected to: a different
  // commit (that host moved on) or active:false (its deployment is no
  // longer the live one). That is the pre-v2 mechanism, it needs no list,
  // and it cannot loop — the signal comes from the very host a reload goes
  // back to. Only when that host stops answering altogether does the list
  // get a say again, through reloadWouldRescue below.
  if (servedByGameServer()) return "fallback";
  return behindLatest(list, own) ? "outdated" : "no-server";
}

/**
 * The letter of the page's OWN server when the list carries it and it still
 * serves this build — the letter apply() picks ahead of any draw.
 *
 * **A server-rendered page prefers its own server.** Before v2 a page always
 * talked to the colour that rendered it; the list's random pick can send it
 * to a sibling instead, and the two do not have to agree about that sibling.
 * On dev (`openfront.dev`, a blue/green pair behind the apex with
 * `CLUSTER_STATE_SOURCE=apex`) the registry listed both colours `open` on the
 * same build while the apex poll had green considering itself draining: a
 * page rendered by blue that drew green got a lobby feed reporting
 * `active: false`, read it as "a new version is available", and reloaded —
 * on about half of page loads. Prod would do the same across the v34
 * rollover. The page's own server is the one host it knows is running this
 * build, because it served this page, so it is the pick that cannot
 * disagree with itself.
 *
 * Null on a page that names no server (the static Worker's — there is no own
 * server to prefer), when the list does not carry that server, or when the
 * entry it carries does not serve this build (fenced, or another version).
 * Those fall through to the ordinary sticky random pick, and the fenced and
 * lagging-registry cases through it to "fallback", exactly as before.
 *
 * The desktop shell carries an injected `serverHost` too, but its value is a
 * SITE (openfront.io, main.openfront.dev) rather than a deployment the
 * registry lists, so it names no entry and the list's pick stands — except
 * on a standalone deployment whose one server IS that host, where the two
 * answers are the same server anyway.
 *
 * Not sticky, and it does not need to be: it answers the same letter on
 * every refresh for as long as the list keeps naming the page's own server,
 * and the letter it names cannot move to another host — letters are
 * append-only and never reused.
 */
function ownServerLetter(list: ServerList, own: string): string | null {
  if (!servedByGameServer()) return null;
  const letter = ownLetterIn(list, safeServerHost(), safeInstanceLetter());
  if (letter === null) return null;
  return servesBuild(list, letter, own) ? letter : null;
}

// The one place the client's randomness lives: src/core carries no
// floating-point math, so it takes an index rather than a draw.
function randomIndex(count: number): number {
  return Math.floor(Math.random() * count);
}

/**
 * Is there a newer build than this page's for it to move to at all? The
 * version half of both questions the list answers.
 *
 * versionMatches, not commitsMatch: a build label that names no commit
 * ("DEV" from the dev server, "desktop" from an old shell, "" when
 * BOOTSTRAP_CONFIG is unreadable) matches any version and is never behind —
 * telling the dev server's bundle to reload for an update it cannot fetch
 * would loop forever. When this page IS `latest`, or the list names none,
 * there is nothing to move to.
 *
 * Three shells are never behind however far from `latest` they run,
 * because someone else owns which version they are on:
 *
 * - the desktop shell: its updater owns that, and reloading would only
 *   re-run the same local overlay (GameModeSelector.handleUpdateAvailable
 *   refuses it too);
 * - a replay shell: replay.<domain> serves the build a record was made on,
 *   so being behind is the point. Skipped here as well as in
 *   startServerListPolling, because the lobby socket runs there too;
 * - a page pinned under `/v/<commit>/`: see isPinnedToAVersion.
 */
function behindLatest(list: ServerList, own: string): boolean {
  if (isDesktopShell()) return false;
  if (isOnReplayShell()) return false;
  if (isPinnedToAVersion()) return false;
  if (list.latest === undefined) return false;
  return !versionMatches(own, list.latest);
}

/**
 * Would reloading rescue this tab? The POST-FAILURE question, asked by
 * PublicLobbySocket.promptIfOutdated once reconnecting has given up — and
 * the only route by which a page a game server rendered is ever told to
 * update from the list.
 *
 * Deliberately not the page-load question. There, a server-rendered page is
 * never "outdated" (apply above): its own server is serving it, so a reload
 * comes back identical. Here that server has stopped answering at all,
 * which is the one shape where a reload can land the player somewhere
 * better: a tab that was sitting on the homepage when its deployment was
 * drained and then fenced or removed never gets a feed to learn from — it
 * just watches its socket fail.
 *
 * Three conditions, all of them necessary:
 *
 * - the list has no server for this build (`listStatus` is not "api"). A
 *   picked server still takes this build's games, so a socket failing
 *   against it is a network blip; and being behind `latest` is the normal
 *   state of every tab for the length of a rollout, so prompting on "api"
 *   would turn every hiccup in that window into a forced reload.
 * - there IS a newer build (behindLatest, shell exemptions included) —
 *   otherwise a reload fetches what this page already runs.
 * - a reload can land somewhere other than the page's own server
 *   (reloadCanLandElsewhere) — otherwise the prompt either fails with that
 *   server or loops against it.
 *
 * Nothing is probed. A browser cannot establish liveness: an opaque
 * cross-origin response carries no status, so a proxy answering 521 for a
 * torn-down origin and a healthy server look the same. The rule is about
 * topology instead, which the page knows for certain.
 *
 * False when no list has ever loaded: nothing is known to update to.
 */
export function reloadWouldRescue(listStatus: ServerListStatus): boolean {
  if (listStatus === "api") return false;
  const list = cached?.list ?? null;
  if (list === null) return false;
  try {
    return behindLatest(list, safeOwnCommit()) && reloadCanLandElsewhere();
  } catch {
    return false;
  }
}

/**
 * Could a reload land anywhere but the page's own server?
 *
 * - A Worker-served page names no server at all: its reload fetches
 *   `latest` from the static Worker, which is by definition not one
 *   deployment.
 * - Behind an apex — siteHost defined, not the page's own server, and the
 *   page's cluster map has siblings (prod: page openfront.io, servers blue
 *   and green.openfront.io) — reloadForUpdate re-enters through the site
 *   host, which the load balancer answers from a live deployment.
 * - Standalone (no siteHost, or siteHost IS the page's own server, or the
 *   map names only this server — dev's main.openfront.dev, previews, beta):
 *   the reload re-serves the same page from the same server. If that server
 *   is gone the reload fails with it; if it is alive with a
 *   WebSocket-specific problem, the prompt loops. Nothing a prompt can do
 *   helps.
 *
 * The siblings check is what catches a standalone deployment with
 * GAME_DOMAIN set: its page host (main.openfront.dev) and game host
 * (main.server.openfront.dev) differ, yet both names reach the one
 * container behind Traefik, so a differing siteHost alone proves nothing.
 * Same rule as the server's own apex poll
 * (ActiveDeployment.shouldPollApex).
 */
function reloadCanLandElsewhere(): boolean {
  if (!ClientEnv.servedByGameServer()) return true;
  const site = ClientEnv.siteHost();
  if (site === undefined || site === ClientEnv.serverHost()) return false;
  const cluster = ClientEnv.cluster();
  return cluster !== undefined && Object.keys(cluster).length > 1;
}

/**
 * Whether this document was deliberately served a specific version.
 *
 * A page under `/v/<commit>/` is pinned ON PURPOSE and is never "outdated",
 * however far behind `latest` it is: being behind is the whole point. The
 * one flow that puts a player there is opening a game whose server runs an
 * older build, so the page is behind by construction and permanently —
 * unlike an ordinary tab, where being behind is news ("a deploy happened
 * while you were here") and the prompt is a one-shot. Prompting here would
 * fire on every visit, and its remedy (reloadForUpdate, which strips the
 * prefix) would silently undo the pin the player asked for. Leaving is
 * already one click away: "leave to the menu" goes to the version-free root.
 *
 * The same exemption as the desktop shell and the replay shells above, for
 * the same reason: a page whose version someone else owns must not be told
 * to update itself.
 *
 * Read from the pin captured at boot, never from the live pathname: the
 * join flow rewrites the address bar to a version-free share URL, and this
 * question is about the bundle, which that rewrite does not change. See
 * PagePin.ts.
 */
export function isPinnedToAVersion(): boolean {
  return pagePin() !== null;
}

/**
 * Navigate to the page of the version the game's server runs, if that is a
 * different build than this one. True when a navigation was issued.
 *
 * The single home of that decision for every caller (Main.handleUrl's
 * `/game/<id>` branch, JoinLobbyModal.checkActiveLobby), so the two shells
 * that must NOT be navigated cannot be remembered in one place and forgotten
 * in the other:
 *
 * - **Desktop:** its updater owns which version it runs; a mismatch there is
 *   `update_available.desktop` at join time.
 * - **A replay shell:** `replay.<domain>/<gameId>` serves the build a record
 *   was made on and has no `/v/<commit>/` routes at all, so navigating there
 *   would 404 and lose an archived replay. (It DOES load the site's list —
 *   siteHost is injected — so nothing else would stop it.)
 *
 * The rest of the rule -- the loop guard, and WHICH path gets versioned
 * (the game's own, not whatever the address bar shows) -- is
 * versionedPathForGame.
 */
export function redirectToGameVersion(
  gameID: GameID,
  spectator = false,
): boolean {
  if (isDesktopShell()) return false;
  if (isOnReplayShell()) return false;
  const target = versionedPathForGame(
    safeOwnCommit(),
    ClientEnv.gameVersion(gameID),
    gameID,
    safeGamePath(gameID),
    window.location.pathname,
    window.location.search,
    spectator,
  );
  if (target === null) return false;
  window.location.href = target;
  return true;
}

/**
 * The `/v/<commit>/` page for a game on THIS page's host, or null when there
 * is none to go to. The join-time `version_mismatch` handler's first choice
 * (docs/MultiServer.md, "Opening a game at its server's version", OPE-471).
 *
 * Same decision as redirectToGameVersion, with two differences that apply
 * only once the server has answered: the commit it refused us with wins
 * over the list, which is stale-while-revalidate, and the loop guard reads
 * the boot-time pin, since the join has already rewritten the address bar
 * to the version-free share URL (PagePin.ts).
 */
export function versionedPathForMismatchedGame(
  gameID: GameID,
  serverCommit: string | undefined,
): string | null {
  if (isDesktopShell()) return null;
  if (isOnReplayShell()) return null;
  // A GIT_COMMIT that names no commit ("DEV", "unknown") must never reach a
  // /v/<x>/ URL: treat it as if the server had said nothing.
  const fromServer =
    serverCommit !== undefined && isCommitLike(serverCommit)
      ? serverCommit
      : undefined;
  const version = fromServer ?? ClientEnv.gameVersion(gameID);
  if (version === undefined) return null;
  const pinned = pagePin();
  if (pinned !== null && commitsMatch(pinned, version)) return null;
  return versionedPathForGame(
    safeOwnCommit(),
    version,
    gameID,
    safeGamePath(gameID),
    window.location.pathname,
    window.location.search,
  );
}

// The game's own version-free path, which the redirect versions whenever
// the address bar is not already showing this game. Degrades like safeSite
// below: ClientEnv.gamePath() reads the cluster map, and a page with no
// BOOTSTRAP_CONFIG must not take a join down while building a URL.
function safeGamePath(gameID: GameID): string {
  try {
    return ClientEnv.gamePath(gameID);
  } catch {
    return `/game/${encodeURIComponent(gameID)}`;
  }
}

function isOnReplayShell(): boolean {
  try {
    return isReplayShellHost(window.location.hostname);
  } catch {
    return false;
  }
}

// ClientEnv.get() throws without a BOOTSTRAP_CONFIG (and tests mock it
// piecemeal). A missing value here must degrade to the fallback path, never
// take a join down.
function safeSite(): string | undefined {
  try {
    return serverListSite();
  } catch {
    return undefined;
  }
}

function safeOwnCommit(): string {
  try {
    return ClientEnv.gitCommit();
  } catch {
    return "";
  }
}

// The page's own server, as the two shapes that name it spell it. Degrade
// like the accessors above: an unreadable BOOTSTRAP_CONFIG names no server,
// and the own-server preference simply does not apply.
function safeServerHost(): string | undefined {
  try {
    return ClientEnv.serverHost();
  } catch {
    return undefined;
  }
}

function safeInstanceLetter(): string | undefined {
  try {
    return ClientEnv.instanceLetter();
  } catch {
    return undefined;
  }
}

// Whether the page names a server of its own (ClientEnv.servedByGameServer).
// Degrades like the two above: an unreadable BOOTSTRAP_CONFIG names no
// server, and a page with no environment at all is answered by the fallback
// path rather than by a throw from the middle of a status decision.
function servedByGameServer(): boolean {
  try {
    return ClientEnv.servedByGameServer();
  } catch {
    return false;
  }
}
