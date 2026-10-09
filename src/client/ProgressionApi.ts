import {
  type GameXpResponse,
  GameXpResponseSchema,
  type ProgressionConfig,
  ProgressionConfigSchema,
  type PublicProgress,
  PublicProgressSchema,
} from "@openfront/shared/ApiSchemas";
// ApiBase rather than Api: this module is imported by in-game UI (WinModal)
// whose tests stub Api wholesale.
import { getApiBase } from "./ApiBase";
import { getAuthHeader } from "./Auth";

// Player levels / XP. Every helper here fails closed: progression is purely
// cosmetic, so any error hides the UI rather than surfacing a failure.

export type GameXpFetchResult =
  | { status: "ok"; data: GameXpResponse }
  // 404 (not processed yet, or progression off) or a transient failure —
  // worth asking again while the caller is still polling.
  | { status: "pending" }
  // A conclusion: signed out, or a body we cannot read. Stop asking.
  | { status: "unavailable" };

// The request's own timeout, plus the caller's signal when there is one, so
// aborting cancels a request already in flight rather than leaving it to run
// to its timeout. Without AbortSignal.any (older browsers), just the timeout.
function requestSignal(signal: AbortSignal | undefined): AbortSignal {
  const timeout = AbortSignal.timeout(10_000);
  if (signal === undefined || typeof AbortSignal.any !== "function") {
    return timeout;
  }
  return AbortSignal.any([signal, timeout]);
}

// GET /users/@me/xp/:gameId — the XP the caller earned in one game.
export async function fetchMyGameXp(
  gameId: string,
  signal?: AbortSignal,
): Promise<GameXpFetchResult> {
  try {
    const authorization = await getAuthHeader();
    if (authorization === "") return { status: "unavailable" };
    const res = await fetch(
      `${getApiBase()}/users/@me/xp/${encodeURIComponent(gameId)}`,
      {
        headers: { Accept: "application/json", Authorization: authorization },
        signal: requestSignal(signal),
      },
    );
    if (res.status === 404) return { status: "pending" };
    if (res.status === 401 || res.status === 403) {
      return { status: "unavailable" };
    }
    if (!res.ok) {
      console.warn("fetchMyGameXp: unexpected status", res.status);
      return { status: "pending" };
    }
    const parsed = GameXpResponseSchema.safeParse(await res.json());
    if (!parsed.success) {
      console.warn("fetchMyGameXp: Zod validation failed", parsed.error);
      return { status: "unavailable" };
    }
    return { status: "ok", data: parsed.data };
  } catch (err) {
    // The caller gave up: not a failure worth a warning.
    if (signal?.aborted) return { status: "pending" };
    console.warn("fetchMyGameXp: request failed", err);
    return { status: "pending" };
  }
}

export interface PollGameXpOptions {
  intervalMs?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  // Injectable for tests.
  fetcher?: (
    gameId: string,
    signal?: AbortSignal,
  ) => Promise<GameXpFetchResult>;
}

/**
 * Asks for a game's XP until it is processed, the deadline passes, or the
 * caller aborts. Resolves to the response, or null when there is nothing to
 * show (timed out, signed out, unreadable, aborted) — never a zero.
 */
export async function pollGameXp(
  gameId: string,
  opts: PollGameXpOptions = {},
): Promise<GameXpResponse | null> {
  const intervalMs = opts.intervalMs ?? 3_000;
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const fetcher = opts.fetcher ?? fetchMyGameXp;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (opts.signal?.aborted) return null;
    const result = await fetcher(gameId, opts.signal);
    if (opts.signal?.aborted) return null;
    if (result.status === "ok") return result.data;
    if (result.status === "unavailable") return null;
    if (Date.now() + intervalMs > deadline) return null;
    const signal = opts.signal;
    await new Promise<void>((resolve) => {
      // Whichever fires first tears down the other, so a long poll never
      // piles one abort listener per wait onto the caller's signal.
      const onAbort = () => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, intervalMs);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }
}

// GET /public/player/:publicId/progress — another player's level. False on a
// 404 (unknown player, progression off) and every other failure.
export async function fetchPublicPlayerProgress(
  publicId: string,
): Promise<PublicProgress | false> {
  try {
    const res = await fetch(
      `${getApiBase()}/public/player/${encodeURIComponent(publicId)}/progress`,
      {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (res.status === 404) return false;
    if (!res.ok) {
      console.warn("fetchPublicPlayerProgress: unexpected status", res.status);
      return false;
    }
    const parsed = PublicProgressSchema.safeParse(await res.json());
    if (!parsed.success) {
      console.warn(
        "fetchPublicPlayerProgress: Zod validation failed",
        parsed.error,
      );
      return false;
    }
    return parsed.data;
  } catch (err) {
    console.warn("fetchPublicPlayerProgress: request failed", err);
    return false;
  }
}

// The server's max-age for the config: a deploy that changes it has to reach
// open tabs within this.
const PROGRESSION_CONFIG_TTL_MS = 60_000;

let progressionConfig: {
  request: Promise<ProgressionConfig | false>;
  at: number;
} | null = null;

// GET /public/progression/config — the level curve, and whether progression is
// on at all (404 when it is off). Memoised for as long as the server says it
// stays fresh; a failure is not, so a later caller can try again.
export function fetchProgressionConfig(): Promise<ProgressionConfig | false> {
  if (
    progressionConfig !== null &&
    Date.now() - progressionConfig.at < PROGRESSION_CONFIG_TTL_MS
  ) {
    return progressionConfig.request;
  }
  const request = (async (): Promise<ProgressionConfig | false> => {
    try {
      const res = await fetch(`${getApiBase()}/public/progression/config`, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return false;
      const parsed = ProgressionConfigSchema.safeParse(await res.json());
      if (!parsed.success) {
        console.warn(
          "fetchProgressionConfig: Zod validation failed",
          parsed.error,
        );
        return false;
      }
      return parsed.data;
    } catch (err) {
      console.warn("fetchProgressionConfig: request failed", err);
      return false;
    }
  })();
  const entry = { request, at: Date.now() };
  progressionConfig = entry;
  void request.then((config) => {
    if (progressionConfig !== entry) return;
    // Fresh from the response, like the server's max-age.
    if (config === false) progressionConfig = null;
    else entry.at = Date.now();
  });
  return request;
}
