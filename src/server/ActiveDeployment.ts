import { z } from "zod";
import { ClusterColorSchema, type ClusterColor } from "../core/ClusterConfig";

const HealthSchema = z.object({ color: ClusterColorSchema });

/**
 * Ask the site host (the load balancer, e.g. `openfront.io`) which deployment
 * COLOR it currently routes to, by reading the color its /api/health reports.
 *
 * Color, not instanceId: with several machines per color behind the apex, an
 * active server polling it usually reaches a SIBLING — same color, different
 * instanceId — and an identity compare would wrongly drain the whole active
 * fleet. Color is deployment-wide; instanceId is per-machine.
 *
 * Returns null when the answer is unusable (network error, non-JSON, a build
 * that doesn't report a color yet). Callers must treat null as "no change",
 * never as "inactive": a Cloudflare hiccup or bot challenge must not stop the
 * live deployment from scheduling lobbies. The failure mode of staying active
 * is the pre-feature status quo.
 */
export async function fetchSiteColor(
  siteHost: string,
  fetchFn: typeof fetch = fetch,
): Promise<ClusterColor | null> {
  try {
    const res = await fetchFn(`https://${siteHost}/api/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    const parsed = HealthSchema.safeParse(await res.json());
    return parsed.success ? parsed.data.color : null;
  } catch {
    return null;
  }
}
