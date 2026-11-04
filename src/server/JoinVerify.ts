import type { TokenPayload } from "@openfront/shared/ApiSchemas";
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
    errorCodes: z.array(z.string()).optional(),
  }),
  // The API answered, but a leg (siteverify or the name check) failed or ran
  // past its budget. The name verdict rides along when the name check did
  // finish.
  z.object({
    status: z.literal("error"),
    reason: z.string(),
    username: z.string().optional(),
    clanTag: z.string().nullable().optional(),
  }),
]);

export type JoinVerifyResponse =
  | { status: "approved"; username: string; clanTag: string | null }
  | { status: "rejected"; reason: string; errorCodes?: string[] }
  | {
      status: "error";
      reason: string;
      // true when the API itself reported the failure (an expected,
      // budgeted degradation); false when it could not be reached or
      // answered with something unusable.
      degraded: boolean;
      // The API's display-ready identity, when its name check finished.
      identity?: { username: string; clanTag: string | null };
    };

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
 *
 * Exception: a Steam-authenticated first join (`steamAuthed`, see
 * isSteamAuthenticated) also verifies with a null token instead of
 * rejecting for a missing Turnstile token — Steam ownership is the
 * anti-abuse signal in that case, and the join still runs the name check.
 */
// A join is Steam-authenticated when its verified JWT carries provider="steam"
// (set by infra only after verifySteamTicket()). Never key this off the
// client-supplied instanceId — that is forgeable.
export function isSteamAuthenticated(claims: TokenPayload | null): boolean {
  return claims?.provider === "steam";
}

export type ClientAuth = "account" | "anonymous";

// A guest session carries a JWT too, so a non-null claims object is not a
// sign-in. Infra stamps provider only for a session with a persistent identity
// behind it (discord, google, steam, email, a portal account...), except for
// "guest", which a refreshed guest session carries; a freshly minted guest
// session has no provider at all.
export function clientAuth(claims: TokenPayload | null): ClientAuth {
  const provider = claims?.provider;
  return provider === undefined || provider === "guest"
    ? "anonymous"
    : "account";
}

export function planJoinVerify(args: {
  isReadmit: boolean;
  gameStarted: boolean;
  turnstileToken: string | null;
  identityUnchanged: boolean;
  steamAuthed: boolean;
}): JoinVerifyPlan {
  if (!args.isReadmit) {
    // Steam-authenticated first joins skip the Turnstile siteverify — Steam
    // ownership (a signed provider="steam" claim, set by infra only after
    // verifySteamTicket()) is the anti-abuse signal. A null token still runs
    // the API's name check, so banned/slur names are censored: the join is
    // VERIFIED (never skipped), it just omits the bot challenge.
    if (args.steamAuthed) {
      return { action: "verify", token: null };
    }
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

// In-flight verifyJoin requests coalesced by (token, persistentId, username, clanTag).
const inFlightByToken = new Map<string, Promise<JoinVerifyResponse>>();

function parseJoinVerifyResponse(data: unknown): JoinVerifyResponse {
  const parsed = JoinVerifyVerdictSchema.safeParse(data);
  if (!parsed.success) {
    return {
      status: "error",
      reason: `api-worker returned malformed response: ${parsed.error.message}`,
      degraded: false,
    };
  }
  if (parsed.data.status === "approved") {
    return {
      status: "approved",
      username: parsed.data.username,
      clanTag: parsed.data.clanTag ?? null,
    };
  }
  if (parsed.data.status === "error") {
    const { reason, username, clanTag } = parsed.data;
    return {
      status: "error",
      reason,
      degraded: true,
      ...(username !== undefined && {
        identity: { username, clanTag: clanTag ?? null },
      }),
    };
  }
  return parsed.data;
}

async function fetchJoinVerify(
  ip: string,
  token: string | null,
  username: string,
  clanTag: string | null,
): Promise<Response> {
  return fetch(`${ServerEnv.jwtIssuer()}/join_verify`, {
    method: "POST",
    // First sighting of a novel flagged name adds an LLM round-trip of
    // up to ~3s server-side, so the timeout must stay at 5s or above.
    signal: AbortSignal.timeout(5000),
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ServerEnv.apiKey(),
    },
    body: JSON.stringify({ ip, token, username, clanTag }),
  });
}

async function verifyJoinRequest(
  ip: string,
  turnstileToken: string | null,
  username: string,
  clanTag: string | null,
): Promise<JoinVerifyResponse> {
  try {
    const response = await fetchJoinVerify(
      ip,
      turnstileToken,
      username,
      clanTag,
    );
    if (!response.ok) {
      return {
        status: "error",
        reason: `api-worker returned ${response.status}`,
        degraded: false,
      };
    }
    return parseJoinVerifyResponse(await response.json());
  } catch (e) {
    return {
      status: "error",
      reason: `api-worker unavailable: ${e}`,
      degraded: false,
    };
  }
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
 * failure returns "error" and the caller fails open, matching the old
 * standalone-Turnstile stance: with the API's screened identity when it
 * sent one (a degraded verdict whose name check finished), otherwise with
 * the locally screened name (see Censor.ts).
 */
export async function verifyJoin(
  ip: string,
  turnstileToken: string | null,
  username: string,
  clanTag: string | null,
  persistentId?: string,
): Promise<JoinVerifyResponse> {
  if (turnstileToken !== null && turnstileToken.length > 0) {
    const key = `${turnstileToken}\0${persistentId ?? ""}\0${username}\0${clanTag ?? ""}`;
    const inFlight = inFlightByToken.get(key);
    if (inFlight) {
      return inFlight;
    }
    const promise = verifyJoinRequest(
      ip,
      turnstileToken,
      username,
      clanTag,
    ).finally(() => {
      inFlightByToken.delete(key);
    });
    inFlightByToken.set(key, promise);
    return promise;
  }
  return verifyJoinRequest(ip, turnstileToken, username, clanTag);
}

export function _inFlightTokenCount(): number {
  return inFlightByToken.size;
}

export function _clearInFlightTokens(): void {
  inFlightByToken.clear();
}
