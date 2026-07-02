import http from "http";
import { WebSocket, WebSocketServer } from "ws";
import {
  PublicGameInfo,
  PublicGames,
  PublicLobbyMessage,
} from "../core/Schemas";
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
  // Most recent snapshot from master, serialized on demand for new
  // connections so they don't have to wait for the next broadcast.
  private lastPublicGames: PublicGames | null = null;
  // Fingerprint (sorted per-lobby tokens of gameID + browser-visible config)
  // of the last full we broadcast, or null if we've never broadcast one. When
  // it changes we send a fresh full; otherwise a counts-only delta is enough.
  // Null (not "") is used so that an empty-lobby first broadcast still emits
  // a full.
  private lastFullGameIds: string | null = null;

  constructor(
    private readonly server: http.Server,
    private readonly gameWss: WebSocketServer,
    private readonly gm: GameManager,
    private readonly log: typeof logger,
  ) {
    this.lobbiesWss = new WebSocketServer({
      noServer: true,
      maxPayload: 256 * 1024,
    });
    this.setupUpgradeHandler();
    this.setupLobbiesWebSocket();
    this.setupIPCListener();
  }

  private setupIPCListener() {
    process.on("message", (raw: unknown) => this.handleMasterMessage(raw));
  }

  // Separate from setupIPCListener so tests can dispatch messages without
  // touching the real process IPC channel (which vitest forks use).
  private handleMasterMessage(raw: unknown) {
    const result = MasterMessageSchema.safeParse(raw);
    if (!result.success) {
      this.log.error("Invalid IPC message from master:", raw);
      return;
    }

    const msg = result.data;
    switch (msg.type) {
      case "lobbiesBroadcast":
        this.lastPublicGames = msg.publicGames;
        // Forward message to all clients
        this.broadcastLobbiesToClients(msg.publicGames);
        // Update master with my lobby info
        this.sendMyLobbiesToMaster();
        break;
      case "createGame": {
        if (this.gm.game(msg.gameID) !== null) {
          this.log.warn(`Game ${msg.gameID} already exists, skipping create`);
          return;
        }
        this.log.info(`Creating public game ${msg.gameID} from master`);
        const game = this.gm.createGame(
          msg.gameID,
          msg.gameConfig,
          undefined,
          undefined,
          msg.publicGameType,
        );
        if (game === null) {
          this.log.warn(`Game ${msg.gameID} already exists, skipping create`);
        }
        break;
      }
      case "updateLobby": {
        const game = this.gm.game(msg.gameID);
        if (!game) {
          this.log.warn("cannot update game, not found", {
            gameID: msg.gameID,
          });
          return;
        }
        game.setStartsAt(msg.startsAt);
        break;
      }
    }
  }

  sendReady(workerId: number) {
    this.sendToMaster({ type: "workerReady", workerId });
  }

  private sendToMaster(msg: WorkerReady | WorkerLobbyList) {
    process.send?.(msg);
  }

  private sendMyLobbiesToMaster() {
    const publicLobbies = this.gm
      .publicLobbies()
      .map((g) => g.gameInfo())
      .map((gi) => {
        return {
          gameID: gi.gameID,
          numClients: gi.clients?.length ?? 0,
          startsAt: gi.startsAt,
          gameConfig: gi.gameConfig,
          publicGameType: gi.publicGameType!,
        } satisfies PublicGameInfo;
      });
    // Subscriber-listed private lobbies. creatorID (a hash of the creator's
    // persistentID) rides along for the one-listed-lobby-per-creator check;
    // sanitizeGames strips it before anything reaches browsers. Host-only
    // config fields (whitelist, name reveals) are dropped here — the lobby
    // browser doesn't need them.
    const hostedLobbies = this.gm.listedLobbies().map((g) => {
      const gi = g.gameInfo();
      return {
        gameID: gi.gameID,
        numClients: gi.clients?.length ?? 0,
        startsAt: gi.startsAt,
        gameConfig: gi.gameConfig && {
          ...gi.gameConfig,
          allowedPublicIds: undefined,
          nameReveals: undefined,
          nameRevealPublicIds: undefined,
        },
        publicGameType: "hosted",
        creatorID: g.hashedCreatorID(),
      } satisfies PublicGameInfo;
    });
    this.sendToMaster({
      type: "lobbyList",
      lobbies: [...publicLobbies, ...hostedLobbies],
    } satisfies WorkerLobbyList);
  }

  // Whether the creator (hashed persistentID) already has a listed lobby
  // other than `excludeGameID`. Checks the cluster-wide view from the last
  // master broadcast plus this worker's own lobbies (fresher than the
  // broadcast interval).
  public creatorHasListedLobby(
    hashedCreatorID: string,
    excludeGameID: string,
  ): boolean {
    const broadcast = this.lastPublicGames?.games["hosted"] ?? [];
    if (
      broadcast.some(
        (l) => l.gameID !== excludeGameID && l.creatorID === hashedCreatorID,
      )
    ) {
      return true;
    }
    return this.gm
      .listedLobbies()
      .some(
        (g) =>
          g.id !== excludeGameID && g.hashedCreatorID() === hashedCreatorID,
      );
  }

  // Strips worker/master-internal fields (creatorID) before lobby info is
  // sent to browser clients.
  private sanitizeGames(games: PublicGames["games"]): PublicGames["games"] {
    const sanitized: PublicGames["games"] = {};
    for (const [type, list] of Object.entries(games) as [
      keyof PublicGames["games"],
      PublicGameInfo[],
    ][]) {
      sanitized[type] = list.map(({ creatorID: _creatorID, ...rest }) => rest);
    }
    return sanitized;
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
      // Prime the new client with the most recent snapshot — otherwise it
      // would only see counts-only deltas (which it can't apply without a
      // base) until the next structural change.
      if (this.lastPublicGames !== null) {
        const fullJson = JSON.stringify({
          type: "full",
          serverTime: this.lastPublicGames.serverTime,
          games: this.sanitizeGames(this.lastPublicGames.games),
        } satisfies PublicLobbyMessage);
        ws.send(fullJson);
      }
      ws.on("message", () => {
        ws.terminate();
      });
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
    // Per-lobby token covers everything the lobby browser renders besides
    // player counts: hosted lobbies can change map/mode/etc. without a
    // gameID change, and those edits must trigger a fresh full.
    const lobbyTokens: string[] = [];
    for (const list of Object.values(publicGames.games)) {
      for (const lobby of list) {
        const gc = lobby.gameConfig;
        lobbyTokens.push(
          `${lobby.gameID}:${gc?.gameMap}:${gc?.gameMode}:${gc?.playerTeams}:${gc?.maxPlayers}:${lobby.startsAt}`,
        );
      }
    }
    lobbyTokens.sort();
    const fingerprint = lobbyTokens.join(",");
    const shouldSendFull = fingerprint !== this.lastFullGameIds;

    let payload: PublicLobbyMessage;
    if (shouldSendFull) {
      payload = {
        type: "full",
        serverTime: publicGames.serverTime,
        games: this.sanitizeGames(publicGames.games),
      };
      this.lastFullGameIds = fingerprint;
    } else {
      const counts: Record<string, number> = {};
      for (const list of Object.values(publicGames.games)) {
        for (const lobby of list) {
          counts[lobby.gameID] = lobby.numClients;
        }
      }
      payload = {
        type: "counts",
        serverTime: publicGames.serverTime,
        counts,
      };
    }
    const json = JSON.stringify(payload);

    const clientsToRemove: WebSocket[] = [];
    this.lobbyClients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(json);
      } else {
        clientsToRemove.push(client);
      }
    });

    clientsToRemove.forEach((client) => {
      this.lobbyClients.delete(client);
    });
  }
}
