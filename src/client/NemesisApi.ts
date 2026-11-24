import { NEMESIS_MIN_ELIMINATIONS } from "@openfront/shared/PlayerCardSchemas";
import { z } from "zod";
import { getApiBase } from "./ApiBase";
import { getAuthHeader } from "./Auth";

// The eliminated-by screen's nemesis line: how many times the player who just
// eliminated you has done it this past week.

const NemesisResponseSchema = z.object({
  eliminations: z.number().int().nonnegative(),
});

// Past eliminations of the signed-in player by `publicId` (this game is not
// ingested yet, so not counted). Null when signed out (no request is made)
// or on any failure: the line is simply left off.
export async function fetchNemesisCount(
  publicId: string,
  signal?: AbortSignal,
): Promise<number | null> {
  try {
    const authorization = await getAuthHeader();
    if (authorization === "") return null;
    const response = await fetch(
      `${getApiBase()}/users/@me/nemesis/${encodeURIComponent(publicId)}`,
      { headers: { Authorization: authorization }, signal },
    );
    if (!response.ok) return null;
    const parsed = NemesisResponseSchema.safeParse(await response.json());
    return parsed.success ? parsed.data.eliminations : null;
  } catch {
    return null;
  }
}

// The line to show, counting this elimination, or null below the threshold.
export function nemesisLine(
  pastEliminations: number,
): { count: number } | null {
  const count = pastEliminations + 1;
  return count >= NEMESIS_MIN_ELIMINATIONS ? { count } : null;
}
