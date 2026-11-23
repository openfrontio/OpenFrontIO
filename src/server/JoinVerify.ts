import { z } from "zod";
import { ServerEnv } from "./ServerEnv";

export {
  clientAuth,
  isSteamAuthenticated,
  type ClientAuth,
} from "@openfront/shared/ApiSchemas";

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

export type JoinVerifyMode = "token" | "pass" | "readmit";

export type JoinVerifyPlan =
  | { action: "reject" } // first join with no Turnstile token and no account pass
  | { action: "skip" } // the verdict couldn't change anything
  | { action: "verify"; token: string | null; mode: JoinVerifyMode };

/**
 * Pure decision for whether a join needs a join_verify call, kept free of
 * I/O so the gating logic is unit-testable.
 *
 * SECURITY: the API skips siteverify entirely when the token is null,
 * trusting the game server to only do that for already-admitted reconnects
 * (whose single-use token is spent), Steam-authenticated joins, or
 * account-authenticated joins verified against a 6h Turnstile pass. An
 * anonymous first join must therefore present a token — rejecting instead of
 * forwarding a null one, which would be a full Turnstile bypass.
 *
 * Re-admits verify in "readmit" mode with a null token (name check alone),
 * and only when the verdict could matter: identity updates apply only before
 * the game starts, and an unchanged identity was already screened when it
 * was admitted. The skips keep mass reconnects at game start off the API.
 *
 * Exceptions for first joins without a Turnstile token:
 * - Steam-authenticated first joins (`steamAuthed`, see isSteamAuthenticated)
 *   verify in "readmit" mode with a null token — Steam ownership is the
 *   anti-abuse signal, and the join still runs the name check.
 * - Account-authenticated first joins (`accountAuthed`) without a Turnstile
 *   token verify in "pass" mode with a null token so the API can check for a
 *   valid 6h Turnstile pass (and still run the name check). If a token is
 *   present, "token" mode takes precedence over "pass".
 */
export function planJoinVerify(args: {
  isReadmit: boolean;
  gameStarted: boolean;
  turnstileToken: string | null;
  identityUnchanged: boolean;
  steamAuthed: boolean;
  accountAuthed: boolean;
}): JoinVerifyPlan {
  if (!args.isReadmit) {
    // Steam-authenticated first joins skip the Turnstile siteverify — Steam
    // ownership (a signed provider="steam" claim, set by infra only after
    // verifySteamTicket()) is the anti-abuse signal. "readmit" mode runs
    // the API's name check without checking a Turnstile pass or token.
    if (args.steamAuthed) {
      return { action: "verify", token: null, mode: "readmit" };
    }
    if (args.turnstileToken) {
      return { action: "verify", token: args.turnstileToken, mode: "token" };
    }
    if (args.accountAuthed) {
      return { action: "verify", token: null, mode: "pass" };
    }
    return { action: "reject" };
  }
  if (args.gameStarted || args.identityUnchanged) {
    return { action: "skip" };
  }
  return { action: "verify", token: null, mode: "readmit" };
}

// In-flight verifyJoin requests coalesced by mode-namespaced key:
// - pass:  pass\0persistentId\0ip\0username\0clanTag
// - token: token\0turnstileToken\0persistentId\0username\0clanTag
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
  persistentId?: string,
  mode?: JoinVerifyMode,
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
    body: JSON.stringify({
      ip,
      token,
      username,
      clanTag,
      ...(persistentId !== undefined && { persistentId }),
      ...(mode !== undefined && { mode }),
    }),
  });
}

async function verifyJoinRequest(
  ip: string,
  turnstileToken: string | null,
  username: string,
  clanTag: string | null,
  persistentId?: string,
  mode?: JoinVerifyMode,
): Promise<JoinVerifyResponse> {
  try {
    const response = await fetchJoinVerify(
      ip,
      turnstileToken,
      username,
      clanTag,
      persistentId,
      mode,
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

function coalesceInFlight(
  key: string,
  run: () => Promise<JoinVerifyResponse>,
): Promise<JoinVerifyResponse> {
  const inFlight = inFlightByToken.get(key);
  if (inFlight) {
    return inFlight;
  }
  const promise = run().finally(() => {
    inFlightByToken.delete(key);
  });
  inFlightByToken.set(key, promise);
  return promise;
}

/**
 * Verify a joining player against the API's join_verify endpoint, which runs
 * the Turnstile check (or 6h Turnstile pass check in "pass" mode) and name
 * censoring concurrently: `status` is the Turnstile verdict, and on approval
 * the (username, clanTag) pair is the display-ready identity for the session —
 * a banned username as its deterministic shadow name, a banned tag as null, a
 * surviving tag uppercased.
 *
 * SECURITY: a null token SKIPS siteverify — in "readmit" mode only the name
 * check runs, and in "pass" mode the API verifies an active 6h Turnstile pass
 * for `persistentId` + `ip`. Callers must never forward an anonymous first join
 * with a null token (see planJoinVerify).
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
  mode?: JoinVerifyMode,
): Promise<JoinVerifyResponse> {
  if (mode === "pass") {
    const key = `pass\0${persistentId ?? ""}\0${ip}\0${username}\0${clanTag ?? ""}`;
    return coalesceInFlight(key, () =>
      verifyJoinRequest(ip, null, username, clanTag, persistentId, "pass"),
    );
  }
  if (turnstileToken !== null && turnstileToken.length > 0) {
    const key = `token\0${turnstileToken}\0${persistentId ?? ""}\0${username}\0${clanTag ?? ""}`;
    return coalesceInFlight(key, () =>
      verifyJoinRequest(
        ip,
        turnstileToken,
        username,
        clanTag,
        persistentId,
        mode,
      ),
    );
  }
  return verifyJoinRequest(
    ip,
    turnstileToken,
    username,
    clanTag,
    persistentId,
    mode,
  );
}

export function _inFlightTokenCount(): number {
  return inFlightByToken.size;
}

export function _clearInFlightTokens(): void {
  inFlightByToken.clear();
}
