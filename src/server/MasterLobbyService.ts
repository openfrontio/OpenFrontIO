import { Worker } from "cluster";
import winston from "winston";
import { ServerConfig } from "../core/configuration/Config";
import { GameMode, PublicGameModifiers } from "../core/game/Game";
import { PublicGameInfo } from "../core/Schemas";
import { generateID } from "../core/Util";
import {
  MasterCreateGame,
  MasterLobbiesBroadcast,
  WorkerMessageSchema,
} from "./IPCBridgeSchema";
import { MapPlaylist } from "./MapPlaylist";
import { startPolling } from "./PollingLoop";
import { isSpecialModifiers } from "./SpecialModifiers";

type LobbyCategory = "ffa" | "teams" | "special";

const TARGET_PUBLIC_LOBBIES = 3;
const CATEGORY_TARGET: Record<LobbyCategory, number> = {
  ffa: 1,
  teams: 1,
  special: 1,
};

export class MasterLobbyService {
  private readonly workers = new Map<number, Worker>();
  // Worker id => the lobbies it owns.
  private readonly workerLobbies = new Map<number, PublicGameInfo[]>();
  private readonly readyWorkers = new Set<number>();
  private readonly scheduledLobbyCategory = new Map<string, LobbyCategory>();
  private readonly pendingLobbyCreatedAt = new Map<string, number>();
  private readonly pendingLobbyInfo = new Map<string, PublicGameInfo>();
  private scheduleInProgress = false;
  private scheduleRequested = false;
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
          this.markPendingAsLive(msg.lobbies);
          void this.maybeScheduleLobby();
          break;
      }
    });
  }

  removeWorker(workerId: number) {
    this.workers.delete(workerId);
    this.workerLobbies.delete(workerId);
    this.readyWorkers.delete(workerId);
    void this.maybeScheduleLobby();
  }

  private handleWorkerReady(workerId: number) {
    this.readyWorkers.add(workerId);
    this.log.info(
      `Worker ${workerId} is ready. (${this.readyWorkers.size}/${this.config.numWorkers()} ready)`,
    );
    if (this.readyWorkers.size >= 1 && !this.started) {
      this.started = true;
      this.log.info("At least one worker ready, starting game scheduling");
      startPolling(async () => this.broadcastLobbies(), 250);
      startPolling(async () => await this.maybeScheduleLobby(), 100);
    }
  }

  private markPendingAsLive(lobbies: PublicGameInfo[]) {
    for (const lobby of lobbies) {
      this.pendingLobbyCreatedAt.delete(lobby.gameID);
      this.pendingLobbyInfo.delete(lobby.gameID);
    }
  }

  private getAllLobbies(): PublicGameInfo[] {
    const liveLobbies = Array.from(this.workerLobbies.values()).flat();
    this.pruneStaleTrackedLobbies(liveLobbies);
    const liveIds = new Set(liveLobbies.map((lobby) => lobby.gameID));
    const pending = Array.from(this.pendingLobbyInfo.values()).filter(
      (lobby) => !liveIds.has(lobby.gameID),
    );

    const normalized = [...liveLobbies, ...pending]
      .map((lobby) => {
        const category = this.inferLobbyCategory(lobby);
        return category ? { ...lobby, publicLobbyCategory: category } : lobby;
      })
      .sort(
        (a, b) =>
          (a.startsAt ?? Number.MAX_SAFE_INTEGER) -
          (b.startsAt ?? Number.MAX_SAFE_INTEGER),
      );

    for (const lobby of normalized) {
      const category = this.normalizeCategory(lobby.publicLobbyCategory);
      if (category && !this.scheduledLobbyCategory.has(lobby.gameID)) {
        this.scheduledLobbyCategory.set(lobby.gameID, category);
      }
    }

    return normalized;
  }

  private pruneStaleTrackedLobbies(lobbies: PublicGameInfo[]) {
    const now = Date.now();
    const live = new Set(lobbies.map((l) => l.gameID));
    for (const gameID of this.scheduledLobbyCategory.keys()) {
      if (live.has(gameID)) {
        continue;
      }
      const pendingAt = this.pendingLobbyCreatedAt.get(gameID);
      if (pendingAt !== undefined && now - pendingAt < 15_000) {
        continue;
      }
      this.pendingLobbyCreatedAt.delete(gameID);
      this.pendingLobbyInfo.delete(gameID);
      this.scheduledLobbyCategory.delete(gameID);
    }
  }

  private normalizeCategory(
    category: PublicGameInfo["publicLobbyCategory"] | undefined,
  ): LobbyCategory | undefined {
    if (category === "ffa" || category === "teams" || category === "special") {
      return category;
    }
    return undefined;
  }

  private inferLobbyCategory(lobby: PublicGameInfo): LobbyCategory | undefined {
    const tagged = this.normalizeCategory(lobby.publicLobbyCategory);
    if (tagged) {
      return tagged;
    }

    const tracked = this.scheduledLobbyCategory.get(lobby.gameID);
    if (tracked) {
      return tracked;
    }

    const config = lobby.gameConfig;
    if (!config) {
      return undefined;
    }

    if (config.gameMode === GameMode.FFA) {
      return this.isSpecialConfig(config.publicGameModifiers)
        ? "special"
        : "ffa";
    }

    if (config.gameMode === GameMode.Team) {
      return this.isSpecialConfig(config.publicGameModifiers)
        ? "special"
        : "teams";
    }

    return undefined;
  }

  private isSpecialConfig(modifiers: PublicGameModifiers | undefined): boolean {
    return isSpecialModifiers(modifiers);
  }

  private categoryCounts(
    lobbies: PublicGameInfo[],
  ): Record<LobbyCategory, number> {
    const counts: Record<LobbyCategory, number> = {
      ffa: 0,
      teams: 0,
      special: 0,
    };

    for (const lobby of lobbies) {
      const category = this.inferLobbyCategory(lobby);
      if (category) {
        counts[category] += 1;
      }
    }

    return counts;
  }

  private nextCategoryToSchedule(
    lobbies: PublicGameInfo[],
  ): LobbyCategory | null {
    const counts = this.categoryCounts(lobbies);
    const totalCount = counts.ffa + counts.teams + counts.special;

    for (const category of ["ffa", "teams", "special"] as const) {
      if (counts[category] < CATEGORY_TARGET[category]) {
        return category;
      }
    }

    if (totalCount < TARGET_PUBLIC_LOBBIES) {
      const ordered = (Object.entries(counts) as Array<[LobbyCategory, number]>)
        .sort((a, b) => a[1] - b[1])
        .map(([category]) => category);
      return ordered[0] ?? "ffa";
    }

    return null;
  }

  private allocateGameToReadyWorker(): {
    gameID: string;
    workerId: number;
  } | null {
    for (let i = 0; i < 500; i += 1) {
      const gameID = generateID();
      const workerId = this.config.workerIndex(gameID);
      if (this.readyWorkers.has(workerId) && this.workers.has(workerId)) {
        return { gameID, workerId };
      }
    }
    return null;
  }

  private async gameConfigForCategory(category: LobbyCategory) {
    if (category === "ffa") {
      return this.playlist.gameConfig({ mode: GameMode.FFA });
    }

    if (category === "teams") {
      return this.playlist.gameConfig({
        mode: GameMode.Team,
      });
    }

    const specialAsTeam = Math.random() < 0.5;
    if (specialAsTeam) {
      return this.playlist.gameConfig({
        mode: GameMode.Team,
        ensureSpecialModifier: true,
      });
    }

    return this.playlist.gameConfig({
      mode: GameMode.FFA,
      ensureSpecialModifier: true,
    });
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
    if (this.scheduleInProgress) {
      this.scheduleRequested = true;
      return;
    }
    this.scheduleInProgress = true;

    try {
      do {
        this.scheduleRequested = false;
        await this.fillLobbyDeficit();
      } while (this.scheduleRequested);
    } finally {
      this.scheduleInProgress = false;
    }
  }

  private async fillLobbyDeficit() {
    if (this.readyWorkers.size === 0) {
      return;
    }

    for (let i = 0; i < TARGET_PUBLIC_LOBBIES; i += 1) {
      const lobbies = this.getAllLobbies();
      const category = this.nextCategoryToSchedule(lobbies);
      if (category === null) {
        return;
      }

      const lastStart = lobbies.reduce(
        (max, pb) => Math.max(max, pb.startsAt ?? max),
        Date.now(),
      );

      const placement = this.allocateGameToReadyWorker();
      if (!placement) {
        this.log.warn("Unable to allocate game to a ready worker");
        return;
      }

      const { gameID, workerId } = placement;
      const gameConfig = await this.gameConfigForCategory(category);
      const worker = this.workers.get(workerId);
      if (!worker) {
        this.log.error(`Worker ${workerId} not found`);
        return;
      }

      this.scheduledLobbyCategory.set(gameID, category);
      this.pendingLobbyCreatedAt.set(gameID, Date.now());
      this.pendingLobbyInfo.set(gameID, {
        gameID,
        numClients: 0,
        startsAt: lastStart + this.config.gameCreationRate(),
        gameConfig,
        publicLobbyCategory: category,
      });

      worker.send(
        {
          type: "createGame",
          gameID,
          gameConfig,
          startsAt: lastStart + this.config.gameCreationRate(),
        } satisfies MasterCreateGame,
        (e) => {
          if (e) {
            this.pendingLobbyCreatedAt.delete(gameID);
            this.pendingLobbyInfo.delete(gameID);
            this.scheduledLobbyCategory.delete(gameID);
            this.log.error("Failed to schedule lobby on worker:", e);
          }
        },
      );

      this.log.info(
        `Scheduled ${category} public game ${gameID} on worker ${workerId}`,
      );
    }
  }
}
