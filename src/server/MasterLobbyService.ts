import { Worker } from "cluster";
import winston from "winston";
import { ServerConfig } from "../core/configuration/Config";
import { PublicGameInfo, PublicGameType } from "../core/Schemas";
import { generateID } from "../core/Util";
import {
  MasterCreateGame,
  MasterLobbiesBroadcast,
  MasterUpdateGame,
  WorkerMessageSchema,
} from "./IPCBridgeSchema";
import { logger } from "./Logger";
import { MapPlaylist } from "./MapPlaylist";
import { startPolling } from "./PollingLoop";

export interface MasterLobbyServiceOptions {
  config: ServerConfig;
  playlist: MapPlaylist;
  log: typeof logger;
}

export class MasterLobbyService {
  private readonly workers = new Map<number, Worker>();
  // Worker id => the lobbies it owns.
  private readonly workerLobbies = new Map<number, PublicGameInfo[]>();
  private readonly readyWorkers = new Set<number>();
  private started = false;

  constructor(
    private config: ServerConfig,
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
          this.workerLobbies.set(workerId, msg.lobbies);
          break;
      }
    });
  }

  removeWorker(workerId: number) {
    this.workers.delete(workerId);
    this.workerLobbies.delete(workerId);
    this.readyWorkers.delete(workerId);
  }

  isHealthy(): boolean {
    // We consider the lobby service healthy if at least half of the workers are ready.
    // This allows for some leeway if a worker crashes.
    const minWorkers = Math.max(this.config.numWorkers() / 2, 1);
    return this.started && this.readyWorkers.size >= minWorkers;
  }

  private handleWorkerReady(workerId: number) {
    this.readyWorkers.add(workerId);
    this.log.info(
      `Worker ${workerId} is ready. (${this.readyWorkers.size}/${this.config.numWorkers()} ready)`,
    );
    if (this.readyWorkers.size === this.config.numWorkers() && !this.started) {
      this.started = true;
      this.log.info("All workers ready, starting game scheduling");
      startPolling(async () => this.broadcastLobbies(), 500);
      startPolling(async () => await this.maybeScheduleLobby(), 1000);
    }
  }

  private getAllLobbies(): Record<PublicGameType, PublicGameInfo[]> {
    const lobbies = Array.from(this.workerLobbies.values()).flat();

    const result: Record<PublicGameType, PublicGameInfo[]> = {
      ffa: [],
      team: [],
      special: [],
    };

    for (const lobby of lobbies) {
      result[lobby.publicGameType].push(lobby);
    }

    for (const type of Object.keys(result) as PublicGameType[]) {
      result[type].sort((a, b) => {
        if (a.startsAt === undefined && b.startsAt === undefined) {
          // Sort by game id for stability.
          return a.gameID > b.gameID ? 1 : -1;
        }
        // If a lobby has startsAt set, we assume it's the active one.
        if (a.startsAt === undefined) return 1;
        if (b.startsAt === undefined) return -1;
        return a.startsAt - b.startsAt;
      });
    }

    return result;
  }

  private broadcastLobbies() {
    const msg = {
      type: "lobbiesBroadcast",
      publicGames: {
        serverTime: Date.now(),
        games: this.getAllLobbies(),
      },
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
    const lobbiesByType = this.getAllLobbies();

    for (const type of Object.keys(lobbiesByType) as PublicGameType[]) {
      const lobbies = lobbiesByType[type];

      // Always ensure the next lobby has a timer, even if we already have 2+
      // lobbies. This prevents a race where two lobbies are created before
      // either receives a startsAt (IPC round-trip delay), leaving both stuck
      // without a countdown.
      const nextLobby = lobbies[0];
      if (nextLobby && nextLobby.startsAt === undefined) {
        this.sendMessageToWorker({
          type: "updateLobby",
          gameID: nextLobby.gameID,
          startsAt: Date.now() + this.config.gameCreationRate(),
        });
      }

      if (lobbies.length >= 2) {
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

  private sendMessageToWorker(msg: MasterCreateGame | MasterUpdateGame): void {
    const workerId = this.config.workerIndex(msg.gameID);
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
