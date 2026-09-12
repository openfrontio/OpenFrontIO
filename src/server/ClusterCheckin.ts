import { z } from "zod";
import { ServerEnv } from "./ServerEnv";

// Multi-server v2 (docs/MultiServer.md, "Server list v2"): every server
// tells the API on boot and every CHECKIN_INTERVAL_MS who it is and what it
// runs, and the API answers with whether this server should take new games.
// The API's list is what clients read (src/client/ServerList.ts), so a
// server that is not checking in is not offered to anyone; a deploy that
// fails halfway can't leave the list claiming servers that aren't there.
//
// The reply is only obeyed when CLUSTER_STATE_SOURCE=api. Until then the
// drain decision stays with today's apex colour poll (ActiveDeployment.ts),
// so this can ship before the API serves the registry.

export const CHECKIN_INTERVAL_MS = 10_000;
const CHECKIN_TIMEOUT_MS = 8_000;

// The states the API assigns (infra #700), the same vocabulary the client
// reads from GET /cluster.json:
//   open: runs the site's `latest` and isn't fenced, so it takes new games.
//   draining: on its way out (an older version, a deploy moving off it);
//     existing games and rejoins still work, it just gets no new ones.
//   fenced: deliberately held out of rotation by an operator. Same effect
//     here as draining, but the API keeps them apart so the list can say
//     why. Only "open" takes new games, so a state we fail to recognise
//     must never be read as open (see sendCheckin: it returns null).
export const ServerStateSchema = z.enum(["open", "draining", "fenced"]);
export type ServerState = z.infer<typeof ServerStateSchema>;

export type ClusterStateSource = "apex" | "api";

export interface CheckinBody {
  // The hostname players load the page from: the apex behind a load
  // balancer (SITE_HOST), else this deployment's own host, so beta,
  // nightly, alpha and branch previews each register under themselves.
  // Lists are keyed by it. Mirrors, such as the openfront.dev apex
  // serving nightly, are an alias table in the API, never something a
  // server reports about itself.
  site: string;
  letter: string;
  host: string;
  // GIT_COMMIT, the full sha. Clients compare it prefix-tolerantly.
  version: string;
  numWorkers: number;
  liveGames: number;
}

const CheckinReplySchema = z.object({ state: ServerStateSchema });

/**
 * What this server reports, or null under local development (`npm run dev`:
 * no SUBDOMAIN, so no public host), where there is nothing to register.
 * Every deployed host has one and registers under its own site.
 */
export function checkinBody(liveGames: number): CheckinBody | null {
  const host = ServerEnv.publicHost();
  if (host === undefined) return null;
  const { letter, entry } = ServerEnv.clusterSelf();
  return {
    site: ServerEnv.siteHost() ?? host,
    letter,
    host,
    version: ServerEnv.gitCommit(),
    numWorkers: entry.numWorkers,
    liveGames,
  };
}

/**
 * One check-in. Returns the state the API assigned, or null when the answer
 * is unusable (the API predates the registry, a bot challenge, a network
 * error). Callers must treat null as "no change", never as "drain": the
 * failure mode of an unreachable API is the status quo.
 */
export async function sendCheckin(
  body: CheckinBody,
  fetchFn: typeof fetch = fetch,
): Promise<ServerState | null> {
  try {
    const res = await fetchFn(`${ServerEnv.jwtIssuer()}/cluster/checkin`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ServerEnv.apiKey(),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(CHECKIN_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const parsed = CheckinReplySchema.safeParse(await res.json());
    return parsed.success ? parsed.data.state : null;
  } catch {
    return null;
  }
}

/**
 * Turn a check-in reply into the lobby service's active flag, but only when
 * the API is the configured source of that decision. Active means "open";
 * draining and fenced both stop new games. Pure, so the switch is testable
 * without booting the master.
 */
export function applyCheckinState(
  state: ServerState | null,
  source: ClusterStateSource,
  setActive: (active: boolean) => void,
): void {
  if (state === null || source !== "api") return;
  setActive(state === "open");
}
