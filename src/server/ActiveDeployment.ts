import { z } from "zod";

const HealthSchema = z.object({ instanceId: z.string() });

/**
 * Ask the site host (the load balancer, e.g. `openfront.io`) which deployment
 * it currently routes to, by reading the instanceId its /api/health reports.
 *
 * Returns null when the answer is unusable (network error, non-JSON, a build
 * that doesn't report an instanceId yet). Callers must treat null as "no
 * change", never as "inactive": a Cloudflare hiccup or bot challenge must not
 * stop the live deployment from scheduling lobbies. The failure mode of
 * staying active is the pre-feature status quo.
 */
export async function fetchSiteInstanceId(
  siteHost: string,
  fetchFn: typeof fetch = fetch,
): Promise<string | null> {
  try {
    const res = await fetchFn(`https://${siteHost}/api/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    const parsed = HealthSchema.safeParse(await res.json());
    return parsed.success ? parsed.data.instanceId : null;
  } catch {
    return null;
  }
}
