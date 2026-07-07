import http from "http";
import { WebSocket, WebSocketServer } from "ws";
import {
  GameConfig,
  PublicGameInfo,
  PublicGames,
  PublicLobbyMessage,
} from "../core/Schemas";
import { GameManager } from "./GameManager";
import {
  InternalGameInfo,
  InternalPublicGames,
  MasterMessageSchema,
  WorkerLobbyList,
  WorkerReady,
} from "./IPCBridgeSchema";
import { logger } from "./Logger";

// The game config advertised for a listed private lobby: everything the
// host configured minus host-only fields. The server already rejects
// enabling the whitelist or host cheats while listed; stripping them here
// just keeps host-only data off the wire. A new host-only GameConfig field
// must be added to this delete list.
function publicLobbyGameConfig(gc: GameConfig): GameConfig {
  const sanitized = { ...gc };
  delete sanitized.allowedPublicIds;
  delete sanitized.nameReveals;
  delete sanitized.nameRevealPublicIds;
  delete sanitized.hostCheats;
  return sanitized;
}

export class WorkerLobbyService {
  private readonly lobbiesWss: WebSocketServer;
  private readonly lobbyClients: Set<WebSocket> = new Set();
  // Most recent snapshot from master, serialized on demand for new
  // connections so they don't have to wait for the next broadcast.
  private lastPublicGames: InternalPublicGames | null = null;
  // Fingerprint (sorted per-lobby JSON of everything clients receive except
  // player counts) of the last full we broadcast, or null if we've never
  // broadcast one. When it changes we send a fresh full; otherwise a
  // counts-only delta is enough. Null (not "") is used so that an
  // empty-lobby first broadcast still emits a full.
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
        // The master resolved a duplicate-creator race: clear the loser's
        // listed flag so this worker's state follows the broadcast. Done
        // before sendMyLobbiesToMaster so the next report reflects it.
        for (const gameID of msg.delistGameIDs ?? []) {
          const game = this.gm.game(gameID);
          if (game?.isListed()) {
            game.setListed(false);
            this.log.info(`delisted by master: duplicate creator`, { gameID });
          }
        }
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
    // sanitizeGames strips it before anything reaches browsers. The config is
    // reduced to the publicLobbyGameConfig allowlist.
    const hostedLobbies = this.gm.listedLobbies().map((g) => {
      const gi = g.gameInfo();
      return {
        gameID: gi.gameID,
        numClients: gi.clients?.length ?? 0,
        startsAt: gi.startsAt,
        gameConfig: gi.gameConfig && publicLobbyGameConfig(gi.gameConfig),
        publicGameType: "hosted",
        creatorID: g.hashedCreatorID(),
      } satisfies InternalGameInfo;
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
      broadcast.some((l) => {
        if (l.gameID === excludeGameID || l.creatorID !== hashedCreatorID) {
          return false;
        }
        // Broadcast entries lag a delist by up to two master cycles. For
        // games this worker owns, local state is authoritative — a
        // just-delisted lobby must not block the creator from listing a
        // new one.
        const local = this.gm.game(l.gameID);
        return local === null || local.isListed();
      })
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

  // Cluster-wide count of listed hosted lobbies: the master broadcast plus
  // this worker's own listed lobbies that haven't reached it yet. Approximate
  // by up to a broadcast round-trip; the master's cap is the backstop.
  public hostedLobbyCount(): number {
    const broadcast = this.lastPublicGames?.games["hosted"] ?? [];
    const broadcastIds = new Set(broadcast.map((l) => l.gameID));
    const localExtra = this.gm
      .listedLobbies()
      .filter((g) => !broadcastIds.has(g.id)).length;
    return broadcast.length + localExtra;
  }

  // Strips worker/master-internal fields (creatorID) before lobby info is
  // sent to browser clients, converting InternalGameInfo to the
  // browser-facing PublicGameInfo.
  private sanitizeGames(
    games: InternalPublicGames["games"],
  ): PublicGames["games"] {
    const sanitized: PublicGames["games"] = {};
    for (const [type, list] of Object.entries(games) as [
      keyof PublicGames["games"],
      InternalGameInfo[],
    ][]) {
      sanitized[type] = list.map(
        ({ creatorID: _creatorID, ...rest }): PublicGameInfo => rest,
      );
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

  private broadcastLobbiesToClients(publicGames: InternalPublicGames) {
    // Per-lobby token is the JSON of exactly what clients receive, minus the
    // player count: hosted lobbies can change config without a gameID
    // change, and anything a client could render must trigger a fresh full.
    // Fingerprinting the sanitized payload keeps "what forces a full" and
    // "what clients see" from drifting apart.
    const sanitizedGames = this.sanitizeGames(publicGames.games);
    const lobbyTokens: string[] = [];
    for (const list of Object.values(sanitizedGames)) {
      for (const lobby of list) {
        // JSON.stringify drops undefined-valued keys, excluding the count.
        lobbyTokens.push(JSON.stringify({ ...lobby, numClients: undefined }));
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
        games: sanitizedGames,
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
