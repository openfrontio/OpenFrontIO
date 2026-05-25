import {
  ClanExistsResponseSchema,
  clanExistsApiPath,
  type UserMeResponse,
} from "../core/ApiSchemas";

// Clan-existence probe used by the join-time ownership check.
//
// Only positive results are cached: a fictional tag (clan does not exist
// upstream) could legitimately become real moments later, and we don't want a
// stale "false" to leak a tag past the ownership check until TTL expiry.
// Positive results are safe to cache because a real clan stays real for the
// life of any reasonable cache entry, and a cache hit returns "exists=true",
// which only ever causes the tag to be dropped (fail-closed).

export const CLAN_EXISTS_FETCH_TIMEOUT_MS = 3000;
export const CLAN_EXISTS_CACHE_TTL_MS = 60_000;
export const CLAN_EXISTS_CACHE_MAX_ENTRIES = 1024;

interface CacheEntry {
  expiresAt: number;
}

// Insertion-ordered Map gives us a trivial FIFO/LRU: re-set on hit to bump
// freshness, evict from the oldest end when the bound is reached.
const positiveCache = new Map<string, CacheEntry>();

interface ProbeDeps {
  /** Base URL of the upstream auth API (issuer). */
  baseUrl: string;
  /** Injected so tests can stub network behavior. */
  fetcher?: typeof fetch;
  /** Injected so tests control time. */
  now?: () => number;
  /** Logger callback for unexpected statuses / transport errors. */
  onWarn?: (event: string, ctx: Record<string, unknown>) => void;
  /** Override the shared cache (tests). */
  cache?: Map<string, CacheEntry>;
  /** Override TTL / bound (tests). */
  ttlMs?: number;
  maxEntries?: number;
}

function getCachedExists(
  cache: Map<string, CacheEntry>,
  key: string,
  nowMs: number,
): boolean | undefined {
  const entry = cache.get(key);
  if (entry === undefined) return undefined;
  if (nowMs >= entry.expiresAt) {
    cache.delete(key);
    return undefined;
  }
  // Bump LRU recency.
  cache.delete(key);
  cache.set(key, entry);
  return true;
}

function setCachedExists(
  cache: Map<string, CacheEntry>,
  key: string,
  expiresAt: number,
  maxEntries: number,
): void {
  cache.set(key, { expiresAt });
  while (cache.size > maxEntries) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }
}

/**
 * Returns true if the tag matches a real clan upstream, false if it does not,
 * and null when the result is inconclusive (transport error, timeout, or
 * unexpected status). Callers should treat null as fail-closed (drop the tag).
 */
export async function clanExistsByTag(
  tag: string,
  deps: ProbeDeps,
): Promise<boolean | null> {
  const cache = deps.cache ?? positiveCache;
  const now = deps.now ?? Date.now;
  const fetcher = deps.fetcher ?? fetch;
  const ttlMs = deps.ttlMs ?? CLAN_EXISTS_CACHE_TTL_MS;
  const maxEntries = deps.maxEntries ?? CLAN_EXISTS_CACHE_MAX_ENTRIES;

  const cacheKey = tag.toUpperCase();
  const cached = getCachedExists(cache, cacheKey, now());
  if (cached === true) return true;

  try {
    const url = `${deps.baseUrl}${clanExistsApiPath(tag)}`;
    const response = await fetcher(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(CLAN_EXISTS_FETCH_TIMEOUT_MS),
    });
    if (response.status === 200) {
      // Upstream currently has no body; tolerate {exists:false} for forward-compat.
      try {
        const text = await response.text();
        if (text.length > 0) {
          const parsed = ClanExistsResponseSchema.safeParse(JSON.parse(text));
          if (parsed.success && parsed.data?.exists === false) {
            return false;
          }
        }
      } catch {
        // Forward-compat parsing only; ignore failures.
      }
      setCachedExists(cache, cacheKey, now() + ttlMs, maxEntries);
      return true;
    }
    if (response.status === 404) {
      return false;
    }
    deps.onWarn?.("clanExistsByTag: unexpected status, failing closed", {
      tag: cacheKey,
      status: response.status,
    });
    return null;
  } catch (e) {
    deps.onWarn?.("clanExistsByTag: fetch failed, failing closed", {
      tag: cacheKey,
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

/**
 * Decide whether a player may wear the given (already-censored) clan tag.
 *
 * - Members of the tag's clan always pass through unchanged.
 * - Non-members keep the tag only when the upstream API confirms the clan
 *   does not exist (fictional tag).
 * - Inconclusive existence results drop the tag (fail-closed).
 *
 * @returns the resolved tag (the original or null) along with a `dropped` flag
 * so callers can log impersonation attempts.
 */
export async function resolveClanTag(
  censoredTag: string | null,
  userMeResponse: UserMeResponse | null,
  existsChecker: (tag: string) => Promise<boolean | null>,
): Promise<{
  tag: string | null;
  dropped: boolean;
  reason?: "exists" | "inconclusive";
}> {
  if (censoredTag === null) return { tag: null, dropped: false };

  const userClanTags = new Set(
    userMeResponse
      ? (userMeResponse.player.clans ?? []).map((c) => c.tag.toUpperCase())
      : [],
  );
  if (userClanTags.has(censoredTag.toUpperCase())) {
    return { tag: censoredTag, dropped: false };
  }

  const exists = await existsChecker(censoredTag);
  if (exists === false) {
    return { tag: censoredTag, dropped: false };
  }
  return {
    tag: null,
    dropped: true,
    reason: exists === true ? "exists" : "inconclusive",
  };
}

/** Exposed for tests so each spec starts with a clean cache. */
export function __resetClanExistsCacheForTests(): void {
  positiveCache.clear();
}

/** Exposed for tests/observability. */
export function __peekClanExistsCacheSize(): number {
  return positiveCache.size;
}
