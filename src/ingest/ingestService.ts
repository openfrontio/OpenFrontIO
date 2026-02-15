import WebSocket from "ws";
import {
  GameInfoResponse,
  LobbyRecord,
  PublicGamesMessage,
  workerPathForGame,
} from "../shared/types";
import { IngestConfig } from "./config";
import {
  ArchiveSummarySchema,
  GameInfoResponseSchema,
  ProdLobbiesUpdateSchema,
  PublicGamesMessageSchema,
} from "./schemas";
import { JsonStore } from "./store";

interface ExistsResponse {
  exists?: boolean;
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const MAX_LOG_PAYLOAD = 1600;
const compactPayload = (value: string): string =>
  value.length <= MAX_LOG_PAYLOAD
    ? value
    : `${value.slice(0, MAX_LOG_PAYLOAD)}...[truncated ${value.length - MAX_LOG_PAYLOAD} chars]`;

export class LobbyIngestService {
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private gameInfoPollTimer: ReturnType<typeof setInterval> | null = null;
  private archiveBackfillTimer: ReturnType<typeof setInterval> | null = null;
  private startedPollTimer: ReturnType<typeof setInterval> | null = null;
  private activeLobbyIds: Set<string> = new Set();
  private closingProbeJobs: Set<string> = new Set();
  private archiveAttemptCount = new Map<string, number>();
  private isStarted = false;

  constructor(
    private readonly config: IngestConfig,
    private readonly store: JsonStore,
  ) {}

  start(): void {
    if (this.isStarted) return;
    this.isStarted = true;
    this.connect();
    this.gameInfoPollTimer = setInterval(() => {
      void this.safeRun("pollActiveGameInfo", () => this.pollActiveGameInfo());
    }, this.config.gameInfoPollMs);
    this.archiveBackfillTimer = setInterval(() => {
      void this.safeRun("backfillArchiveData", () => this.backfillArchiveData());
    }, 60_000);
    this.startedPollTimer = setInterval(() => {
      void this.safeRun("pollStartedGames", () => this.pollStartedGames());
    }, 60_000);

    void this.safeRun("reconcileHistoricalStartedGames", () =>
      this.reconcileHistoricalStartedGames(),
    );
  }

  stop(): void {
    this.isStarted = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.gameInfoPollTimer) {
      clearInterval(this.gameInfoPollTimer);
      this.gameInfoPollTimer = null;
    }
    if (this.archiveBackfillTimer) {
      clearInterval(this.archiveBackfillTimer);
      this.archiveBackfillTimer = null;
    }
    if (this.startedPollTimer) {
      clearInterval(this.startedPollTimer);
      this.startedPollTimer = null;
    }
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }
  }

  private connect(): void {
    if (!this.isStarted) return;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;

    this.ws = new WebSocket(this.config.targetWsUrl);

    this.ws.on("open", () => {
      this.store.systemNote(`Connected to ${this.config.targetWsUrl}`);
    });

    this.ws.on("message", (raw) => {
      const now = Date.now();
      this.store.markMessageReceived();
      const text = typeof raw === "string" ? raw : raw.toString();

      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch (error) {
        const payload = compactPayload(text);
        this.store.systemNote(
          `Invalid /lobbies JSON parse error: ${String(error)} | payload=${payload}`,
        );
        // eslint-disable-next-line no-console
        console.error("[lobbystatistics] invalid websocket payload", {
          error,
          payload,
        });
        return;
      }

      if (json && typeof json === "object" && (json as { type?: string }).type === "error") {
        const payload = compactPayload(text);
        this.store.systemNote(`WebSocket error reply received: payload=${payload}`);
        // eslint-disable-next-line no-console
        console.error("[lobbystatistics] websocket error reply", payload);
        return;
      }

      const normalized = this.normalizeLobbiesMessage(json);
      if (!normalized.ok) {
        const payload = compactPayload(text);
        this.store.systemNote(
          `Invalid /lobbies schema: ${normalized.error
            .slice(0, 240)} | payload=${payload}`,
        );
        // eslint-disable-next-line no-console
        console.error("[lobbystatistics] websocket schema mismatch", {
          error: normalized.error,
          payload,
        });
        return;
      }

      this.ingestLobbyFrame(now, normalized.message);
    });

    this.ws.on("close", (code, reason) => {
      const reasonText = reason.length > 0 ? reason.toString("utf-8") : "";
      this.store.systemNote(
        `WebSocket closed: code=${code}${reasonText ? ` reason=${compactPayload(reasonText)}` : ""}`,
      );
      this.scheduleReconnect();
    });

    this.ws.on("error", (error) => {
      this.store.systemNote(`WebSocket error: ${String(error)}`);
    });
  }

  private normalizeLobbiesMessage(
    json: unknown,
  ): { ok: true; message: PublicGamesMessage } | { ok: false; error: string } {
    const direct = PublicGamesMessageSchema.safeParse(json);
    if (direct.success) {
      return {
        ok: true,
        message: direct.data as PublicGamesMessage,
      };
    }

    const prod = ProdLobbiesUpdateSchema.safeParse(json);
    if (prod.success) {
      const now = Date.now();
      const serverTime = prod.data.data.serverTime ?? now;
      const games = prod.data.data.lobbies.map((lobby) => ({
        gameID: lobby.gameID,
        numClients: lobby.numClients,
        startsAt:
          lobby.startsAt ??
          (typeof lobby.msUntilStart === "number"
            ? now + lobby.msUntilStart
            : now),
        gameConfig: lobby.gameConfig,
      }));
      return {
        ok: true,
        message: {
          serverTime,
          games,
        },
      };
    }

    return {
      ok: false,
      error: direct.error.issues
            .slice(0, 3)
            .map((issue) => issue.message)
            .join("; "),
    };
  }

  private scheduleReconnect(): void {
    if (!this.isStarted) return;
    if (this.reconnectTimer !== null) return;
    this.store.markReconnect();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.config.reconnectDelayMs);
  }

  private ingestLobbyFrame(now: number, message: PublicGamesMessage): void {
    const nextActive = new Set<string>();
    for (const lobby of message.games) {
      nextActive.add(lobby.gameID);
      this.store.upsertFromLobby(now, message.serverTime, lobby);
    }

    for (const previousId of this.activeLobbyIds) {
      if (!nextActive.has(previousId)) {
        const closed = this.store.markClosed(previousId, now);
        if (closed) {
          this.store.note(previousId, "Lobby disappeared from /lobbies stream");
          void this.handleLobbyClosed(closed);
        }
      }
    }

    this.activeLobbyIds = nextActive;
  }

  private async pollActiveGameInfo(): Promise<void> {
    const ids = Array.from(this.activeLobbyIds);
    for (const gameID of ids) {
      await this.pollSingleGameInfo(gameID);
    }
  }

  private async pollSingleGameInfo(gameID: string): Promise<void> {
    const workerPath = workerPathForGame(gameID, this.config.numWorkers);
    const primary = `${this.config.targetBaseUrl}/${workerPath}/api/game/${gameID}`;
    const fallback = `${this.config.targetBaseUrl}/api/game/${gameID}`;

    const responses = [await this.fetchJson(primary, 3500)];
    if (responses[0].status === 404 || responses[0].status === 502) {
      responses.push(await this.fetchJson(fallback, 3500));
    }

    const candidate = responses.find((entry) => entry.status === 200);
    if (!candidate || candidate.json === null) {
      this.store.markGameInfoPollError(gameID);
      return;
    }

    const parsed = GameInfoResponseSchema.safeParse(candidate.json);
    if (!parsed.success) {
      this.store.markGameInfoPollError(gameID);
      return;
    }

    const body = parsed.data as GameInfoResponse;
    this.store.setGameInfoPollResult(gameID, {
      status: candidate.status,
      gameConfig: body.gameConfig,
      clientIds: body.clients?.map((client) => client.clientID),
      playersInGame: body.clients?.length,
    });
  }

  private async handleLobbyClosed(lobby: LobbyRecord): Promise<void> {
    if (this.closingProbeJobs.has(lobby.gameID)) return;
    this.closingProbeJobs.add(lobby.gameID);

    try {
      for (let attempt = 1; attempt <= this.config.closureProbeAttempts; attempt++) {
        const exists = await this.checkExists(lobby.gameID);
        const existsValue = exists.json && typeof exists.json === "object"
          ? (exists.json as ExistsResponse).exists === true
          : false;

        if (existsValue) {
          const info = await this.fetchGameInfo(lobby.gameID);
          const playersAtStart = info?.clients?.length;
          const maxPlayers = lobby.maxPlayers ?? info?.gameConfig?.maxPlayers;
          this.store.applyClosureProbe(lobby.gameID, {
            attempt,
            existsStatus: exists.status,
            started: true,
            playersAtStart,
            fillRatioAtStart:
              playersAtStart !== undefined && maxPlayers
                ? playersAtStart / Math.max(1, maxPlayers)
                : undefined,
            startDetectedAt: Date.now(),
          });
          await this.tryArchiveLookup(lobby.gameID);
          return;
        }

        const now = Date.now();
        if (
          lobby.scheduledStartAt > 0 &&
          now > lobby.scheduledStartAt + 45_000 &&
          attempt >= Math.floor(this.config.closureProbeAttempts / 2)
        ) {
          this.store.applyClosureProbe(lobby.gameID, {
            attempt,
            existsStatus: exists.status,
            started: false,
            didNotStart: true,
          });
        } else {
          this.store.applyClosureProbe(lobby.gameID, {
            attempt,
            existsStatus: exists.status,
            started: false,
          });
        }
        await delay(this.config.closureProbeIntervalMs);
      }

      this.store.applyClosureProbe(lobby.gameID, {
        attempt: this.config.closureProbeAttempts,
        started: false,
        didNotStart: true,
      });
      await this.tryArchiveLookup(lobby.gameID);
    } finally {
      this.closingProbeJobs.delete(lobby.gameID);
    }
  }

  private async fetchGameInfo(gameID: string): Promise<GameInfoResponse | null> {
    const workerPath = workerPathForGame(gameID, this.config.numWorkers);
    const primary = `${this.config.targetBaseUrl}/${workerPath}/api/game/${gameID}`;
    const fallback = `${this.config.targetBaseUrl}/api/game/${gameID}`;
    const first = await this.fetchJson(primary, 3500);
    const second =
      first.status === 200 ? first : await this.fetchJson(fallback, 3500);
    if (second.status !== 200 || second.json === null) return null;
    const parsed = GameInfoResponseSchema.safeParse(second.json);
    if (!parsed.success) return null;
    return parsed.data as GameInfoResponse;
  }

  private async checkExists(
    gameID: string,
  ): Promise<{ status: number; json: unknown | null }> {
    const workerPath = workerPathForGame(gameID, this.config.numWorkers);
    const primary = `${this.config.targetBaseUrl}/${workerPath}/api/game/${gameID}/exists`;
    const fallback = `${this.config.targetBaseUrl}/api/game/${gameID}/exists`;
    const first = await this.fetchJson(primary, 3500);
    if (first.status === 200) return first;
    return this.fetchJson(fallback, 3500);
  }

  private async backfillArchiveData(): Promise<void> {
    const target = this.store
      .values()
      .filter(
        (record) =>
          record.status !== "active" &&
          !record.archiveFound &&
          !!record.closedAt &&
          Date.now() - record.closedAt > 120_000,
      )
      .sort((a, b) => a.closedAt! - b.closedAt!)
      .slice(0, 8);

    for (const record of target) {
      await this.tryArchiveLookup(record.gameID);
    }
  }

  private async reconcileHistoricalStartedGames(): Promise<void> {
    const now = Date.now();
    const targets = this.store
      .values()
      .filter((record) => record.status === "started")
      .sort(
        (a, b) =>
          (a.startedPollLastAt ?? a.startDetectedAt ?? a.closedAt ?? 0) -
          (b.startedPollLastAt ?? b.startDetectedAt ?? b.closedAt ?? 0),
      )
      .slice(0, 250);

    for (const record of targets) {
      const exists = await this.checkExists(record.gameID);
      const existsValue =
        exists.json && typeof exists.json === "object"
          ? (exists.json as ExistsResponse).exists === true
          : false;

      if (!existsValue) {
        this.store.markCompleted(
          record.gameID,
          now,
          "historical-sweep-exists-false",
        );
        await this.tryArchiveLookup(record.gameID);
        continue;
      }

      const info = await this.fetchGameInfo(record.gameID);
      this.store.markStartedHeartbeat(record.gameID, {
        checkedAt: now,
        playersInGame: info?.clients?.length,
        statusCode: exists.status,
      });
    }
  }

  private async pollStartedGames(): Promise<void> {
    const now = Date.now();
    const thresholdMs = 10 * 60_000;
    const targets = this.store
      .values()
      .filter((record) => record.status === "started")
      .filter(
        (record) =>
          !record.startedPollLastAt || now - record.startedPollLastAt >= thresholdMs,
      )
      .sort(
        (a, b) => (a.startedPollLastAt ?? a.startDetectedAt ?? 0) - (b.startedPollLastAt ?? b.startDetectedAt ?? 0),
      )
      .slice(0, 20);

    for (const record of targets) {
      const exists = await this.checkExists(record.gameID);
      const existsValue =
        exists.json && typeof exists.json === "object"
          ? (exists.json as ExistsResponse).exists === true
          : false;

      if (!existsValue) {
        this.store.markCompleted(
          record.gameID,
          now,
          "exists-endpoint-false",
        );
        await this.tryArchiveLookup(record.gameID);
        continue;
      }

      const info = await this.fetchGameInfo(record.gameID);
      this.store.markStartedHeartbeat(record.gameID, {
        checkedAt: now,
        playersInGame: info?.clients?.length,
        statusCode: exists.status,
      });
    }
  }

  private async safeRun(
    label: string,
    fn: () => Promise<void>,
  ): Promise<void> {
    try {
      await fn();
    } catch (error) {
      this.store.systemNote(`Task ${label} failed: ${String(error)}`);
      // eslint-disable-next-line no-console
      console.error(`[lobbystatistics] task ${label} failed`, error);
    }
  }

  private async tryArchiveLookup(gameID: string): Promise<void> {
    if (!this.config.archiveApiBase) return;
    const attempts = (this.archiveAttemptCount.get(gameID) ?? 0) + 1;
    this.archiveAttemptCount.set(gameID, attempts);
    if (attempts > 8) return;

    const url = `${this.config.archiveApiBase}/game/${encodeURIComponent(gameID)}`;
    const response = await this.fetchJson(url, 4000);
    if (response.status !== 200 || response.json === null) return;
    const parsed = ArchiveSummarySchema.safeParse(response.json);
    if (!parsed.success) return;

    const info = parsed.data.info;
    const normalizeTimestamp = (timestamp: number | undefined): number | undefined => {
      if (timestamp === undefined || !Number.isFinite(timestamp)) return undefined;
      return timestamp < 1e12 ? Math.round(timestamp * 1000) : Math.round(timestamp);
    };
    const winnerLabel = (() => {
      if (!info?.winner) return undefined;
      if (
        typeof info.winner === "object" &&
        !Array.isArray(info.winner) &&
        info.winner !== null &&
        "username" in info.winner
      ) {
        const value = info.winner.username;
        return typeof value === "string" && value.length > 0 ? value : undefined;
      }
      if (Array.isArray(info.winner)) {
        const winnerArray = info.winner;
        if (winnerArray.length === 0) return undefined;
        const type = winnerArray[0];
        if (type === "nation" && winnerArray[1]) return winnerArray[1];
        if (type === "player" && winnerArray[1]) {
          const id = winnerArray[1];
          const player = info.players?.find((entry) => entry.clientID === id);
          return player?.username ?? id;
        }
        if (type === "team") {
          const ids = winnerArray.slice(2);
          if (ids.length === 0) return undefined;
          const names = ids
            .map((id) => info.players?.find((entry) => entry.clientID === id)?.username ?? id)
            .filter((entry) => !!entry);
          return names.join(", ");
        }
      }
      return undefined;
    })();

    this.store.setArchiveSummary(gameID, {
      found: true,
      players: info?.players?.length,
      durationSec:
        typeof info?.duration === "number" ? Math.round(info.duration) : undefined,
      winner: winnerLabel,
      lobbyCreatedAt: normalizeTimestamp(info?.lobbyCreatedAt),
      startAt: normalizeTimestamp(info?.start),
      endAt: normalizeTimestamp(info?.end),
    });
  }

  private async fetchJson(
    url: string,
    timeoutMs: number,
  ): Promise<{ status: number; json: unknown | null }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method: "GET",
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.includes("application/json")) {
        return { status: response.status, json: null };
      }
      const json = await response.json();
      return { status: response.status, json };
    } catch {
      return { status: 0, json: null };
    } finally {
      clearTimeout(timeout);
    }
  }
}
