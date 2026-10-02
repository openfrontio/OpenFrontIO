import {
  type GameXpResponse,
  GameXpResponseSchema,
  type PrestigeResponse,
  PrestigeResponseSchema,
  type ProgressionConfig,
  ProgressionConfigSchema,
  type PublicProgress,
  PublicProgressSchema,
} from "../core/ApiSchemas";
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

// GET /users/@me/xp/:gameId — the XP the caller earned in one game.
export async function fetchMyGameXp(
  gameId: string,
): Promise<GameXpFetchResult> {
  try {
    const authorization = await getAuthHeader();
    if (authorization === "") return { status: "unavailable" };
    const res = await fetch(
      `${getApiBase()}/users/@me/xp/${encodeURIComponent(gameId)}`,
      {
        headers: { Accept: "application/json", Authorization: authorization },
        signal: AbortSignal.timeout(10_000),
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
    console.warn("fetchMyGameXp: request failed", err);
    return { status: "pending" };
  }
}

export interface PollGameXpOptions {
  intervalMs?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  // Injectable for tests.
  fetcher?: (gameId: string) => Promise<GameXpFetchResult>;
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
    const result = await fetcher(gameId);
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

// POST /users/@me/prestige — the opt-in reset at level 100. The caller keeps
// one idempotency key until a prestige succeeds, so a retried request (a
// slow network, a lost response) prestiges once. Unlike the reads above this
// does surface failure: the player asked for it and must be told why.
// - "refused": the server says the player can't prestige (409), usually an
//   earlier prestige whose answer never arrived.
// - "signed_out": no session to send, or the server rejected it (401/403).
// - "failed": anything else. It may or may not have gone through, and a
//   retry with the same key finds out.
export type PrestigeFailure = "refused" | "signed_out" | "failed";

export type PrestigeResult =
  | { ok: true; data: PrestigeResponse }
  | { ok: false; reason: PrestigeFailure };

export async function prestigeMe(
  idempotencyKey: string,
): Promise<PrestigeResult> {
  try {
    const authorization = await getAuthHeader();
    if (authorization === "") return { ok: false, reason: "signed_out" };
    const res = await fetch(`${getApiBase()}/users/@me/prestige`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: authorization,
        "Idempotency-Key": idempotencyKey,
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      console.warn("prestigeMe: unexpected status", res.status);
      if (res.status === 409) return { ok: false, reason: "refused" };
      if (res.status === 401 || res.status === 403) {
        return { ok: false, reason: "signed_out" };
      }
      return { ok: false, reason: "failed" };
    }
    const parsed = PrestigeResponseSchema.safeParse(await res.json());
    if (!parsed.success) {
      console.warn("prestigeMe: Zod validation failed", parsed.error);
      return { ok: false, reason: "failed" };
    }
    return { ok: true, data: parsed.data };
  } catch (err) {
    console.warn("prestigeMe: request failed", err);
    return { ok: false, reason: "failed" };
  }
}

let progressionConfig: Promise<ProgressionConfig | false> | null = null;

// GET /public/progression/config — the level curve, and whether progression is
// on at all (404 when it is off). Memoised for the page's lifetime; a failure
// is not, so a later caller can try again.
export function fetchProgressionConfig(): Promise<ProgressionConfig | false> {
  if (progressionConfig !== null) return progressionConfig;
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
  progressionConfig = request;
  void request.then((config) => {
    if (config === false && progressionConfig === request) {
      progressionConfig = null;
    }
  });
  return request;
}
