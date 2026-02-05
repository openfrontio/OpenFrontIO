import http from "http";
import { WebSocket, WebSocketServer } from "ws";
import { PublicGameInfo, PublicGames } from "../core/Schemas";
import { GameManager } from "./GameManager";
import {
  MasterMessageSchema,
  WorkerLobbyList,
  WorkerReady,
} from "./IPCBridgeSchema";
import { logger } from "./Logger";

export class WorkerLobbyService {
  private readonly lobbiesWss: WebSocketServer;
  private readonly lobbyClients: Set<WebSocket> = new Set();

  constructor(
    private readonly server: http.Server,
    private readonly gameWss: WebSocketServer,
    private readonly gm: GameManager,
    private readonly log: typeof logger,
  ) {
    this.lobbiesWss = new WebSocketServer({ noServer: true });
    this.setupUpgradeHandler();
    this.setupLobbiesWebSocket();
    this.setupIPCListener();
  }

  private setupIPCListener() {
    process.on("message", (raw: unknown) => {
      const result = MasterMessageSchema.safeParse(raw);
      if (!result.success) {
        this.log.error("Invalid IPC message from master:", raw);
        return;
      }

      const msg = result.data;
      switch (msg.type) {
        case "lobbiesBroadcast":
          // Forward message to all clients
          this.broadcastLobbiesToClients(msg.publicGames);
          // Update master with my lobby info
          this.sendMyLobbiesToMaster();
          break;
        case "createGame":
          if (this.gm.game(msg.gameID) !== null) {
            this.log.warn(`Game ${msg.gameID} already exists, skipping create`);
            return;
          }
          this.log.info(`Creating public game ${msg.gameID} from master`);
          this.gm.createGame(
            msg.gameID,
            msg.gameConfig,
            undefined,
            msg.startsAt,
          );
          break;
      }
    });
  }

  sendReady(workerId: number) {
    const msg: WorkerReady = { type: "workerReady", workerId };
    process.send?.(msg);
  }

  private sendMyLobbiesToMaster() {
    const lobbies = this.gm
      .publicLobbies()
      .map((g) => g.gameInfo())
      .map((gi) => {
        return {
          gameID: gi.gameID,
          numClients: gi.clients?.length ?? 0,
          startsAt: gi.startsAt!,
          gameConfig: gi.gameConfig,
        } satisfies PublicGameInfo;
      });
    process.send?.({ type: "lobbyList", lobbies } satisfies WorkerLobbyList);
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

  private broadcastLobbiesToClients(publicGames: PublicGames) {
    const message = JSON.stringify(publicGames);

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
}
