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

export const ServerStateSchema = z.enum(["open", "draining"]);
export type ServerState = z.infer<typeof ServerStateSchema>;

export const ServerEntrySchema = z.object({
  // Where this server is reached directly (never a load balancer).
  host: z.string().min(1),
  // Frozen while the letter has live games: ids route to workers by hash.
  numWorkers: z.number().int().min(1),
  // The commit this server runs, as its GIT_COMMIT reports it.
  version: z.string().min(1),
  // open: runs `latest` and isn't fenced, so it takes new games. draining:
  // anything else; existing games and rejoins still work.
  state: ServerStateSchema,
});
export type ServerEntry = z.infer<typeof ServerEntrySchema>;

// Same letter constraint as ClusterConfig: the letter leads every game id.
const LetterSchema = z.string().regex(/^[a-z]$/);

export const ServerListSchema = z.object({
  // The commit new players should be on. Absent when the site has no
  // version flagged (e.g. a preview whose server expired).
  latest: z.string().min(1).optional(),
  servers: z.record(LetterSchema, ServerEntrySchema),
});
export type ServerList = z.infer<typeof ServerListSchema>;

const COMMIT_RE = /^[0-9a-f]{7,40}$/i;
const VERSION_PREFIX_RE = /^\/v\/([^/]+)(\/|$)/;
const WORKER_PREFIX_RE = /^\/w\d+\//;

export function isCommitLike(value: string): boolean {
  return COMMIT_RE.test(value);
}

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
 * The letters of servers that take new games for this client's build.
 */
export function openLettersFor(list: ServerList, ownCommit: string): string[] {
  return Object.entries(list.servers)
    .filter(
      ([, entry]) =>
        entry.state === "open" && versionMatches(ownCommit, entry.version),
    )
    .map(([letter]) => letter);
}

/**
 * Pick the server a new game or the public lobby list should use: random
 * among the open servers running the client's build, or null when there is
 * none. `random` is injected so tests can pin the draw.
 */
export function pickOpenServer(
  list: ServerList,
  ownCommit: string,
  random: () => number,
): string | null {
  const letters = openLettersFor(list, ownCommit);
  if (letters.length === 0) return null;
  const index = Math.min(
    letters.length - 1,
    Math.max(0, Math.floor(random() * letters.length)),
  );
  return letters[index];
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

/**
 * The URL (path + search) that loads `commit`'s page for the current
 * document, keeping the game path. Worker prefixes are origin-specific
 * and letter routing re-resolves them, so they are dropped. Returns null
 * when the page is already under `/v/<commit>/`: that is the one loop guard
 * for every version redirect, and it must stay here so no caller can
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
  return `/v/${commit}${bare}${search}`;
}
