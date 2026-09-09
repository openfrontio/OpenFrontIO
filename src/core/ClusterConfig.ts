import { z } from "zod";

// The cluster topology map (docs/MultiServer.md): every game-hosting
// deployment in the fleet, keyed by its instance letter. The letter is the
// first character of every game id the deployment mints, which is how a game
// id names its server for the rest of its life — so letters are append-only:
// retiring a deployment means draining it and deleting its entry, never
// reusing its letter for a different host.
//
// The map is configuration, not discovery: servers read it from the
// CLUSTER_JSON env at boot (ServerEnv), clients from BOOTSTRAP_CONFIG or
// GET /cluster.json. Every server carries the whole map and finds itself by
// host (SUBDOMAIN.DOMAIN, bare DOMAIN in dev).

export const ClusterColorSchema = z.enum(["blue", "green"]);
export type ClusterColor = z.infer<typeof ClusterColorSchema>;

export const ClusterEntrySchema = z.object({
  // Host the deployment is reachable on directly (e.g. "blue.openfront.io"),
  // bypassing any load balancer. Also the self-match key at boot.
  host: z.string().min(1),
  // Which blue/green pool the deployment belongs to. Deployment-wide, unlike
  // the per-machine instanceId — the drain check compares colors (PR 6).
  color: ClusterColorSchema,
  // Worker processes behind this host. Frozen for the lifetime of every game
  // id minted under it: ids route to workers by hash % numWorkers, so change
  // it only on a deploy after the color has fully drained.
  numWorkers: z.number().int().min(1),
});
export type ClusterEntry = z.infer<typeof ClusterEntrySchema>;

// Lowercase letter only: it leads every game id, and a single unambiguous
// case avoids letter-vs-Letter config drift. (Game-id validation accepts any
// alphanumeric, so the constraint can widen later without a wire change.)
const InstanceLetterSchema = z.string().regex(/^[a-z]$/);

export const ClusterConfigSchema = z
  .record(InstanceLetterSchema, ClusterEntrySchema)
  .refine((map) => Object.keys(map).length > 0, {
    message: "cluster map must have at least one entry",
  })
  .refine(
    (map) => {
      const hosts = Object.values(map).map((e) => e.host);
      return new Set(hosts).size === hosts.length;
    },
    { message: "cluster hosts must be unique" },
  );
export type ClusterConfig = z.infer<typeof ClusterConfigSchema>;
