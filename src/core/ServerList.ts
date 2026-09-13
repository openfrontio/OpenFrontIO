import { z } from "zod";

// The API-served server list (docs/MultiServer.md, "Server list v2"). Where
// the CLUSTER_JSON map (ClusterConfig.ts) is configuration every server
// carries, this is discovery: the API reports which servers are actually
// running, which commit each runs, and whether it takes new games. The
// client filters it by its own build, so every client gets the same
// response and the API can cache it for a few seconds.
//
// Pure: no window, no fetch. The client runtime lives in
// src/client/ServerList.ts.

// A commit identifier: a 7+ character hex prefix of a sha, or the full 40.
// Declared before the schemas because they validate with it.
const COMMIT_RE = /^[0-9a-f]{7,40}$/i;

export function isCommitLike(value: string): boolean {
  return COMMIT_RE.test(value);
}

// Every commit the list names is validated on the way in. Commits decide
// which server a build may use, and a commit-shaped value is the only thing
// those compares — and `/v/<commit>/`, which pins a page to a version — can
// work with. A list carrying anything else is rejected whole and the client
// falls back to its own values.
const CommitSchema = z.string().regex(COMMIT_RE);

export const ServerStateSchema = z.enum(["open", "draining", "fenced"]);
export type ServerState = z.infer<typeof ServerStateSchema>;

export const ServerEntrySchema = z.object({
  // Where this server is reached directly (never a load balancer).
  host: z.string().min(1),
  // Frozen while the letter has live games: ids route to workers by hash.
  numWorkers: z.number().int().min(1),
  // The commit this server runs, as its GIT_COMMIT reports it.
  version: CommitSchema,
  // open: runs `latest`, so it takes new games from clients on that build.
  // draining: runs an older build, and still takes new games from clients
  // on THAT build — a player who loaded before the deploy keeps playing
  // where they are until they refresh. fenced: takes nothing new (the
  // server is on its way out); its live games and rejoins still work.
  state: ServerStateSchema,
});
export type ServerEntry = z.infer<typeof ServerEntrySchema>;

// Same letter constraint as ClusterConfig: the letter leads every game id.
const LetterSchema = z.string().regex(/^[a-z]$/);

export const ServerListSchema = z.object({
  // The commit new players should be on. Absent when the site has no
  // version flagged (e.g. a preview whose server expired).
  latest: CommitSchema.optional(),
  servers: z.record(LetterSchema, ServerEntrySchema),
});
export type ServerList = z.infer<typeof ServerListSchema>;

const VERSION_PREFIX_RE = /^\/v\/([^/]+)(\/|$)/;
const WORKER_PREFIX_RE = /^\/w\d+\//;

/**
 * Whether two commit identifiers name the same commit. Servers report the
 * full 40-char sha (GIT_COMMIT) while the pipeline and URLs use short
 * prefixes, so the shorter of the two is matched as a prefix of the longer.
 * Anything that isn't commit-shaped only matches itself.
 */
export function commitsMatch(a: string, b: string): boolean {
  if (!isCommitLike(a) || !isCommitLike(b)) return a === b;
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x.length <= y.length ? y.startsWith(x) : x.startsWith(y);
}

/**
 * Whether a server running `serverVersion` can serve a client built from
 * `ownCommit`. A build label that isn't a commit ("DEV" from the dev server,
 * "desktop" from a shell predating the stamped baseline) names no build, so
 * it must not filter every server out: it matches any version.
 */
export function versionMatches(
  ownCommit: string,
  serverVersion: string,
): boolean {
  if (!isCommitLike(ownCommit)) return true;
  return commitsMatch(ownCommit, serverVersion);
}

/**
 * The letters that can take a new game from this client's build, split by
 * state. A fenced server takes nothing new whatever it runs, and a server
 * on another build cannot host this one's games at all.
 */
function lettersForBuild(
  list: ServerList,
  ownCommit: string,
): { open: string[]; draining: string[] } {
  const open: string[] = [];
  const draining: string[] = [];
  for (const [letter, entry] of Object.entries(list.servers)) {
    if (!versionMatches(ownCommit, entry.version)) continue;
    if (entry.state === "open") open.push(letter);
    else if (entry.state === "draining") draining.push(letter);
  }
  return { open, draining };
}

/**
 * Whether `letter`'s server can still take a new game from this build —
 * the condition the client's sticky pick holds on. A pick survives its
 * server flipping from open to draining: that server still runs this
 * build, and moving the page off it mid-session is exactly the rollover
 * today's players don't get.
 */
export function servesBuild(
  list: ServerList,
  letter: string,
  ownCommit: string,
): boolean {
  const entry = list.servers[letter];
  if (entry === undefined) return false;
  if (entry.state === "fenced") return false;
  return versionMatches(ownCommit, entry.version);
}

/**
 * Pick the server a new game or the public lobby list should use: an open
 * server on this client's build, else a draining one on this client's
 * build, else null. Never a fenced server.
 *
 * `pickIndex` chooses among the candidates and is given their count; it is
 * injected both so tests can pin the draw and because src/core carries no
 * floating-point math — the client passes
 * `(n) => Math.floor(Math.random() * n)`. An index outside the range is
 * clamped, so a miscounting caller still lands on a server.
 */
export function pickServerForBuild(
  list: ServerList,
  ownCommit: string,
  pickIndex: (count: number) => number,
): string | null {
  const { open, draining } = lettersForBuild(list, ownCommit);
  const candidates = open.length > 0 ? open : draining;
  if (candidates.length === 0) return null;
  const chosen = pickIndex(candidates.length);
  const index = Number.isInteger(chosen)
    ? Math.min(candidates.length - 1, Math.max(0, chosen))
    : 0;
  return candidates[index];
}

/**
 * Split a `/v/<commit>/…` pathname into the commit and the path under it.
 * The site serves every version's page at that prefix, so a page has to
 * read its own routes through it, and a redirect between versions has to
 * replace rather than stack it.
 */
export function stripVersionPrefix(pathname: string): {
  commit: string | null;
  path: string;
} {
  const m = pathname.match(VERSION_PREFIX_RE);
  if (m === null) return { commit: null, path: pathname };
  const rest = pathname.slice(m[0].length);
  return { commit: m[1], path: "/" + rest };
}

// The pipeline publishes each version's page under the first 7 lowercase
// characters of its sha (`sites/<site>/v/<short7>/index.html`), and the
// static Worker keys on the same 7. Servers report the full 40-char sha
// (GIT_COMMIT), so anything that goes INTO a URL has to be narrowed to that
// form -- see commitsMatch, which exists because the two spellings coexist.
const SHORT_COMMIT_LENGTH = 7;

/**
 * A commit as a `/v/<commit>/` URL segment spells it: the first 7 lowercase
 * hex characters. A value that names no commit is left alone -- it cannot be
 * truncated into something meaningful, and commitsMatch only matches it
 * against itself anyway.
 */
export function shortCommit(commit: string): string {
  if (!isCommitLike(commit)) return commit;
  return commit.toLowerCase().slice(0, SHORT_COMMIT_LENGTH);
}

/**
 * The URL (path + search) that loads `commit`'s page for the current
 * document, keeping the game path. Worker prefixes are origin-specific
 * and letter routing re-resolves them, so they are dropped. The commit is
 * emitted short (shortCommit): that is the spelling the bucket layout and
 * the static Worker use, and a caller hands us whatever the server list
 * carries, which is the full sha. Returns null when the page is already
 * under `/v/<commit>/`: that is the one loop guard shared by every caller
 * that pins a page to a version, and it must stay here so no caller can
 * navigate a page to itself.
 */
export function versionedPath(
  commit: string,
  pathname: string,
  search: string,
): string | null {
  const { commit: current, path } = stripVersionPrefix(pathname);
  if (current !== null && commitsMatch(current, commit)) return null;
  const bare = path.replace(WORKER_PREFIX_RE, "/");
  return `/v/${shortCommit(commit)}${bare}${search}`;
}

// A version-free game path as the site serves it: `/game/<id>` or
// `/w<n>/game/<id>`, the two shapes Main.handleUrl's route matcher accepts
// (it matches a prefix, so a trailing segment or a query is fine).
const GAME_PATH_RE = /^(?:\/w\d+)?\/game\/([^/?#]+)/;

/**
 * Whether a version-free pathname is the page of `gameID` specifically --
 * not the homepage, not a menu route, and not ANOTHER game's page.
 *
 * The redirect below preserves the current path only when it passes this,
 * because the two callers reach it from quite different places: handleUrl
 * runs on `/game/<id>` (where the path IS the game), while
 * checkActiveLobby also runs from the homepage on a typed or pasted code
 * and from a click in the lobby list, where it is not.
 */
function pathNamesGame(versionFreePath: string, gameID: string): boolean {
  const m = versionFreePath.match(GAME_PATH_RE);
  if (m === null) return false;
  let id = m[1];
  try {
    id = decodeURIComponent(id);
  } catch {
    // A malformed escape is not a game id; compare the raw segment.
  }
  return id === gameID;
}

/**
 * Where to send a page that is opening a game whose server runs a different
 * build, or null to stay put and open it here.
 *
 * The decision, shared by the two places a game is opened from a URL
 * (Main.handleUrl's `/game/<id>` branch and JoinLobbyModal.checkActiveLobby),
 * so they cannot drift apart:
 *
 * - `gameVersion` undefined — no list loaded, or a letter it doesn't carry:
 *   nothing is known about the game's server, and a navigation on a guess
 *   would be worse than joining and finding out.
 * - the versions match — including a build whose own label names no commit
 *   ("DEV", "desktop"), which matches anything and must never be sent off
 *   its own server. See versionMatches.
 * - the page already lives under `/v/<gameVersion>/` yet still isn't that
 *   build (the version's page isn't being served). That is the loop guard,
 *   and falling through hands the mismatch to join-time `version_mismatch`,
 *   which redirects cross-host.
 *
 * WHICH path gets versioned is the other half of the rule, and it is decided
 * by `gameID`, not by the address bar. Only when the current path names THIS
 * game is it carried over (with its search — `?lobby`, `?spectate`, `?host`
 * all belong to that game). Otherwise the target is built from
 * `gameVersionFreePath`, the game's own version-free path
 * (`ClientEnv.gamePath(gameID)`), with no search: checkActiveLobby is also
 * called from the homepage, where keeping `window.location.pathname` would
 * send the player to the other build's HOME page and silently drop the code
 * they just typed, and from a page showing a DIFFERENT game, where it would
 * route them into that one instead.
 *
 * Desktop never calls this: its updater owns which version it runs.
 */
export function versionedPathForGame(
  ownCommit: string,
  gameVersion: string | undefined,
  gameID: string,
  gameVersionFreePath: string,
  pathname: string,
  search: string,
): string | null {
  if (gameVersion === undefined) return null;
  if (versionMatches(ownCommit, gameVersion)) return null;
  const { commit: current, path } = stripVersionPrefix(pathname);
  // The loop guard, applied to where the page IS rather than to the target,
  // so it holds on the rebuilt path too.
  if (current !== null && commitsMatch(current, gameVersion)) return null;
  return pathNamesGame(path, gameID)
    ? versionedPath(gameVersion, pathname, search)
    : versionedPath(gameVersion, gameVersionFreePath, "");
}
