import { z } from "zod";
import {
  pickServerForBuild,
  ServerList,
  ServerListSchema,
  servesBuild,
  versionMatches,
} from "../core/ServerList";
import { getApiBase } from "./ApiBase";
import { ClientEnv } from "./ClientEnv";
import { isDesktopShell } from "./DesktopShell";
import { isReplayShellHost } from "./VersionedReplay";

// Multi-server v2 (docs/MultiServer.md, "Server list v2"): the API says which
// servers are running, on which commit, and whether they take new games.
//
// The list is fetched once at page load (bounded, so offline singleplayer
// waits seconds at worst and never hangs) and kept warm by a heartbeat:
// every REFRESH_INTERVAL_MS on success, RETRY_INTERVAL_MS after a failure.
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
// the "backend-reachability" document event carrying both).

// Bounded so an unreachable API costs one short wait, after which the
// bootstrap values take over.
const FETCH_TIMEOUT_MS = 4_000;
// Heartbeat: how long a list is served before it is revalidated in the
// background, and how soon a failed attempt is retried.
const REFRESH_INTERVAL_MS = 30_000;
const RETRY_INTERVAL_MS = 10_000;
// How many attempts in a row must go unanswered before the UI calls it an
// outage. One failure is a blip -- a 4s timeout on a flaky connection, a
// worker restart mid-beat, a proxy hiccup -- and the cached list keeps
// serving straight through it, so gating multiplayer on the first one would
// take the game away from a player whose next request would have worked. Two
// in a row, which take a retry interval to accumulate, is evidence.
const CONFIRM_OUTAGE_AFTER_FAILURES = 2;
// Floor between player-initiated retries, so someone leaning on the button
// cannot outpace the request it started. Short enough that a deliberate
// second press still works, which is the whole point of a manual retry.
const MANUAL_RETRY_MIN_INTERVAL_MS = 1_000;

export type ServerListStatus =
  // The list is loaded and a server for this build was picked.
  | "api"
  // The list is missing or unreachable; BOOTSTRAP_CONFIG is in charge.
  | "fallback"
  // The list is loaded, no server takes new games from this build, and
  // `latest` says a newer version exists — this page is behind. The caller
  // that starts something new (the lobby list) turns this into the existing
  // "update available" prompt; nothing here navigates the page.
  | "outdated"
  // The list is loaded but no server takes new games from this build and
  // there is no newer version either: nothing is running. Own-server calls
  // fall back to BOOTSTRAP_CONFIG, so multiplayer fails as it does today
  // when the server is gone.
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
  // player must not get a console line every RETRY_INTERVAL_MS.
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
    });
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
function scheduleNextPoll(gotList: boolean): void {
  if (!polling) return;
  pollTimer = setTimeout(
    () => {
      pollTimer = null;
      runPoll();
    },
    gotList ? REFRESH_INTERVAL_MS : RETRY_INTERVAL_MS,
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
 * list and the games created from it land together.
 *
 * Nothing here ever navigates the page. When no server takes this build's
 * games but `latest` names a newer one, the answer is "outdated" and the
 * caller that starts something new (PublicLobbySocket.start) raises the
 * existing "update available" prompt. Joining or rejoining an existing
 * game, and every in-game request, can ignore it: they get the list applied
 * either way, so a game's own letter still routes.
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
 * Try the API again right now, at the player's request: the Retry on the
 * desktop status bar's offline state (OPE-439).
 *
 * Deliberately ignores the heartbeat's retry interval. That interval exists
 * to stop TIMER-driven callers hammering a down API between beats, and a
 * person pressing a button is not one of those -- holding their click for up
 * to RETRY_INTERVAL_MS would make the button look broken in exactly the
 * situation it exists for.
 *
 * It does have a floor of its own, MANUAL_RETRY_MIN_INTERVAL_MS. Inside that
 * window a second press is a no-op that hands back the same promise, so a
 * player leaning on the button cannot outpace the request it started. Past
 * the throttle, fetchOnce() still dedupes: a press landing on top of a
 * heartbeat beat joins that attempt rather than starting a second.
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

// Whether a caller may start a fresh attempt, or must leave it to the
// heartbeat's next beat. Only a failed attempt holds anything back, and only
// for the retry interval; the cached list (if any) keeps serving meanwhile.
function retryDue(): boolean {
  if (lastAttempt === null || !lastAttempt.failed) return true;
  return Date.now() - lastAttempt.at >= RETRY_INTERVAL_MS;
}

function apply(): ServerListStatus {
  const list = cached?.list ?? null;
  if (list === null) {
    pickedLetter = null;
    ClientEnv.applyServerList(null, null);
    return "fallback";
  }

  const own = safeOwnCommit();
  // Sticky while the picked server still takes this build's games — a flip
  // from open to draining does not move the page, only fencing (or the
  // letter going away) does.
  if (pickedLetter === null || !servesBuild(list, pickedLetter, own)) {
    pickedLetter = pickServerForBuild(list, own, randomIndex);
  }
  if (pickedLetter !== null) {
    ClientEnv.applyServerList(list, pickedLetter);
    return "api";
  }

  // No server takes new games from this build. Existing games still resolve
  // by letter from the list; own-server calls fall back to the page's own
  // values. If a newer version exists, say so and let the caller prompt.
  ClientEnv.applyServerList(list, null);
  return isOutdated(list, own) ? "outdated" : "no-server";
}

// The one place the client's randomness lives: src/core carries no
// floating-point math, so it takes an index rather than a draw.
function randomIndex(count: number): number {
  return Math.floor(Math.random() * count);
}

// Outdated means a newer version exists for this page to move to. When this
// page IS latest, or the list names no latest, no server is running at all:
// there is nothing to update to, and prompting would only loop.
//
// versionMatches, not commitsMatch: a build label that names no commit
// ("DEV" from the dev server, "desktop" from an old shell, "" when
// BOOTSTRAP_CONFIG is unreadable) matches any version and is never behind —
// telling the dev server's bundle to reload for an update it cannot fetch
// would loop forever.
//
// The desktop shell is never outdated from here: its updater owns which
// version it runs, and reloading would only re-run the same local overlay
// (GameModeSelector.handleUpdateAvailable refuses it too).
//
// A replay shell is pinned on purpose: replay.<domain> serves the build a
// record was made on, so being behind latest is the point. It is skipped
// here as well as in startServerListPolling, because the lobby socket (the
// one flow that prompts) runs there too.
function isOutdated(list: ServerList, own: string): boolean {
  if (isDesktopShell()) return false;
  if (isOnReplayShell()) return false;
  if (list.latest === undefined) return false;
  return !versionMatches(own, list.latest);
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
