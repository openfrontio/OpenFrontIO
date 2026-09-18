import type winston from "winston";
import { z } from "zod";
import { isCommitLike, isSiteLike } from "../core/ServerList";
import { registeredSite } from "./ClusterCheckin";
import type { GameManager } from "./GameManager";
import type { MapPlaylist } from "./MapPlaylist";
import { startPolling } from "./PollingLoop";
import { ServerEnv } from "./ServerEnv";

// The ranked (matchmaking) side of the drain, the counterpart to
// ClusterCheckin.ts on the master. A worker long-polls
// `${jwtIssuer}/matchmaking/checkin` to offer itself as the host for the next
// match; the API hands back an assignment and the worker creates the game.
//
// That offer must follow the deployment's active flag. Until OPE-469 it did
// not: on 15 Sept 2026 blue was `draining` with v0.34.0 while every
// openfront.io page served green's v0.34.1, and blue's workers kept checking
// in. Players on the new build were matched into blue's games, were answered
// `version_mismatch`, navigated to blue's page to get the matching build, and
// arrived after the start deadline — so the match cancelled short-handed
// ("cancelling matchmade game, missing players at deadline" across blue's
// logs) and the game was pruned before they could connect.
//
// Games already assigned or running are untouched by this: the gate only
// decides whether to make a NEW offer.

export type RankedMode = "1v1" | "2v2";

// How long a single check-in may hang before we abort and come round again.
// The endpoint is a long poll, so a request pending for most of this is the
// normal, empty-queue case — the abort is expected, not an error.
const CHECKIN_ABORT_MS = 20_000;

// The gap between check-ins. Jittered so a worker fleet restarted together
// does not synchronise into one thundering herd against the API.
const CHECKIN_INTERVAL_MS = 5_000;
const CHECKIN_JITTER_MS = 1_000;

// Deadline for the slowest matched player: after match-assignment the client
// still has to poll game existence, pass Turnstile, and clear join auth;
// anyone not connected when start() fires is left out of the roster and the
// ranked game starts short-handed. A full lobby is NOT delayed by this —
// hasReachedMaxPlayerCount flips the phase to Active as soon as everyone has
// joined.
const MATCH_START_DEADLINE_MS = 15_000;

export const MatchmakingAssignmentSchema = z.object({
  // Flat list of matched players' publicIds.
  players: z.array(z.string()),
  // The matcher's team split ([[a],[b]] for 1v1). Optional for tolerance,
  // but the current API always sends it.
  teams: z.array(z.array(z.string())).optional(),
});

export const RANKED_PAUSED_LOG =
  "ranked matchmaking paused: deployment draining";
export const RANKED_RESUMED_LOG =
  "ranked matchmaking resumed: deployment active";

/**
 * The decision "may this deployment offer a ranked match right now?", kept
 * apart from the loop so it is testable without a network or a GameManager.
 *
 * `isActive` is read fresh on every pass rather than latched, because the flag
 * flips underneath us: the master reconciles BOTH drain sources — the
 * registry's check-in answer (`open` vs `draining`/`fenced`) and the apex
 * colour poll — into one boolean and pushes it to the workers, so the worker
 * only has to obey whatever it last heard.
 *
 * The default before the first master broadcast is active (see
 * `WorkerLobbyService.deploymentActive`), which is exactly the pre-OPE-469
 * behaviour: a worker that never hears from its master keeps taking matches
 * rather than silently refusing to host any.
 *
 * One gate is shared by every mode's loop so a drain logs once, not once per
 * queue.
 */
export class RankedCheckinGate {
  // Seeded active so the first pass of a healthy worker logs nothing; only a
  // real flip is worth a line.
  private lastActive = true;

  constructor(
    private readonly isActive: () => boolean,
    private readonly log: Pick<winston.Logger, "info">,
  ) {}

  shouldCheckIn(): boolean {
    const active = this.isActive();
    if (active !== this.lastActive) {
      this.lastActive = active;
      this.log.info(active ? RANKED_RESUMED_LOG : RANKED_PAUSED_LOG);
    }
    return active;
  }
}

export interface RankedCheckinDeps {
  gm: GameManager;
  playlist: MapPlaylist;
  workerId: number;
  log: winston.Logger;
  // Whether this deployment may take new games, as the master last told this
  // worker. Defaults to true before the first broadcast.
  isActive: () => boolean;
  // Injectable for tests; production uses the global fetch.
  fetchFn?: typeof fetch;
}

/**
 * The build this server runs, for the check-in body's `version` (OPE-470,
 * infra #732): the Lobby assigns a match only to a server whose version
 * matches the players', which is the contract version of what the drain gate
 * above enforces by deployment state. Missing matches missing, so a server
 * that sends nothing is treated exactly as before.
 *
 * Sent only when GIT_COMMIT is actually commit-shaped. A malformed value is
 * a 400 from the API, and the two non-sha labels a build can carry — "DEV"
 * from `npm run start:server-dev`, "unknown" from the Dockerfile's default —
 * name no build, so there is nothing to match against. Lowercased because
 * the field is specified lowercase; real shas already are.
 *
 * A spread of {} rather than `version: undefined`: JSON.stringify drops the
 * key either way, but an explicit undefined would leave every reader
 * wondering which it is (the same choice as ClusterCheckin's `machine`).
 */
function buildVersionField(): { version?: string } {
  const commit = ServerEnv.gitCommit();
  return isCommitLike(commit) ? { version: commit.toLowerCase() } : {};
}

/**
 * The site this server registers under (ClusterCheckin.registeredSite), for
 * the check-in body's `site`. The API keeps one ranked queue per site: only
 * players whose page reads this site's server list can resolve the game id
 * this server offers, so those are the only players it may host — and the
 * Lobby checks this site's registry that the server is `open` before
 * handing it a match, the second guard on the gate above.
 *
 * Sent only when it is a name the API's SiteSchema accepts, for the same
 * reason as `version`: a malformed value is a 400, not "no site". Local
 * development has no public host and sends nothing, landing in the legacy
 * shared pool exactly as before.
 */
function buildSiteField(): { site?: string } {
  const site = registeredSite();
  return site !== undefined && isSiteLike(site) ? { site } : {};
}

/**
 * One check-in pass. Exported for tests: the polling wrapper is what makes
 * the real loop awkward to drive, not the body.
 */
export async function rankedCheckinPass(
  mode: RankedMode,
  gate: RankedCheckinGate,
  deps: RankedCheckinDeps,
): Promise<void> {
  const { gm, playlist, workerId, log } = deps;
  const fetchFn = deps.fetchFn ?? fetch;

  // Before anything else, and before the long poll is opened: a draining,
  // standby or fenced deployment must not be holding a slot in the queue.
  if (!gate.shouldCheckIn()) return;

  try {
    const url = `${ServerEnv.jwtIssuer() + "/matchmaking/checkin"}`;
    const gameId = ServerEnv.generateGameIdForWorker(workerId);
    if (gameId === null) {
      log.warn(`Failed to generate game ID for worker ${workerId}`);
      return;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CHECKIN_ABORT_MS);
    const response = await fetchFn(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ServerEnv.apiKey(),
      },
      body: JSON.stringify({
        id: workerId,
        gameId: gameId,
        ccu: gm.activeClients(),
        instanceId: process.env.INSTANCE_ID,
        mode,
        ...buildVersionField(),
        ...buildSiteField(),
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      log.warn(
        `Failed to poll ${mode} lobby: ${response.status} ${response.statusText}`,
      );
      return;
    }

    const data = await response.json();
    log.info(`Lobby ${mode} poll successful:`, data);

    if (data.assignment) {
      const parsed = MatchmakingAssignmentSchema.safeParse(data.assignment);
      if (!parsed.success) {
        // Don't strand the matched players: create the game without
        // the allowlist/team pins rather than dropping the match.
        log.warn(
          `Unexpected ${mode} assignment shape: ${z.prettifyError(parsed.error)}`,
        );
      }
      const baseConfig =
        mode === "2v2" ? playlist.get2v2Config() : playlist.get1v1Config();
      const game = gm.createGame(
        gameId,
        parsed.success
          ? { ...baseConfig, allowedPublicIds: parsed.data.players }
          : baseConfig,
        undefined,
        Date.now() + MATCH_START_DEADLINE_MS,
        undefined,
        parsed.success ? parsed.data.teams : undefined,
      );
      if (game === null) {
        log.warn(`Failed to create matchmaking game ${gameId}`);
      }
    }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      // Abort is expected if no game is scheduled on this worker.
      return;
    }
    log.error(`Error polling ${mode} lobby:`, error);
  }
}

/**
 * Start the ranked check-in loops for this worker. One check-in serves
 * exactly one queue, so a host serving both modes runs one long-poll loop per
 * mode — over a single shared gate, so a drain is announced once.
 */
export function startRankedCheckinLoops(deps: RankedCheckinDeps): void {
  const gate = new RankedCheckinGate(deps.isActive, deps.log);
  for (const mode of ["1v1", "2v2"] as const) {
    startPolling(
      async () => rankedCheckinPass(mode, gate, deps),
      CHECKIN_INTERVAL_MS + Math.random() * CHECKIN_JITTER_MS,
    );
  }
}
