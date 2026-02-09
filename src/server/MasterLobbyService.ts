import { Worker } from "cluster";
import winston from "winston";
import { ServerConfig } from "../core/configuration/Config";
import { PublicGameInfo } from "../core/Schemas";
import { generateID } from "../core/Util";
import {
  MasterCreateGame,
  MasterLobbiesBroadcast,
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

  private handleWorkerReady(workerId: number) {
    this.readyWorkers.add(workerId);
    this.log.info(
      `Worker ${workerId} is ready. (${this.readyWorkers.size}/${this.config.numWorkers()} ready)`,
    );
    if (this.readyWorkers.size === this.config.numWorkers() && !this.started) {
      this.started = true;
      this.log.info("All workers ready, starting game scheduling");
      startPolling(async () => this.broadcastLobbies(), 250);
      startPolling(async () => await this.maybeScheduleLobby(), 1000);
    }
  }

  private getAllLobbies(): PublicGameInfo[] {
    const lobbies = Array.from(this.workerLobbies.values())
      .flat()
      .sort((a, b) => a.startsAt! - b.startsAt);
    return lobbies;
  }

  private broadcastLobbies() {
    const msg = {
      type: "lobbiesBroadcast",
      publicGames: {
        serverTime: Date.now(),
        games: this.getAllLobbies(),
      },
    } satisfies MasterLobbiesBroadcast;
    for (const worker of this.workers.values()) {
      worker.send(msg, (e) => {
        if (e) {
          this.log.error("Failed to send lobbies broadcast to worker:", e);
        }
      });
    }
  }

  private async maybeScheduleLobby() {
    const lobbies = this.getAllLobbies();
    if (lobbies.length >= 2) {
      return;
    }

    const lastStart = lobbies.reduce(
      (max, pb) => Math.max(max, pb.startsAt),
      Date.now(),
    );

    const gameID = generateID();
    const workerId = this.config.workerIndex(gameID);

    const gameConfig = await this.playlist.gameConfig();
    const worker = this.workers.get(workerId);
    if (!worker) {
      this.log.error(`Worker ${workerId} not found`);
      return;
    }

    worker.send(
      {
        type: "createGame",
        gameID,
        gameConfig,
        startsAt: lastStart + this.config.gameCreationRate(),
      } satisfies MasterCreateGame,
      (e) => {
        if (e) {
          this.log.error("Failed to schedule lobby on worker:", e);
        }
      },
    );
    this.log.info(`Scheduled public game ${gameID} on worker ${workerId}`);
  }
}
