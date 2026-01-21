import http from "http";
import { WebSocket, WebSocketServer } from "ws";
import { ServerConfig } from "../core/configuration/Config";
import { GameInfo } from "../core/Schemas";
import { GameManager } from "./GameManager";
import { logger } from "./Logger";
import { startPolling } from "./PollingLoop";
import {
  getAllLobbyInfo,
  getPendingGamesForWorker,
  getPublicLobbyIDs,
  removeLobbyInfo,
  removePendingGame,
  removePublicLobbyID,
  setLobbyInfo,
} from "./RedisClient";

export interface WorkerLobbyServiceOptions {
  server: http.Server;
  gameWss: WebSocketServer;
  gm: GameManager;
  config: ServerConfig;
  workerId: number;
  log: typeof logger;
}

export class WorkerLobbyService {
  private readonly lobbiesWss: WebSocketServer;
  private readonly lobbyClients: Set<WebSocket> = new Set();
  private publicLobbiesData: { lobbies: GameInfo[] } = { lobbies: [] };

  private readonly server: http.Server;
  private readonly gameWss: WebSocketServer;
  private readonly gm: GameManager;
  private readonly config: ServerConfig;
  private readonly workerId: number;
  private readonly log: typeof logger;

  constructor(options: WorkerLobbyServiceOptions) {
    this.server = options.server;
    this.gameWss = options.gameWss;
    this.gm = options.gm;
    this.config = options.config;
    this.workerId = options.workerId;
    this.log = options.log;

    this.lobbiesWss = new WebSocketServer({ noServer: true });
    this.setupUpgradeHandler();
    this.setupLobbiesWebSocket();
  }

  private setupUpgradeHandler() {
    this.server.on("upgrade", (request, socket, head) => {
      const pathname = request.url ?? "";
      if (pathname === "/lobbies" || pathname.endsWith("/lobbies")) {
        this.lobbiesWss.handleUpgrade(request, socket, head, (ws) => {
          this.lobbiesWss.emit("connection", ws, request);
        });
      } else {
        this.gameWss.handleUpgrade(request, socket, head, (ws) => {
          this.gameWss.emit("connection", ws, request);
        });
      }
    });
  }

  private setupLobbiesWebSocket() {
    this.lobbiesWss.on("connection", (ws: WebSocket) => {
      this.lobbyClients.add(ws);

      // Send current lobbies immediately
      ws.send(
        JSON.stringify({
          type: "lobbies_update",
          data: this.publicLobbiesData,
        }),
      );

      ws.on("close", () => {
        this.lobbyClients.delete(ws);
      });

      ws.on("error", (error) => {
        this.log.error(`Lobbies WebSocket error:`, error);
        this.lobbyClients.delete(ws);
        try {
          if (
            ws.readyState === WebSocket.OPEN ||
            ws.readyState === WebSocket.CONNECTING
          ) {
            ws.close(1011, "WebSocket internal error");
          }
        } catch (closeError) {
          this.log.error("Error closing lobbies WebSocket:", closeError);
        }
      });
    });
  }

  private broadcastLobbies() {
    const message = JSON.stringify({
      type: "lobbies_update",
      data: this.publicLobbiesData,
    });

    const clientsToRemove: WebSocket[] = [];
    this.lobbyClients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      } else {
        clientsToRemove.push(client);
      }
    });

    clientsToRemove.forEach((client) => {
      this.lobbyClients.delete(client);
    });
  }

  /**
   * Start all lobby-related polling loops
   */
  start() {
    this.startLobbyPolling();
    this.startGameInfoPolling();
    this.startRedisPolling();
  }

  /**
   * Get current public lobbies data (for HTTP endpoint)
   */
  getPublicLobbiesData(): { lobbies: GameInfo[] } {
    return this.publicLobbiesData;
  }

  private startLobbyPolling() {
    startPolling(async () => {
      try {
        const lobbyInfos = await getAllLobbyInfo();

        // Filter out games that are about to start or full
        const validLobbies = lobbyInfos
          .filter((info) => {
            if (info.msUntilStart !== undefined && info.msUntilStart <= 250)
              return false;
            const gc = info.gameConfig as { maxPlayers?: number } | undefined;
            if (
              gc?.maxPlayers !== undefined &&
              info.numClients >= gc.maxPlayers
            )
              return false;
            return true;
          })
          .map(
            (info) =>
              ({
                gameID: info.gameID,
                numClients: info.numClients,
                gameConfig: info.gameConfig,
                msUntilStart: info.msUntilStart,
              }) as GameInfo,
          );

        this.publicLobbiesData = { lobbies: validLobbies };
        this.broadcastLobbies();
      } catch (error) {
        this.log.error("Error polling lobbies from Redis:", error);
      }
    }, 100);
  }

  private startGameInfoPolling() {
    startPolling(async () => {
      try {
        const publicLobbyIDs = await getPublicLobbyIDs();

        for (const gameID of publicLobbyIDs) {
          // Only update games that belong to this worker
          if (this.config.workerIndex(gameID) !== this.workerId) continue;

          const game = this.gm.game(gameID);
          if (game === null) {
            // Game no longer exists, clean up
            await removeLobbyInfo(gameID);
            await removePublicLobbyID(gameID);
            continue;
          }

          const info = game.gameInfo();
          await setLobbyInfo({
            gameID: info.gameID,
            numClients: info.clients?.length ?? 0,
            msUntilStart: info.msUntilStart,
            gameConfig: info.gameConfig,
            updatedAt: Date.now(),
          });

          // Remove from public lobbies if game started or is full
          if (info.msUntilStart !== undefined && info.msUntilStart <= 250) {
            await removePublicLobbyID(gameID);
            await removeLobbyInfo(gameID);
          }
        }
      } catch (error) {
        this.log.error("Error updating game info in Redis:", error);
      }
    }, 100);
  }

  private startRedisPolling() {
    startPolling(async () => {
      try {
        const pendingGames = await getPendingGamesForWorker(
          this.config.workerIndex.bind(this.config),
          this.workerId,
        );

        for (const pending of pendingGames) {
          // Check if game already exists
          if (this.gm.game(pending.gameID) !== null) {
            await removePendingGame(pending.gameID);
            continue;
          }

          this.log.info(`Creating game ${pending.gameID} from Redis`);
          this.gm.createGame(pending.gameID, pending.gameConfig);
          await removePendingGame(pending.gameID);
        }
      } catch (error) {
        this.log.error(`Error polling Redis for pending games:`, error);
      }
    }, 200);
  }
}
