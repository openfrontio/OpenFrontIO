import { z } from "zod";
import { GameID } from "../core/Schemas";
import {
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
// (backendReachable(), the "backend-reachability" document event).

// Bounded so an unreachable API costs one short wait, after which the
// bootstrap values take over.
const FETCH_TIMEOUT_MS = 4_000;
// Heartbeat: how long a list is served before it is revalidated in the
// background, and how soon a failed attempt is retried.
const REFRESH_INTERVAL_MS = 30_000;
const RETRY_INTERVAL_MS = 10_000;

export type ServerListStatus =
  // The list is loaded and a server for this build was picked.
  | "api"
  // The list is missing or unreachable; BOOTSTRAP_CONFIG is in charge.
  // Also the answer for a page a game server rendered whose build the list
  // carries no server for: that page's own injected server is the server
  // for its build (ClientEnv.servedByGameServer), so own-server calls use
  // the page's values exactly as they do when the API is down.
  | "fallback"
  // The list is loaded, no server takes new games from this build, and
  // `latest` says a newer version exists — this page is behind. The caller
  // that starts something new (the lobby list) turns this into the existing
  // "update available" prompt; nothing here navigates the page.
  //
  // Only ever answered to a page that names no server of its own, i.e. one
  // the static Worker served, where reloading really does fetch `latest`. A
  // server-rendered page is re-served by the same server on the same build,
  // so telling it to reload would only loop.
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
let warnedMalformed = false;

/** Test-only. */
export function resetServerList(): void {
  stopServerListPolling();
  cached = null;
  inflight = null;
  lastAttempt = null;
  pickedLetter = null;
  reachable = null;
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
 * Whether the API answered our last attempt at all — any HTTP status, a 404
 * included. Null until the first attempt settles, false on a timeout or a
 * network error. "Answered" is not "served a usable list": a site with no
 * list is a reachable backend. Changes are announced on the document as
 * "backend-reachability" with `{ reachable }`, so UI can subscribe without
 * polling this.
 */
export function backendReachable(): boolean | null {
  return reachable;
}

function setReachable(next: boolean, cause?: unknown): void {
  if (next === reachable) return;
  const first = reachable === null;
  reachable = next;
  // Only transitions are logged: the heartbeat runs forever and an offline
  // player must not get a console line every RETRY_INTERVAL_MS.
  if (!next) {
    console.warn("Server list API unreachable, using known values", cause);
  } else if (!first) {
    console.info("Server list API reachable again");
  }
  document.dispatchEvent(
    new CustomEvent("backend-reachability", { detail: { reachable: next } }),
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
    setReachable(false, e);
    return null;
  }
  setReachable(true);
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
 * existing "update available" prompt — but only on a page that names no
 * server of its own. A page a game server rendered gets "fallback" instead:
 * that server runs this build, and a reload re-serves the same page from
 * it, so an update prompt there would loop forever. Joining or rejoining
 * an existing game, and every in-game request, can ignore it: they get the
 * list applied either way, so a game's own letter still routes.
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
  // by letter from the list — that is why the list is applied either way —
  // and own-server calls fall back to the page's own values.
  ClientEnv.applyServerList(list, null);
  // A page a game server rendered is a page that server is running this
  // build to serve, and a reload comes back from the same server with the
  // same build. So the list has nothing to move it to: whatever the list
  // says (a deploy the registry never recorded, most often), the page's own
  // injected server is the server for its build. Answer "fallback" — own
  // server, page values, exactly as when the API is unreachable — rather
  // than "outdated", which would prompt a reload that changes nothing and
  // prompts again. Rollover still reaches these pages the way it does
  // today: the lobby feed's drain/`active:false` signal.
  if (servedByGameServer()) return "fallback";
  // A Worker-served page names no server, so a reload really does fetch
  // `latest`. If a newer version exists, say so and let the caller prompt.
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
  // A page that carries its own server was served by a game server running
  // this build, and while that server is up a reload re-fetches the same
  // page from it: there is nothing to update to, so the list must not make
  // it outdated. apply() already answers "fallback" for such a page; the
  // guard is repeated here so no future caller of isOutdated can reach the
  // prompt-and-reload loop by another route. Once that server has proven
  // unreachable the question changes — see newerVersionAvailable.
  if (servedByGameServer()) return false;
  return behindLatest(list, own);
}

/**
 * Is there a newer build than this page's, that a reload could land on?
 *
 * The POST-FAILURE question, asked by PublicLobbySocket.promptIfOutdated
 * after reconnecting has given up: "my server is gone — is there a newer
 * build out there?". Deliberately NOT the page-load status: it honours the
 * desktop, replay-shell and pinned-page exemptions (those pages must never
 * be told to reload at all) but not the served-by-game-server guard.
 *
 * The two differ because the reload loop only exists while the page's own
 * server is alive and serving it: there, a reload comes back from the same
 * server on the same build, so "outdated" would prompt forever (OPE-430).
 * A tab whose socket has failed maxWsAttempts times has the opposite
 * problem — its deployment was drained then fenced or removed, no feed is
 * left to carry the `active:false` signal, and a reload goes through the
 * page host (reloadForUpdate re-enters via siteHost), which the load
 * balancer answers from a LIVE deployment. Prompting there is the rescue.
 *
 * False when no list has ever loaded: nothing is known to update to.
 */
export function newerVersionAvailable(): boolean {
  const list = cached?.list ?? null;
  if (list === null) return false;
  try {
    return behindLatest(list, safeOwnCommit());
  } catch {
    return false;
  }
}

const OWN_SERVER_PROBE_TIMEOUT_MS = 5_000;

/**
 * Whether the page's own game server still answers plain HTTP.
 *
 * The post-failure rescue (PublicLobbySocket.promptIfOutdated) rests on a
 * dead socket meaning the server is gone. A socket can also die while the
 * server is fine -- a proxy that blocks WebSocket upgrades but passes HTTP,
 * a WebSocket-only outage -- and then a reload lands back on the same live
 * server, the socket fails the same way, and the prompt loops (OPE-430's
 * shape again, paced by maxWsAttempts). So the rescue checks its premise:
 * one GET of the server's health route. Any HTTP answer, a 503 included,
 * is the server being there; only a network error or a timeout is not.
 */
export async function ownServerReachable(
  fetchFn: typeof fetch = fetch,
): Promise<boolean> {
  try {
    await fetchFn(`${ClientEnv.serverHttpBase()}/api/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(OWN_SERVER_PROBE_TIMEOUT_MS),
    });
    return true;
  } catch {
    return false;
  }
}

// Behind the list's `latest`, for the shells that may be told to reload at
// all. Everything isOutdated tests except the served-by-game-server guard,
// which is the one difference between the page-load and post-failure
// questions above.
function behindLatest(list: ServerList, own: string): boolean {
  if (isDesktopShell()) return false;
  if (isOnReplayShell()) return false;
  if (isPinnedToAVersion()) return false;
  if (list.latest === undefined) return false;
  return !versionMatches(own, list.latest);
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
