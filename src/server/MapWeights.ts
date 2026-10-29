import { z } from "zod";
import { ServerEnv } from "./ServerEnv";

const MapWeightSchema = z.object({
  ffaWeight: z.number().nonnegative().optional(),
  teamWeight: z.number().nonnegative().optional(),
  specialWeight: z.number().nonnegative().optional(),
});

const MapWeightsResponseSchema = z.object({
  maps: z.record(z.string(), MapWeightSchema),
});

// Keyed by map name (the GameMapType value): each map's public-lobby rotation
// weight per queue, which the API computes from fill rate (an admin override
// wins). A weight may be fractional; 0 takes the map out of that queue, and a
// map or queue the API leaves out gets MapPlaylist's DEFAULT_MAP_WEIGHT.
export type MapWeights = z.infer<typeof MapWeightsResponseSchema>["maps"];

export const MAP_WEIGHTS_POLL_MS = 60_000;

/**
 * Fetch the public-lobby rotation weights from the API.
 *
 * Throws on timeout/non-200/malformed response — the caller keeps the
 * weights it last fetched.
 */
export async function fetchMapWeights(): Promise<MapWeights> {
  const response = await fetch(`${ServerEnv.jwtIssuer()}/map_weights`, {
    signal: AbortSignal.timeout(5000),
    headers: { "x-api-key": ServerEnv.apiKey() },
  });
  if (!response.ok) {
    throw new Error(`map_weights returned ${response.status}`);
  }
  const parsed = MapWeightsResponseSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new Error(
      `map_weights returned malformed response: ${parsed.error.message}`,
    );
  }
  return parsed.data.maps;
}
