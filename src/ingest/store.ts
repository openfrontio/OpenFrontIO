import fs from "fs/promises";
import path from "path";
import {
  DbSchema,
  GameConfig,
  LobbyRecord,
  PublicGameInfo,
  workerPathForGame,
} from "../shared/types";
import { IngestConfig } from "./config";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const DEFAULT_SCHEMA = (config: IngestConfig): DbSchema => ({
  version: 1,
  createdAt: Date.now(),
  lastUpdatedAt: Date.now(),
  environment: {
    targetBaseUrl: config.targetBaseUrl,
    targetWsUrl: config.targetWsUrl,
    archiveApiBase: config.archiveApiBase,
    numWorkers: config.numWorkers,
  },
  messagesReceived: 0,
  reconnectCount: 0,
  systemNotes: [],
  lobbies: {},
});

const normalizeDb = (config: IngestConfig, candidate: Partial<DbSchema>): DbSchema => {
  const fallback = DEFAULT_SCHEMA(config);
  const normalizedLobbies = { ...(candidate.lobbies ?? fallback.lobbies) };
  for (const value of Object.values(normalizedLobbies)) {
    if (
      value &&
      value.status === "completed" &&
      typeof value.actualEndAt === "number"
    ) {
      value.completedAt = value.actualEndAt;
      value.completionReason = "archive-end-time";
    }
  }
  return {
    ...fallback,
    ...candidate,
    environment: {
      targetBaseUrl: config.targetBaseUrl,
      targetWsUrl: config.targetWsUrl,
      archiveApiBase: config.archiveApiBase,
      numWorkers: config.numWorkers,
    },
    systemNotes: Array.isArray(candidate.systemNotes)
      ? candidate.systemNotes
      : fallback.systemNotes,
    lobbies: normalizedLobbies,
  };
};

export class JsonStore {
  private db: DbSchema;
  private dirty = false;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  private constructor(
    private readonly config: IngestConfig,
    initialDb: DbSchema,
  ) {
    this.db = initialDb;
  }

  static async open(config: IngestConfig): Promise<JsonStore> {
    const dbPath = path.resolve(config.dbPath);
    await fs.mkdir(path.dirname(dbPath), { recursive: true });

    try {
      const raw = await fs.readFile(dbPath, "utf-8");
      const parsed = normalizeDb(config, JSON.parse(raw) as Partial<DbSchema>);
      return new JsonStore(config, parsed);
    } catch {
      const fresh = DEFAULT_SCHEMA(config);
      const store = new JsonStore(config, fresh);
      await store.flush();
      return store;
    }
  }

  getDb(): DbSchema {
    return this.db;
  }

  systemNote(message: string): void {
    this.db.systemNotes.push(`${new Date().toISOString()}: ${message}`);
    if (this.db.systemNotes.length > 300) {
      this.db.systemNotes = this.db.systemNotes.slice(-300);
    }
    this.touch();
  }

  values(): LobbyRecord[] {
    return Object.values(this.db.lobbies);
  }

  getLobby(gameID: string): LobbyRecord | undefined {
    return this.db.lobbies[gameID];
  }

  markMessageReceived(): void {
    this.db.messagesReceived += 1;
    this.touch();
  }

  markReconnect(): void {
    this.db.reconnectCount += 1;
    this.touch();
  }

  upsertFromLobby(now: number, serverTime: number, lobby: PublicGameInfo): void {
    const existing = this.db.lobbies[lobby.gameID];
    const maxPlayers = lobby.gameConfig?.maxPlayers;
    if (!existing) {
      this.db.lobbies[lobby.gameID] = {
        gameID: lobby.gameID,
        firstSeenAt: now,
        lastSeenAt: now,
        openedAt: now,
        scheduledStartAt: lobby.startsAt,
        workerPath: workerPathForGame(lobby.gameID, this.config.numWorkers),
        gameConfig: lobby.gameConfig,
        status: "active",
        lastObservedClients: lobby.numClients,
        peakClients: lobby.numClients,
        troughClients: lobby.numClients,
        maxPlayers,
        observedJoinEvents: 0,
        observedLeaveEvents: 0,
        snapshots: [
          {
            at: now,
            serverTime,
            numClients: lobby.numClients,
            maxPlayers,
          },
        ],
        fullMoments: 0,
        fullDurationMs: 0,
        uniqueClientsObserved: 0,
        uniqueClientIds: [],
        gameInfoPolls: 0,
        gameInfoPollErrors: 0,
        probeAttempts: 0,
        archiveFound: false,
        notes: [],
      };
      this.touch();
      return;
    }

    if (existing.status !== "active") {
      existing.status = "active";
      existing.notes.push(
        `${new Date(now).toISOString()}: lobby returned to active list`,
      );
    }

    const delta = lobby.numClients - existing.lastObservedClients;
    if (delta > 0) existing.observedJoinEvents += delta;
    if (delta < 0) existing.observedLeaveEvents += Math.abs(delta);

    if (
      existing.maxPlayers &&
      existing.maxPlayers > 0 &&
      lobby.numClients >= existing.maxPlayers
    ) {
      existing.fullMoments += 1;
      if (existing.fullLastSeenAt) {
        existing.fullDurationMs += now - existing.fullLastSeenAt;
      }
      existing.fullLastSeenAt = now;
    } else {
      existing.fullLastSeenAt = undefined;
    }

    existing.lastSeenAt = now;
    existing.lastObservedClients = lobby.numClients;
    existing.peakClients = Math.max(existing.peakClients, lobby.numClients);
    existing.troughClients = Math.min(existing.troughClients, lobby.numClients);
    existing.maxPlayers = existing.maxPlayers ?? maxPlayers;
    existing.gameConfig = lobby.gameConfig ?? existing.gameConfig;
    existing.scheduledStartAt = lobby.startsAt || existing.scheduledStartAt;
    existing.snapshots.push({
      at: now,
      serverTime,
      numClients: lobby.numClients,
      maxPlayers: existing.maxPlayers,
    });
    this.touch();
  }

  markClosed(gameID: string, closedAt: number): LobbyRecord | null {
    const lobby = this.db.lobbies[gameID];
    if (!lobby) return null;
    if (lobby.closedAt) return lobby;

    lobby.closedAt = closedAt;
    lobby.status = lobby.status === "active" ? "unknown" : lobby.status;
    lobby.openDurationMs = closedAt - lobby.openedAt;
    lobby.lastSeenAt = Math.max(lobby.lastSeenAt, closedAt);
    if (lobby.fullLastSeenAt) {
      lobby.fullDurationMs += closedAt - lobby.fullLastSeenAt;
      lobby.fullLastSeenAt = undefined;
    }
    this.touch();
    return lobby;
  }

  note(gameID: string, message: string): void {
    const lobby = this.db.lobbies[gameID];
    if (!lobby) return;
    lobby.notes.push(`${new Date().toISOString()}: ${message}`);
    this.touch();
  }

  setGameInfoPollResult(
    gameID: string,
    payload: {
      status: number;
      gameConfig?: GameConfig;
      clientIds?: string[];
      playersInGame?: number;
    },
  ): void {
    const lobby = this.db.lobbies[gameID];
    if (!lobby) return;
    lobby.gameInfoPolls += 1;
    lobby.probeLastStatus = payload.status;
    if (payload.gameConfig) lobby.gameConfig = payload.gameConfig;
    if (payload.playersInGame !== undefined) {
      lobby.lastObservedClients = payload.playersInGame;
      lobby.peakClients = Math.max(lobby.peakClients, payload.playersInGame);
    }
    if (payload.clientIds) {
      const seen = new Set(lobby.uniqueClientIds);
      for (const id of payload.clientIds) seen.add(id);
      lobby.uniqueClientIds = Array.from(seen);
      lobby.uniqueClientsObserved = lobby.uniqueClientIds.length;
    }
    this.touch();
  }

  markGameInfoPollError(gameID: string): void {
    const lobby = this.db.lobbies[gameID];
    if (!lobby) return;
    lobby.gameInfoPollErrors += 1;
    this.touch();
  }

  applyClosureProbe(
    gameID: string,
    payload: {
      attempt: number;
      existsStatus?: number;
      started: boolean;
      playersAtStart?: number;
      fillRatioAtStart?: number;
      startDetectedAt?: number;
      didNotStart?: boolean;
    },
  ): void {
    const lobby = this.db.lobbies[gameID];
    if (!lobby) return;
    lobby.probeAttempts = Math.max(lobby.probeAttempts, payload.attempt);
    if (payload.existsStatus !== undefined) {
      lobby.probeLastStatus = payload.existsStatus;
    }
    if (payload.started) {
      lobby.status = "started";
      lobby.startDetectedAt = payload.startDetectedAt ?? Date.now();
      lobby.playersAtStart = payload.playersAtStart;
      lobby.fillRatioAtStart = payload.fillRatioAtStart;
      lobby.startedPollLastAt = Date.now();
      lobby.completedAt = undefined;
      lobby.completionReason = undefined;
      lobby.probeSuccessAt = Date.now();
    } else if (payload.didNotStart) {
      lobby.status = "did_not_start";
    }
    this.touch();
  }

  markStartedHeartbeat(
    gameID: string,
    payload: { checkedAt: number; playersInGame?: number; statusCode?: number },
  ): void {
    const lobby = this.db.lobbies[gameID];
    if (!lobby) return;
    if (lobby.status !== "started") return;
    lobby.startedPollLastAt = payload.checkedAt;
    if (payload.playersInGame !== undefined) {
      lobby.lastObservedClients = payload.playersInGame;
      lobby.peakClients = Math.max(lobby.peakClients, payload.playersInGame);
    }
    if (payload.statusCode !== undefined) {
      lobby.probeLastStatus = payload.statusCode;
    }
    this.touch();
  }

  markCompleted(gameID: string, completedAt: number, reason: string): void {
    const lobby = this.db.lobbies[gameID];
    if (!lobby) return;
    if (lobby.status === "completed") return;
    if (lobby.status !== "started") return;
    lobby.status = "completed";
    lobby.completedAt = completedAt;
    lobby.completionReason = reason;
    lobby.startedPollLastAt = completedAt;
    lobby.notes.push(
      `${new Date(completedAt).toISOString()}: completed (${reason})`,
    );
    this.touch();
  }

  setArchiveSummary(
    gameID: string,
    payload: {
      found: boolean;
      players?: number;
      connectedPlayers?: number;
      activePlayers?: number;
      spawnedPlayers?: number;
      durationSec?: number;
      winner?: string;
      lobbyCreatedAt?: number;
      startAt?: number;
      endAt?: number;
    },
  ): void {
    const lobby = this.db.lobbies[gameID];
    if (!lobby) return;
    lobby.archiveFound = payload.found;
    lobby.archivePlayers = payload.players;
    lobby.archiveConnectedPlayers = payload.connectedPlayers;
    lobby.archiveActivePlayers = payload.activePlayers;
    lobby.archiveSpawnedPlayers = payload.spawnedPlayers;
    lobby.archiveDurationSec = payload.durationSec;
    lobby.archiveWinner = payload.winner;
    lobby.actualLobbyCreatedAt = payload.lobbyCreatedAt;
    lobby.actualStartAt = payload.startAt;
    lobby.actualEndAt = payload.endAt;

    if (payload.endAt !== undefined && lobby.status !== "active") {
      // Normalize to archive truth once available.
      // This avoids drift when completion was first inferred via /exists=false.
      lobby.status = "completed";
      lobby.completedAt = payload.endAt;
      lobby.completionReason = "archive-end-time";
    }

    this.touch();
  }

  async close(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flush();
  }

  private touch(): void {
    this.db.lastUpdatedAt = Date.now();
    this.dirty = true;
    if (this.flushTimer !== null) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush().catch((error) => {
        this.dirty = true;
        console.error("[lobbystatistics] db flush failed", error);
      });
    }, 500);
  }

  private async flush(): Promise<void> {
    if (!this.dirty) return;
    this.dirty = false;
    const dbPath = path.resolve(this.config.dbPath);
    const content = JSON.stringify(this.db, null, 2);
    const retryDelays = [0, 30, 120, 300];
    let lastError: unknown = null;

    for (const waitMs of retryDelays) {
      if (waitMs > 0) {
        await sleep(waitMs);
      }
      try {
        await fs.writeFile(dbPath, content, "utf-8");
        return;
      } catch (error) {
        lastError = error;
        const code =
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          typeof (error as { code?: unknown }).code === "string"
            ? (error as { code: string }).code
            : "";
        if (code !== "EPERM" && code !== "EACCES") {
          break;
        }
      }
    }

    this.dirty = true;
    throw lastError instanceof Error
      ? lastError
      : new Error(`db write failed: ${String(lastError)}`);
  }
}
