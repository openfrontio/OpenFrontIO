import http from "http";
import { WebSocket, WebSocketServer } from "ws";
import { CloseCode, CloseReason } from "../core/CloseCodes";
import {
  ClientPlatform,
  ClientPlatformSchema,
  GameConfig,
  PublicGameInfo,
  PublicGames,
  PublicLobbyMessage,
} from "../core/Schemas";
import { encodeLobbyMessage } from "../core/ZbinWire";
import { GameManager } from "./GameManager";
import {
  InternalGameInfo,
  InternalPublicGames,
  MasterMessageSchema,
  WorkerLobbyList,
  WorkerReady,
} from "./IPCBridgeSchema";
import { logger } from "./Logger";
import { ServerEnv } from "./ServerEnv";

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
  delete sanitized.pool;
  return sanitized;
}

export class WorkerLobbyService {
  private readonly lobbiesWss: WebSocketServer;
  // Keyed by socket, valued by the platform the client named in the
  // upgrade URL's ?platform= (see LobbySocket.ts), for the per-platform gauge.
  private readonly lobbyClients: Map<WebSocket, ClientPlatform | "unknown"> =
    new Map();
  // Most recent snapshot from master, serialized on demand for new
  // connections so they don't have to wait for the next broadcast.
  private lastPublicGames: InternalPublicGames | null = null;
  // Fingerprint (sorted per-lobby JSON of everything clients receive except
  // player counts) of the last full we broadcast, or null if we've never
  // broadcast one. When it changes we send a fresh full; otherwise a
  // counts-only delta is enough. Null (not "") is used so that an
  // empty-lobby first broadcast still emits a full.
  private lastFullGameIds: string | null = null;
  // Deployment-active flag from the master's broadcast (see
  // MasterLobbiesBroadcastSchema.active). Stamped onto every full snapshot so
  // pinned tabs on a draining deployment get told to reload, and read by the
  // ranked check-in loop so a draining server stops offering matches too
  // (RankedCheckin.ts, OPE-469).
  private deploymentActive = true;

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

  /**
   * Whether the master last said this deployment may take new games. True
   * until the first broadcast arrives, so a worker that has not yet heard
   * from its master behaves as it always has.
   */
  isDeploymentActive(): boolean {
    return this.deploymentActive;
  }

  /** Browsers currently connected to this worker's /lobbies socket. */
  connectedClients(): number {
    return this.lobbyClients.size;
  }

  /** Same, per platform, zeros included. */
  connectedClientsByPlatform(): Map<ClientPlatform | "unknown", number> {
    const counts = new Map<ClientPlatform | "unknown", number>(
      [...ClientPlatformSchema.options, "unknown" as const].map((p) => [p, 0]),
    );
    for (const platform of this.lobbyClients.values()) {
      counts.set(platform, counts.get(platform)! + 1);
    }
    return counts;
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
        // Flag flips force a full broadcast (by busting the fingerprint):
        // already-connected clients must hear about a drain promptly, not at
        // the next structural lobby change.
        if ((msg.active ?? true) !== this.deploymentActive) {
          this.deploymentActive = msg.active ?? true;
          this.lastFullGameIds = null;
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
    // Matchmaking games have a Public gameType (so they appear in
    // publicLobbies()) but no publicGameType: they are invite-only and must
    // never be advertised, and the master rejects entries without one.
    const publicLobbies = this.gm
      .publicLobbies()
      .map((g) => ({ game: g, info: g.gameInfo() }))
      .filter(({ info }) => info.publicGameType !== undefined)
      .map(({ game, info }) => {
        return {
          gameID: info.gameID,
          numClients: info.clients?.length ?? 0,
          startsAt: info.startsAt,
          gameConfig: info.gameConfig,
          publicGameType: info.publicGameType!,
          createdAt: game.createdAt,
        } satisfies InternalGameInfo;
      });
    // Subscriber-listed private lobbies. creatorID (a hash of the creator's
    // persistentID) rides along for the one-listed-lobby-per-creator check;
    // sanitizeGames strips it before anything reaches browsers. The config is
    // reduced to the publicLobbyGameConfig allowlist. A lobby the host paid
    // to queue is reported as Special with its queuedAt, which puts it right
    // behind the counting-down Special lobby.
    const hostedLobbies = this.gm.listedLobbies().map((g) => {
      const gi = g.gameInfo();
      return {
        gameID: gi.gameID,
        numClients: gi.clients?.length ?? 0,
        startsAt: gi.startsAt,
        gameConfig: gi.gameConfig && publicLobbyGameConfig(gi.gameConfig),
        publicGameType: g.isQueued() ? "special" : "hosted",
        queuedAt: g.queuedAt(),
        creatorID: g.hashedCreatorID(),
        createdAt: g.createdAt,
        // Already sanitised on the way in (GameServer.setFeatured), so nothing
        // unsanitised can reach a browser even if another producer appears.
        label: g.lobbyLabel(),
        accent: g.lobbyAccent(),
        featured: g.isFeatured() ? true : undefined,
        autoStartAt: gi.autoStartAt,
        custom: g.isFeatured() ? undefined : true,
      } satisfies InternalGameInfo;
    });
    this.sendToMaster({
      type: "lobbyList",
      lobbies: [...publicLobbies, ...hostedLobbies],
      liveGames: this.gm.activeGames(),
    } satisfies WorkerLobbyList);
  }

  // Whether the creator (hashed persistentID) already has a listed lobby
  // other than `excludeGameID`. Checks the cluster-wide view from the last
  // master broadcast plus this worker's own lobbies (fresher than the
  // broadcast interval). A lobby the host paid to queue is broadcast under
  // special, and still counts as their one listing.
  public creatorHasListedLobby(
    hashedCreatorID: string,
    excludeGameID: string,
  ): boolean {
    const broadcast = [
      ...(this.lastPublicGames?.games["hosted"] ?? []),
      ...(this.lastPublicGames?.games["special"] ?? []),
    ];
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
      .filter((g) => !g.isQueued() && !broadcastIds.has(g.id)).length;
    return broadcast.length + localExtra;
  }

  // Strips worker/master-internal fields (creatorID, createdAt, queuedAt)
  // before lobby info is sent to browser clients, converting
  // InternalGameInfo to the browser-facing PublicGameInfo.
  private sanitizeGames(
    games: InternalPublicGames["games"],
  ): PublicGames["games"] {
    const sanitized: PublicGames["games"] = {};
    for (const [type, list] of Object.entries(games) as [
      keyof PublicGames["games"],
      InternalGameInfo[],
    ][]) {
      sanitized[type] = list.map(
        ({
          creatorID: _creatorID,
          createdAt: _createdAt,
          queuedAt: _queuedAt,
          ...rest
        }): PublicGameInfo => rest,
      );
    }
    return sanitized;
  }

  private setupUpgradeHandler() {
    this.server.on("upgrade", (request, socket, head) => {
      const pathname = (request.url ?? "").split("?")[0];
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
    this.lobbiesWss.on(
      "connection",
      (ws: WebSocket, request?: http.IncomingMessage) => {
        this.lobbyClients.set(ws, lobbyClientPlatform(request?.url));
        // Prime the new client with the most recent snapshot — otherwise it
        // would only see counts-only deltas (which it can't apply without a
        // base) until the next structural change.
        if (this.lastPublicGames !== null) {
          ws.send(
            encodeLobbyMessage({
              type: "full",
              serverTime: this.lastPublicGames.serverTime,
              games: this.sanitizeGames(this.lastPublicGames.games),
              gitCommit: ServerEnv.gitCommit(),
              active: this.deploymentActive,
            } satisfies PublicLobbyMessage),
          );
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
              ws.close(CloseCode.InternalError, CloseReason.InternalError);
            }
          } catch (closeError) {
            this.log.error("Error closing lobbies WebSocket:", closeError);
          }
        });
      },
    );
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
        gitCommit: ServerEnv.gitCommit(),
        active: this.deploymentActive,
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
    const frame = encodeLobbyMessage(payload);

    const clientsToRemove: WebSocket[] = [];
    for (const client of this.lobbyClients.keys()) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(frame);
      } else {
        clientsToRemove.push(client);
      }
    }

    clientsToRemove.forEach((client) => {
      this.lobbyClients.delete(client);
    });
  }
}

// The platform a lobby client announced in its upgrade URL. Anything missing
// or unrecognised (an older bundle, a hand-rolled client) counts as unknown.
function lobbyClientPlatform(
  url: string | undefined,
): ClientPlatform | "unknown" {
  const query = url?.split("?")[1];
  if (query === undefined) return "unknown";
  const parsed = ClientPlatformSchema.safeParse(
    new URLSearchParams(query).get("platform"),
  );
  return parsed.success ? parsed.data : "unknown";
}
