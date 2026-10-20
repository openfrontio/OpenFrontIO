import { z } from "zod";
import { ServerEnv } from "./ServerEnv";

const MapWeightOverrideSchema = z.object({
  ffaFrequency: z.number().int().nonnegative().optional(),
  teamFrequency: z.number().int().nonnegative().optional(),
  specialFrequency: z.number().int().nonnegative().optional(),
  // Fill-rate weights computed nightly by the API from how fast each map's
  // lobbies fill (infra docs/map-fill-weights.md). They scale the frequency
  // for that queue, overridden or not; absent means 1.
  ffaMultiplier: z.number().positive().optional(),
  teamMultiplier: z.number().positive().optional(),
  specialMultiplier: z.number().positive().optional(),
});

const MapWeightsResponseSchema = z.object({
  maps: z.record(z.string(), MapWeightOverrideSchema),
});

// Keyed by map name (the GameMapType value). Each entry uses info.json's
// field names, so MapPlaylist spreads it over the build's MapInfo; an absent
// field keeps the build's value and 0 takes the map out of that queue. The
// multipliers are applied on top (MapPlaylist.buildMapsList).
export type MapWeightOverrides = z.infer<
  typeof MapWeightsResponseSchema
>["maps"];

export const MAP_WEIGHTS_POLL_MS = 60_000;

/**
 * Fetch the public-lobby rotation weight overrides set in the API.
 *
 * Throws on timeout/non-200/malformed response — the caller keeps the
 * overrides it last fetched.
 */
export async function fetchMapWeights(): Promise<MapWeightOverrides> {
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
