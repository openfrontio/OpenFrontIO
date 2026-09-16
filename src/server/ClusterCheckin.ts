import { z } from "zod";
import { ServerEnv } from "./ServerEnv";

// Multi-server v2 (docs/MultiServer.md, "Server list v2"): every server
// tells the API on boot and every CHECKIN_INTERVAL_MS who it is and what it
// runs, and the API answers with whether this server should take new games.
// The API's list is what clients read (src/client/ServerList.ts), so a
// server that is not checking in is not offered to anyone; a deploy that
// fails halfway can't leave the list claiming servers that aren't there.
//
// The reply is only obeyed when CLUSTER_STATE_SOURCE=api, which every
// deployment sets; any other value leaves the server permanently active
// (the apex colour poll that used to fill that gap is gone with the
// cluster map).

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
  // The PAGE host: the hostname players load the page from (SITE_HOST) —
  // the apex behind a load balancer, `<subdomain>.<DOMAIN>` where a separate
  // GAME_DOMAIN gives the deployment two names (docs/MultiServer.md, "Two
  // hostnames per deployment"), else this deployment's own host, so an
  // old-style beta, nightly, alpha or branch preview registers under itself.
  // Lists are keyed by it. Mirrors, such as the openfront.dev apex serving
  // nightly, are an alias table in the API, never something a server reports
  // about itself.
  site: string;
  letter: string;
  // The GAME host: where clients open sockets and send /api for games this
  // server runs (ServerEnv.publicHost). Distinct from `site` whenever
  // something else owns the page host — a load balancer on prod, the static
  // Worker on a dev deployment with GAME_DOMAIN set.
  host: string;
  // GIT_COMMIT, the full sha. Clients compare it prefix-tolerantly.
  version: string;
  numWorkers: number;
  liveGames: number;
  // The machine this container runs on (ServerEnv.machine(), ultimately
  // deploy.sh's machine argument): `falk2`, `nbg2`, `staging`. The registry
  // uses it to keep a site to at most one OPEN server per machine (OPE-455),
  // since blue and green frequently share a box. Omitted entirely when
  // MACHINE is unset or malformed — the registry's schema predates the field
  // and an absent key is exactly what it expects.
  machine?: string;
}

const CheckinReplySchema = z.object({ state: ServerStateSchema });

/**
 * The site this server registers under: the page host (SITE_HOST — the apex
 * for blue/green, `<subdomain>.<DOMAIN>` under GAME_DOMAIN), else its own
 * public host for an old-style standalone deploy. Undefined under local
 * development, where there is no public host and nothing registers. The
 * ranked check-in names the same site (RankedCheckin.ts), so the API pools
 * this server only with players whose page reads this site's list.
 */
export function registeredSite(): string | undefined {
  return ServerEnv.siteHost() ?? ServerEnv.publicHost();
}

/**
 * What this server reports, or null under local development (`npm run dev`:
 * no SUBDOMAIN, so no public host), where there is nothing to register.
 * Every deployed host has one and registers under its own site.
 */
export function checkinBody(liveGames: number): CheckinBody | null {
  const host = ServerEnv.publicHost();
  if (host === undefined) return null;
  const machine = ServerEnv.machine();
  return {
    site: registeredSite() ?? host,
    letter: ServerEnv.instanceLetter(),
    host,
    version: ServerEnv.gitCommit(),
    numWorkers: ServerEnv.numWorkers(),
    liveGames,
    // Spread, not `machine: undefined`: JSON.stringify would drop the key
    // either way, but an explicit undefined would make every equality
    // assertion here and every future reader wonder which it is.
    ...(machine !== undefined ? { machine } : {}),
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
