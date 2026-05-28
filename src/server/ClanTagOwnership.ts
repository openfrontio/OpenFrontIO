import { clanExistsApiPath, type UserMeResponse } from "../core/ApiSchemas";

export const CLAN_EXISTS_FETCH_TIMEOUT_MS = 3000;

interface ProbeDeps {
  /** Base URL of the upstream auth API (issuer). */
  baseUrl: string;
  /** Injected so tests can stub network behavior. */
  fetcher?: typeof fetch;
  /** Logger callback for unexpected statuses / transport errors. */
  onWarn?: (event: string, ctx: Record<string, unknown>) => void;
}

/**
 * Returns true if the tag matches a real clan upstream, false if it does not,
 * and null when the result is inconclusive (transport error, timeout, or
 * unexpected status). Callers treat null as fail-closed (drop the tag).
 */
export async function clanExistsByTag(
  tag: string,
  deps: ProbeDeps,
): Promise<boolean | null> {
  const fetcher = deps.fetcher ?? fetch;
  try {
    const response = await fetcher(`${deps.baseUrl}${clanExistsApiPath(tag)}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(CLAN_EXISTS_FETCH_TIMEOUT_MS),
    });
    if (response.status === 200) return true;
    if (response.status === 404) return false;
    deps.onWarn?.("clanExistsByTag: unexpected status, failing closed", {
      tag: tag.toUpperCase(),
      status: response.status,
    });
    return null;
  } catch (e) {
    deps.onWarn?.("clanExistsByTag: fetch failed, failing closed", {
      tag: tag.toUpperCase(),
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

/**
 * Decide whether a player may wear the given (already-censored) clan tag.
 *
 * - Members of the tag's clan pass through unchanged.
 * - Non-members keep the tag only when the API confirms no such clan exists
 *   (a fictional tag).
 * - A real clan the player isn't in, or an inconclusive check, drops the tag
 *   (fail-closed) — `reason` lets callers log the impersonation attempt.
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
  if (exists === false) return { tag: censoredTag, dropped: false };
  return {
    tag: null,
    dropped: true,
    reason: exists === true ? "exists" : "inconclusive",
  };
}
