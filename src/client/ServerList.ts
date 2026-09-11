import { z } from "zod";
import {
  commitsMatch,
  openLettersFor,
  pickOpenServer,
  ServerList,
  ServerListSchema,
  versionedPath,
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
// (backendReachable(), the "backend-reachability" document event).

// Bounded so an unreachable API costs one short wait, after which the
// bootstrap values take over.
const FETCH_TIMEOUT_MS = 4_000;
// Heartbeat: how long a list is served before it is revalidated in the
// background, and how soon a failed attempt is retried.
const REFRESH_INTERVAL_MS = 30_000;
const RETRY_INTERVAL_MS = 10_000;

export type ServerListStatus =
  // The list is loaded and an open server on this build was picked.
  | "api"
  // The list is missing or unreachable; BOOTSTRAP_CONFIG is in charge.
  | "fallback"
  // The list is loaded but no open server runs this build, and there is
  // nothing to redirect to: own-server calls fall back to BOOTSTRAP_CONFIG,
  // so multiplayer fails as it does today when the server is gone.
  | "no-server"
  // This page is out of date and a navigation to latest's page was issued.
  | "redirecting";

let cached: { list: ServerList; fetchedAt: number } | null = null;
let inflight: Promise<ServerList | null> | null = null;
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
      return list;
    })
    .catch(() => null)
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
 * flight (the page-load one, usually), or for one started here.
 *
 * The pick is sticky for the page's lifetime while its server stays open,
 * so the lobby list and the games created from it land on one server. It
 * moves only when that server stops taking new games.
 */
export async function ensureServerList(): Promise<ServerListStatus> {
  try {
    if (cached === null) {
      await fetchOnce();
    } else if (
      Date.now() - cached.fetchedAt >= REFRESH_INTERVAL_MS &&
      inflight === null
    ) {
      // Stale-while-revalidate: answer now, refresh behind the answer.
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

function apply(): ServerListStatus {
  const list = cached?.list ?? null;
  if (list === null) {
    pickedLetter = null;
    ClientEnv.applyServerList(null, null);
    return "fallback";
  }

  const own = safeOwnCommit();
  const open = openLettersFor(list, own);
  if (pickedLetter === null || !open.includes(pickedLetter)) {
    pickedLetter = pickOpenServer(list, own, Math.random);
  }
  if (pickedLetter !== null) {
    ClientEnv.applyServerList(list, pickedLetter);
    return "api";
  }

  // No open server runs this build. Existing games still resolve by letter
  // from the list; own-server calls fall back to the page's own values.
  ClientEnv.applyServerList(list, null);
  if (isOutOfDate(list, own)) {
    const target = versionedPath(
      list.latest!,
      window.location.pathname,
      window.location.search,
    );
    if (target !== null) {
      window.location.href = target;
      return "redirecting";
    }
  }
  return "no-server";
}

// Out of date means a newer version exists to go to. When this page IS
// latest, or the list names no latest, no server is running at all: there is
// nothing to redirect to, and redirecting would only loop back here. The
// desktop shell is never redirected: its updater owns which version it runs.
function isOutOfDate(list: ServerList, own: string): boolean {
  if (isDesktopShell()) return false;
  if (list.latest === undefined) return false;
  return !commitsMatch(own, list.latest);
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
