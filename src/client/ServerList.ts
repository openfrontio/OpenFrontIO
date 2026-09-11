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

// Multi-server v2 (docs/MultiServer.md, "Server list v2"): the API says which
// servers are running, on which commit, and whether they take new games. This
// module fetches that list only when a server is actually needed (the public
// lobby list, creating a game, joining one), never at page load: offline
// singleplayer must not wait on the network. Whatever it learns is handed to
// ClientEnv, whose synchronous accessors every socket and URL builder already
// reads; when the list is missing or unreachable ClientEnv keeps answering
// from BOOTSTRAP_CONFIG, so the client behaves exactly as it does today until
// the API serves a list.

// A fresh list is reused for this long: every join and create asks, and the
// API caches the response for a few seconds anyway.
const LIST_TTL_MS = 10_000;
// Bounded so an unreachable API costs one short wait, after which the
// bootstrap values take over.
const FETCH_TIMEOUT_MS = 5_000;

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
let inflight: Promise<ServerListStatus> | null = null;
let pickedLetter: string | null = null;

/** Test-only. */
export function resetServerList(): void {
  cached = null;
  inflight = null;
  pickedLetter = null;
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

async function fetchServerList(site: string): Promise<ServerList | null> {
  try {
    const res = await fetch(serverListUrl(site), {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const parsed = ServerListSchema.safeParse(await res.json());
    if (!parsed.success) {
      console.warn("Invalid server list", z.prettifyError(parsed.error));
      return null;
    }
    // A site nobody has registered under is the same as no list.
    if (Object.keys(parsed.data.servers).length === 0) return null;
    return parsed.data;
  } catch (e) {
    console.warn("Server list unavailable, using page values", e);
    return null;
  }
}

/**
 * Make sure ClientEnv knows the freshest server list it can get, and that a
 * server for new games has been picked. Await this before anything that
 * needs a server; it never throws, and resolves with what happened.
 *
 * The pick is sticky for the page's lifetime while its server stays open,
 * so the lobby list and the games created from it land on one server. It
 * moves only when that server stops taking new games.
 */
export async function ensureServerList(): Promise<ServerListStatus> {
  if (inflight !== null) return inflight;
  inflight = refresh()
    .catch((e: unknown) => {
      // The contract is "never throws": whatever went wrong, the page's
      // own values are still a complete answer.
      console.warn("Server list refresh failed, using page values", e);
      return "fallback" as const;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

async function refresh(): Promise<ServerListStatus> {
  let list: ServerList | null;
  if (cached !== null && Date.now() - cached.fetchedAt < LIST_TTL_MS) {
    list = cached.list;
  } else {
    const site = safeSite();
    list = site === undefined ? null : await fetchServerList(site);
    cached = list === null ? null : { list, fetchedAt: Date.now() };
  }
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
