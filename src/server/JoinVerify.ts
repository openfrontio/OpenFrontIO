import { z } from "zod";
import { ServerEnv } from "./ServerEnv";

const JoinVerifyVerdictSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("approved"),
    username: z.string(),
    clanTag: z.string().nullable().optional(),
  }),
  z.object({
    status: z.literal("rejected"),
    reason: z.string(),
  }),
]);

export type JoinVerifyResponse =
  | { status: "approved"; username: string; clanTag: string | null }
  | { status: "rejected"; reason: string }
  | { status: "error"; reason: string };

export type JoinVerifyPlan =
  | { action: "reject" } // first join with no Turnstile token
  | { action: "skip" } // the verdict couldn't change anything
  | { action: "verify"; token: string | null };

/**
 * Pure decision for whether a join needs a join_verify call, kept free of
 * I/O so the gating logic is unit-testable.
 *
 * SECURITY: the API skips siteverify entirely when the token is null,
 * trusting the game server to only do that for already-admitted reconnects
 * (whose single-use token is spent). A first join must therefore present a
 * token — rejecting instead of forwarding a null one, which would be a full
 * Turnstile bypass.
 *
 * Re-admits verify with a null token (name check alone), and only when the
 * verdict could matter: identity updates apply only before the game starts,
 * and an unchanged identity was already screened when it was admitted. The
 * skips keep mass reconnects at game start off the API.
 */
export function planJoinVerify(args: {
  isReadmit: boolean;
  gameStarted: boolean;
  turnstileToken: string | null;
  identityUnchanged: boolean;
}): JoinVerifyPlan {
  if (!args.isReadmit) {
    if (!args.turnstileToken) {
      return { action: "reject" };
    }
    return { action: "verify", token: args.turnstileToken };
  }
  if (args.gameStarted || args.identityUnchanged) {
    return { action: "skip" };
  }
  return { action: "verify", token: null };
}

/**
 * Verify a joining player against the API's join_verify endpoint, which runs
 * the Turnstile check and name censoring concurrently: `status` is the
 * Turnstile verdict, and on approval the (username, clanTag) pair is the
 * display-ready identity for the session — a banned username as its
 * deterministic shadow name, a banned tag as null, a surviving tag
 * uppercased.
 *
 * SECURITY: a null token SKIPS siteverify — the API trusts the game server
 * to omit the token only for already-admitted reconnects (whose single-use
 * token is spent); those come back approved with just the name check run.
 * Callers must never forward a first join with a null token (see
 * planJoinVerify).
 *
 * Failures are never retried: a Turnstile token is single-use, so
 * re-submitting after a timeout or 5xx can redeem an already-spent token and
 * turn an API hiccup into a hard rejection of a legitimate player. Any
 * failure returns "error" and the caller fails open with the locally
 * screened name (see Censor.ts), matching the old standalone-Turnstile
 * stance.
 */
export async function verifyJoin(
  ip: string,
  turnstileToken: string | null,
  username: string,
  clanTag: string | null,
): Promise<JoinVerifyResponse> {
  try {
    const response = await fetch(`${ServerEnv.jwtIssuer()}/join_verify`, {
      method: "POST",
      // First sighting of a novel flagged name adds an LLM round-trip of
      // up to ~3s server-side, so the timeout must stay at 5s or above.
      signal: AbortSignal.timeout(5000),
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ServerEnv.apiKey(),
      },
      body: JSON.stringify({ ip, token: turnstileToken, username, clanTag }),
    });
    if (!response.ok) {
      return {
        status: "error",
        reason: `api-worker returned ${response.status}`,
      };
    }
    const parsed = JoinVerifyVerdictSchema.safeParse(await response.json());
    if (!parsed.success) {
      return {
        status: "error",
        reason: `api-worker returned malformed response: ${parsed.error.message}`,
      };
    }
    if (parsed.data.status === "approved") {
      return {
        status: "approved",
        username: parsed.data.username,
        clanTag: parsed.data.clanTag ?? null,
      };
    }
    return parsed.data;
  } catch (e) {
    return { status: "error", reason: `api-worker unavailable: ${e}` };
  }
}
