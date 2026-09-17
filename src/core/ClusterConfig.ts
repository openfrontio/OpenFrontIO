import { z } from "zod";

// The shape a page or the desktop shell is handed for "which servers exist":
// entries keyed by instance letter, each naming a host and its worker count
// (docs/MultiServer.md). The letter is the first character of every game id
// the server mints, which is how a game id names its server for the rest of
// its life — so letters are append-only: retiring a server means draining it
// and never reusing its letter for a different host.
//
// This is no longer configuration. A server knows only ITSELF — its letter,
// game host and worker count arrive in its env from the deploy target
// (INSTANCE_LETTER, GAME_HOST, NUM_WORKERS; deploy.sh) — and ServerEnv.cluster
// synthesizes a one-entry map from them for the page it renders. The fleet
// as a whole is the API registry's list
// (src/core/ServerList.ts), which clients read; the one-entry map is the
// page's fallback when that list is unavailable.

export const ClusterEntrySchema = z.object({
  // Host the deployment is reachable on directly (e.g. "blue.openfront.io"),
  // bypassing any load balancer. Also the self-match key at boot.
  host: z.string().min(1),
  // Worker processes behind this host. Frozen for the lifetime of every game
  // id minted under it: ids route to workers by hash % numWorkers, so change
  // it only on a deploy after the letter has fully drained.
  numWorkers: z.number().int().min(1),
});
export type ClusterEntry = z.infer<typeof ClusterEntrySchema>;

// Lowercase letter only: it leads every game id, and a single unambiguous
// case avoids letter-vs-Letter config drift. (Game-id validation accepts any
// alphanumeric, so the constraint can widen later without a wire change.)
export const InstanceLetterSchema = z.string().regex(/^[a-z]$/);

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
