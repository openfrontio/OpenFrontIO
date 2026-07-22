import { z } from "zod";
import { ServerEnv } from "./ServerEnv";

const UsernameCheckResponseSchema = z.object({
  bannedIndices: z.array(z.number().int().nonnegative()),
});

/**
 * Batch-check display names against the API's moderation pipeline
 * (POST /username_check). Returns the subset of `usernames` that must not be
 * displayed, or null on any failure — failures are transient by contract:
 * callers keep the verdicts they already have and retry on the next poll.
 */
export async function fetchBannedUsernames(
  usernames: string[],
): Promise<Set<string> | null> {
  try {
    const response = await fetch(`${ServerEnv.jwtIssuer()}/username_check`, {
      method: "POST",
      signal: AbortSignal.timeout(5000),
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ServerEnv.apiKey(),
      },
      body: JSON.stringify({ usernames }),
    });
    if (!response.ok) {
      return null;
    }
    const parsed = UsernameCheckResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      return null;
    }
    const banned = new Set<string>();
    for (const index of parsed.data.bannedIndices) {
      if (index < usernames.length) {
        banned.add(usernames[index]);
      }
    }
    return banned;
  } catch {
    return null;
  }
}
