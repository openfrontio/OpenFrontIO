import { z } from "zod";
import { ClusterColorSchema, type ClusterColor } from "../core/ClusterConfig";
import type { ClusterStateSource } from "./ClusterCheckin";

const HealthSchema = z.object({ color: ClusterColorSchema });

/**
 * Whether this deployment should poll the site host's /api/health to learn
 * which colour is live (the pre-registry drain decision). All four conditions
 * must hold:
 *
 *  - the drain decision comes from the apex, not the API — two deciders would
 *    fight over setActive;
 *  - there IS a page host to ask;
 *  - it is not this deployment's own game host, or we would be asking
 *    ourselves;
 *  - and the cluster map has siblings. This last one is what makes a page
 *    host separate from the game host safe (docs/MultiServer.md, "Two
 *    hostnames per deployment"): with GAME_DOMAIN set, every dev deployment
 *    gets a SITE_HOST, including standalone ones whose page host is served by
 *    the static Worker and answers no /api/health at all. A one-entry map is
 *    a standalone deployment by definition — nothing to flip to, so nothing
 *    to poll for.
 *
 * Pure, so the decision is testable without booting the master. Narrows
 * `siteHost` on the way out: "we should poll" implies there is a host to
 * poll, so the caller gets the string without re-checking for undefined.
 */
export function shouldPollApex(
  stateSource: ClusterStateSource,
  siteHost: string | undefined,
  publicHost: string | undefined,
  clusterSize: number,
): siteHost is string {
  return (
    stateSource === "apex" &&
    siteHost !== undefined &&
    siteHost !== publicHost &&
    clusterSize > 1
  );
}

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
