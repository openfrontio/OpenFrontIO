import {
  type FfaGameRatingResponse,
  FfaGameRatingResponseSchema,
} from "@openfront/shared/ApiSchemas";
// ApiBase rather than Api: this module is imported by in-game UI (WinModal)
// whose tests stub Api wholesale.
import { getApiBase } from "./ApiBase";
import { getAuthHeader } from "./Auth";
import {
  type PollOptions,
  pollUntilSettled,
  requestSignal,
} from "./ProgressionApi";

// FFA rating. Like progression, every helper here fails closed: the rating is
// extra information, so any error hides the UI rather than surfacing a failure.

export type FfaGameRatingFetchResult =
  | { status: "ok"; data: FfaGameRatingResponse }
  // 404 (not rated yet, or the rating is off) or a transient failure — worth
  // asking again while the caller is still polling. `notFound` marks the 404;
  // `rateLimited` marks a 429.
  | { status: "pending"; notFound?: true; rateLimited?: true }
  // A conclusion: signed out, or a body we cannot read. Stop asking.
  | { status: "unavailable" };

// GET /users/@me/ffa_rating/:gameId — the caller's rating change in one game.
export async function fetchMyFfaGameRating(
  gameId: string,
  signal?: AbortSignal,
): Promise<FfaGameRatingFetchResult> {
  try {
    const authorization = await getAuthHeader();
    if (authorization === "") return { status: "unavailable" };
    const res = await fetch(
      `${getApiBase()}/users/@me/ffa_rating/${encodeURIComponent(gameId)}`,
      {
        headers: { Accept: "application/json", Authorization: authorization },
        signal: requestSignal(signal),
      },
    );
    if (res.status === 404) return { status: "pending", notFound: true };
    if (res.status === 429) return { status: "pending", rateLimited: true };
    if (res.status === 401 || res.status === 403) {
      return { status: "unavailable" };
    }
    if (!res.ok) {
      console.warn("fetchMyFfaGameRating: unexpected status", res.status);
      return { status: "pending" };
    }
    const parsed = FfaGameRatingResponseSchema.safeParse(await res.json());
    if (!parsed.success) {
      console.warn("fetchMyFfaGameRating: Zod validation failed", parsed.error);
      return { status: "unavailable" };
    }
    return { status: "ok", data: parsed.data };
  } catch (err) {
    // The caller gave up: not a failure worth a warning.
    if (signal?.aborted) return { status: "pending" };
    console.warn("fetchMyFfaGameRating: request failed", err);
    return { status: "pending" };
  }
}

export interface PollFfaGameRatingOptions extends PollOptions {
  // Injectable for tests.
  fetcher?: typeof fetchMyFfaGameRating;
}

/**
 * Asks for a game's FFA rating until it is scored, the deadline passes, or the
 * caller aborts. Resolves to the response, or null when there is nothing to
 * show (timed out, signed out, unreadable, aborted).
 */
export function pollFfaGameRating(
  gameId: string,
  opts: PollFfaGameRatingOptions = {},
): Promise<FfaGameRatingResponse | null> {
  return pollUntilSettled(
    (signal) => (opts.fetcher ?? fetchMyFfaGameRating)(gameId, signal),
    opts,
  );
}
