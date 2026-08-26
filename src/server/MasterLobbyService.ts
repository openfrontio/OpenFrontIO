import { Worker } from "cluster";
import winston from "winston";
import {
  MAX_HOSTED_LOBBIES,
  PublicGameType,
  SCHEDULED_PUBLIC_GAME_TYPES,
  ScheduledPublicGameType,
} from "../core/Schemas";
import { generateID } from "../core/Util";
import {
  InternalGameInfo,
  InternalGameInfoSchema,
  MasterCreateGame,
  MasterLobbiesBroadcast,
  MasterUpdateGame,
  WorkerMessageSchema,
} from "./IPCBridgeSchema";
import { logger } from "./Logger";
import { MapPlaylist } from "./MapPlaylist";
import { startPolling } from "./PollingLoop";
import { ServerEnv } from "./ServerEnv";

export interface MasterLobbyServiceOptions {
  playlist: MapPlaylist;
  log: typeof logger;
}

/**
 * Lobbies the master keeps open per scheduled type. One of the three counts
 * down at a time and the rest wait; the whole queue is advertised, so clients
 * can show what's coming, not just the lobby about to start.
 */
export const QUEUED_LOBBIES_PER_TYPE = 6;

/**
 * The order the lobby counting down cycles through. Which type is next comes
 * from this rotation rather than from the queues: a queued lobby is joinable, so
 * it can fill up and start out of turn, and taking whichever lobby is oldest let
 * that skip a type indefinitely.
 *
 * The schema's own list, not a copy of it: a copy proves membership but not
 * coverage, so a new scheduled type would silently never be promoted.
 */
export const PROMOTION_ROTATION = SCHEDULED_PUBLIC_GAME_TYPES;

/** The rotation, starting at the type after `previous`. */
function rotationFrom(
  previous: ScheduledPublicGameType | undefined,
): ScheduledPublicGameType[] {
  const from =
    previous === undefined ? 0 : PROMOTION_ROTATION.indexOf(previous) + 1;
  return PROMOTION_ROTATION.map(
    (_, i) => PROMOTION_ROTATION[(from + i) % PROMOTION_ROTATION.length],
  );
}

/**
 * The order lobbies will go live: the one counting down, then a lap of the
 * rotation from wherever it is, then the next lap. Clients render this as the
 * queue, so their "up next" is the lobby that is actually next.
 */
export function promotionOrder<
  T extends { startsAt?: number; publicGameType: PublicGameType },
>(
  byType: Readonly<Record<ScheduledPublicGameType, readonly T[]>>,
  lastPromoted: ScheduledPublicGameType | undefined,
): T[] {
  const laps = rotationFrom(lastPromoted).map((type) =>
    byType[type].filter((lobby) => lobby.startsAt === undefined),
  );
  const ordered = PROMOTION_ROTATION.flatMap((type) =>
    byType[type].filter((lobby) => lobby.startsAt !== undefined),
  );
  for (let lap = 0; lap < Math.max(0, ...laps.map((q) => q.length)); lap++) {
    for (const queue of laps) {
      if (queue[lap] !== undefined) ordered.push(queue[lap]);
    }
  }
  return ordered;
}

export class MasterLobbyService {
  private readonly workers = new Map<number, Worker>();
  // Worker id => the lobbies it owns.
  private readonly workerLobbies = new Map<number, InternalGameInfo[]>();
  private readonly readyWorkers = new Set<number>();
  // gameID => consecutive broadcast cycles a hosted lobby has lost the
  // per-creator dedup or overflowed the cluster-wide cap. Losing once can be
  // a stale worker report (a delisted lobby lingers for one report
  // round-trip); losing twice means the conflict is real, and the loser gets
  // delisted.
  private readonly loserStreaks = new Map<string, number>();
  // Where the rotation is: the type of the lobby that last counted down, kept
  // for the gap between that game starting and the next promotion. Read off the
  // live lobby, so it survives lobbies filling up and starting out of turn —
  // which reading the order off the queues could not.
  private lastPromoted: ScheduledPublicGameType | undefined;
  // The countdown handed out but not yet seen in a report. Scheduling polls
  // faster than workers report, and a lobby can fill up and start inside that
  // window without ever being reported carrying its startsAt — so this is what
  // moves the rotation on when the report never comes.
  private promoting:
    | { gameID: string; type: ScheduledPublicGameType }
    | undefined;
  private started = false;

  constructor(
    private playlist: MapPlaylist,
    private log: winston.Logger,
  ) {}

  registerWorker(workerId: number, worker: Worker) {
    this.workers.set(workerId, worker);

    worker.on("message", (raw: unknown) => {
      const result = WorkerMessageSchema.safeParse(raw);
      if (!result.success) {
        this.log.error("Invalid IPC message from worker:", raw);
        return;
      }

      const msg = result.data;
      switch (msg.type) {
        case "workerReady":
          this.handleWorkerReady(msg.workerId);
          break;
        case "lobbyList":
          this.workerLobbies.set(workerId, this.validLobbies(msg.lobbies));
          break;
      }
    });
  }

  // Lobby entries are validated individually so one malformed entry only
  // drops itself. Rejecting the whole report would freeze this worker's
  // lobbies in the master's view for as long as the bad entry exists —
  // stale broadcasts to every client, countdown resets, and duplicate
  // scheduling.
  private validLobbies(lobbies: unknown[]): InternalGameInfo[] {
    const valid: InternalGameInfo[] = [];
    for (const lobby of lobbies) {
      const result = InternalGameInfoSchema.safeParse(lobby);
      if (result.success) {
        valid.push(result.data);
      } else {
        this.log.error("Dropping invalid lobby in worker report:", lobby);
      }
    }
    return valid;
  }

  removeWorker(workerId: number) {
    this.workers.delete(workerId);
    this.workerLobbies.delete(workerId);
    this.readyWorkers.delete(workerId);
  }

  isHealthy(): boolean {
    // We consider the lobby service healthy if at least half of the workers are ready.
    // This allows for some leeway if a worker crashes.
    const minWorkers = Math.max(ServerEnv.numWorkers() / 2, 1);
    return this.started && this.readyWorkers.size >= minWorkers;
  }

  private handleWorkerReady(workerId: number) {
    this.readyWorkers.add(workerId);
    this.log.info(
      `Worker ${workerId} is ready. (${this.readyWorkers.size}/${ServerEnv.numWorkers()} ready)`,
    );
    if (this.readyWorkers.size === ServerEnv.numWorkers() && !this.started) {
      this.started = true;
      this.log.info("All workers ready, starting game scheduling");
      startPolling(async () => this.broadcastLobbies(), 500);
      startPolling(async () => await this.maybeScheduleLobby(), 1000);
    }
  }

  private getAllLobbies(): {
    games: Record<PublicGameType, InternalGameInfo[]>;
    losers: string[];
  } {
    const lobbies = Array.from(this.workerLobbies.values()).flat();

    const result: Record<PublicGameType, InternalGameInfo[]> = {
      ffa: [],
      team: [],
      special: [],
      hosted: [],
    };

    for (const lobby of lobbies) {
      result[lobby.publicGameType].push(lobby);
    }

    for (const type of Object.keys(result) as PublicGameType[]) {
      result[type].sort((a, b) => {
        if (a.startsAt === undefined && b.startsAt === undefined) {
          // Queue order: oldest first, so a lobby moves up a place each time
          // the one in front of it starts, and a newly created lobby joins the
          // back instead of landing in the middle. Game id only breaks ties
          // for lobbies from a build that didn't report createdAt.
          if (a.createdAt !== b.createdAt) {
            return (a.createdAt ?? 0) - (b.createdAt ?? 0);
          }
          return a.gameID > b.gameID ? 1 : -1;
        }
        // If a lobby has startsAt set, we assume it's the active one.
        if (a.startsAt === undefined) return 1;
        if (b.startsAt === undefined) return -1;
        return a.startsAt - b.startsAt;
      });
    }

    // One listed lobby per creator, cluster-wide. Workers enforce this at
    // listing time, but two workers can list concurrently between broadcasts;
    // dropping duplicates here (deterministically, after the sort above)
    // keeps the extra lobby from ever being advertised. Losers are reported
    // so broadcastLobbies can tell the owning worker to clear the loser's
    // listed flag — otherwise it would stay flagged Public on its worker
    // while never appearing in any browser.
    const seenCreators = new Set<string>();
    const losers: string[] = [];
    result.hosted = result.hosted.filter((lobby) => {
      if (lobby.creatorID === undefined) return true;
      if (seenCreators.has(lobby.creatorID)) {
        losers.push(lobby.gameID);
        return false;
      }
      seenCreators.add(lobby.creatorID);
      return true;
    });

    // Featured lobbies keep their place when the list overflows. They are
    // announced events with a published start time, and delisting is permanent
    // — the worker clears listedAt, so an event lobby that loses the cap never
    // comes back and its audience arrives to nothing. Only an admin bot can set
    // featured, and the per-creator dedup above already caps each host at one
    // listing, so this cannot be used to crowd the list. Stable within each
    // group: the sort above still decides order among featured and among the
    // rest.
    result.hosted = [
      ...result.hosted.filter((l) => l.featured),
      ...result.hosted.filter((l) => !l.featured),
    ];

    // Cluster-wide cap to prevent listing spam. Workers reject listings past
    // the cap too, but their view lags by a broadcast round-trip; overflow
    // (deterministically the sort losers) is delisted like dedup losers.
    if (result.hosted.length > MAX_HOSTED_LOBBIES) {
      for (const lobby of result.hosted.slice(MAX_HOSTED_LOBBIES)) {
        losers.push(lobby.gameID);
      }
      result.hosted = result.hosted.slice(0, MAX_HOSTED_LOBBIES);
    }

    // Stamped so clients can render the queue in the order it will go live:
    // only the master knows where the rotation is, and only it sees every
    // worker's lobbies.
    promotionOrder(result, this.lastPromoted).forEach((lobby, position) => {
      lobby.queuePosition = position;
    });

    return { games: result, losers };
  }

  // Losers (creator dedup or cap overflow) are only delisted after losing
  // two consecutive broadcast cycles: a single loss can be a stale worker
  // report (a just-delisted lobby lingers for one report round-trip), and
  // delisting on it would clear a legitimately listed lobby.
  private delistGameIDs(losers: string[]): string[] {
    const loserSet = new Set(losers);
    for (const gameID of this.loserStreaks.keys()) {
      if (!loserSet.has(gameID)) this.loserStreaks.delete(gameID);
    }
    const delist: string[] = [];
    for (const gameID of losers) {
      const streak = (this.loserStreaks.get(gameID) ?? 0) + 1;
      this.loserStreaks.set(gameID, streak);
      if (streak >= 2) delist.push(gameID);
    }
    if (delist.length > 0) {
      this.log.info(
        `delisting hosted lobbies (duplicate creator or over cap): ${delist.join(", ")}`,
      );
    }
    return delist;
  }

  private broadcastLobbies() {
    const { games, losers } = this.getAllLobbies();
    const delist = this.delistGameIDs(losers);
    const msg = {
      type: "lobbiesBroadcast",
      publicGames: {
        serverTime: Date.now(),
        games,
      },
      delistGameIDs: delist.length > 0 ? delist : undefined,
    } satisfies MasterLobbiesBroadcast;
    for (const [workerId, worker] of this.workers.entries()) {
      worker.send(msg, (e) => {
        if (e) {
          this.log.error(
            `Failed to send lobbies broadcast to worker ${workerId}, killing worker:`,
            e,
          );
          worker.kill();
        }
      });
    }
  }

  private async maybeScheduleLobby() {
    const lobbiesByType = this.getAllLobbies().games;

    this.maybePromote(lobbiesByType);

    // Scheduled types only: hosted lobbies are started by their host, never
    // given a countdown or replaced by the master.
    for (const type of SCHEDULED_PUBLIC_GAME_TYPES) {
      if (lobbiesByType[type].length >= QUEUED_LOBBIES_PER_TYPE) {
        continue;
      }

      this.sendMessageToWorker({
        type: "createGame",
        gameID: generateID(),
        gameConfig: await this.playlist.gameConfig(type),
        publicGameType: type,
      } satisfies MasterCreateGame);
    }
  }

  /**
   * One lobby counts down at a time, and the rotation picks whose turn it is.
   * Nothing ever clears a countdown, so a lobby only leaves by starting — its
   * timer runs out or it fills up, and both drop it from the reports.
   */
  private maybePromote(
    lobbiesByType: Record<PublicGameType, InternalGameInfo[]>,
  ): void {
    // getAllLobbies sorted each type's lobbies with the counting-down one first,
    // so the oldest queued lobby of a type is the first without a startsAt.
    const queued = (type: ScheduledPublicGameType) =>
      lobbiesByType[type].filter((lobby) => lobby.startsAt === undefined);
    const live = SCHEDULED_PUBLIC_GAME_TYPES.flatMap(
      (type) => lobbiesByType[type],
    ).find((lobby) => lobby.startsAt !== undefined);
    if (live !== undefined) {
      this.lastPromoted = live.publicGameType as ScheduledPublicGameType;
      this.promoting = undefined;
      return;
    }

    if (this.promoting !== undefined) {
      const stillQueued = queued(this.promoting.type).some(
        (lobby) => lobby.gameID === this.promoting!.gameID,
      );
      // Waiting on the report: re-send rather than promote a second lobby, so a
      // lost message can't leave the queue without a countdown. Costs this lobby
      // a second per late poll.
      if (stillQueued) {
        this.sendCountdown(this.promoting.gameID);
        return;
      }
      // Gone without ever being reported live: it filled up and started inside
      // the report round-trip. The cursor moved when it was promoted, so its
      // turn has counted either way.
      this.promoting = undefined;
    }

    // A type with nothing queued loses its turn rather than stalling the
    // rotation or handing the same type two turns running.
    const type = rotationFrom(this.lastPromoted).find(
      (candidate) => queued(candidate).length > 0,
    );
    if (type === undefined) return;

    // The cursor moves now, not when the countdown is reported: broadcasts run
    // on their own poll, and one landing in between would stamp queuePosition
    // from the previous lap and put the wrong lobby up next. `promoting` is what
    // stops a second lobby being promoted while this one is in flight.
    const gameID = queued(type)[0].gameID;
    this.lastPromoted = type;
    this.promoting = { gameID, type };
    this.sendCountdown(gameID);
  }

  private sendCountdown(gameID: string): void {
    this.sendMessageToWorker({
      type: "updateLobby",
      gameID,
      startsAt: Date.now() + ServerEnv.gameCreationRate(),
    });
  }

  private sendMessageToWorker(msg: MasterCreateGame | MasterUpdateGame): void {
    const workerId = ServerEnv.workerIndex(msg.gameID);
    const worker = this.workers.get(workerId);
    if (!worker) {
      this.log.error(`Worker ${workerId} not found`);
      return;
    }
    worker.send(msg, (e) => {
      if (e) {
        this.log.error(
          `Failed to send message to worker ${workerId}, killing worker:`,
          e,
        );
        worker.kill();
      }
    });
  }
}
