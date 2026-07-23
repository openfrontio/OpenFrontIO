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
    username: z.string().optional(),
    clanTag: z.string().nullable().optional(),
  }),
]);

export type JoinVerifyResponse =
  | { status: "approved"; username: string; clanTag: string | null }
  | {
      status: "rejected";
      reason: string;
      username: string | null;
      clanTag: string | null;
    }
  | { status: "error"; reason: string };

/**
 * Verify a joining player against the API's join_verify endpoint, which runs
 * the Turnstile check and name censoring concurrently: `status` is purely the
 * Turnstile verdict, and the display-ready (username, clanTag) pair comes
 * back either way — a banned username as its deterministic shadow name, a
 * banned tag as null, a surviving tag uppercased.
 *
 * The token is nullable: reconnects pass null (their single-use token is
 * spent), get a moot "rejected" verdict without a siteverify call, and still
 * receive the censored identity.
 *
 * The endpoint fails closed with a 5xx when Cloudflare siteverify is down, so
 * HTTP failures retry once and then return "error"; the caller lets the
 * player in with their name as-is, matching the old standalone-Turnstile
 * stance.
 */
export async function verifyJoin(
  ip: string,
  turnstileToken: string | null,
  username: string,
  clanTag: string | null,
): Promise<JoinVerifyResponse> {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
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
      if (response.status >= 400 && response.status < 500) {
        // Bad payload or auth — retrying as-is won't help.
        return {
          status: "error",
          reason: `api-worker returned ${response.status}`,
        };
      }
      if (!response.ok) {
        continue;
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
      return {
        status: "rejected",
        reason: parsed.data.reason,
        username: parsed.data.username ?? null,
        clanTag: parsed.data.clanTag ?? null,
      };
    } catch {
      // Timeout or network error — retry once.
    }
  }
  return { status: "error", reason: "api-worker unavailable" };
}
