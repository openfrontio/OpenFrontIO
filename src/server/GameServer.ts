import ipAnonymize from "ip-anonymize";
import { Logger } from "winston";
import WebSocket from "ws";
import { z } from "zod/v4";
import {
  ClientID,
  ClientMessageSchema,
  ClientSendWinnerMessage,
  GameConfig,
  GameInfo,
  GameStartInfo,
  GameStartInfoSchema,
  Intent,
  PlayerRecord,
  ServerDesyncSchema,
  ServerErrorMessage,
  ServerPrestartMessageSchema,
  ServerStartGameMessage,
  ServerTurnMessage,
  Turn,
} from "../core/Schemas";
import { createGameRecord } from "../core/Util";
import { GameEnv, ServerConfig } from "../core/configuration/Config";
import { GameType } from "../core/game/Game";
import { archive } from "./Archive";
import { Client } from "./Client";
import { gatekeeper } from "./Gatekeeper";
export enum GamePhase {
  Lobby = "LOBBY",
  Active = "ACTIVE",
  Finished = "FINISHED",
}

export class GameServer {
  private sentDesyncMessageClients = new Set<ClientID>();

  private maxGameDuration = 3 * 60 * 60 * 1000; // 3 hours

  private disconnectedTimeout = 1 * 30 * 1000; // 30 seconds

  private turns: Turn[] = [];
  private intents: Intent[] = [];
  public activeClients: Client[] = [];
  // Used for record record keeping
  private allClients: Map<ClientID, Client> = new Map();
  private _hasStarted = false;
  private _startTime: number | null = null;

  private endTurnIntervalID;

  private lastPingUpdate = 0;

  private winner: ClientSendWinnerMessage | null = null;

  private gameStartInfo: GameStartInfo;

  private log: Logger;

  private _hasPrestarted = false;

  private kickedClients: Set<ClientID> = new Set();
  private outOfSyncClients: Set<ClientID> = new Set();

  constructor(
    public readonly id: string,
    readonly log_: Logger,
    public readonly createdAt: number,
    private config: ServerConfig,
    public gameConfig: GameConfig,
  ) {
    this.log = log_.child({ gameID: id });
  }

  public updateGameConfig(gameConfig: Partial<GameConfig>): void {
    if (gameConfig.gameMap !== undefined) {
      this.gameConfig.gameMap = gameConfig.gameMap;
    }
    if (gameConfig.difficulty !== undefined) {
      this.gameConfig.difficulty = gameConfig.difficulty;
    }
    if (gameConfig.disableNPCs !== undefined) {
      this.gameConfig.disableNPCs = gameConfig.disableNPCs;
    }
    if (gameConfig.bots !== undefined) {
      this.gameConfig.bots = gameConfig.bots;
    }
    if (gameConfig.infiniteGold !== undefined) {
      this.gameConfig.infiniteGold = gameConfig.infiniteGold;
    }
    if (gameConfig.infiniteTroops !== undefined) {
      this.gameConfig.infiniteTroops = gameConfig.infiniteTroops;
    }
    if (gameConfig.instantBuild !== undefined) {
      this.gameConfig.instantBuild = gameConfig.instantBuild;
    }
    if (gameConfig.gameMode !== undefined) {
      this.gameConfig.gameMode = gameConfig.gameMode;
    }

    if (gameConfig.disabledUnits !== undefined) {
      this.gameConfig.disabledUnits = gameConfig.disabledUnits;
    }

    if (gameConfig.playerTeams !== undefined) {
      this.gameConfig.playerTeams = gameConfig.playerTeams;
    }
  }

  public addClient(client: Client, lastTurn: number) {
    if (this.kickedClients.has(client.clientID)) {
      this.log.warn(`cannot add client, already kicked`, {
        clientID: client.clientID,
      });
      return;
    }
    this.log.info("client (re)joining game", {
      clientID: client.clientID,
      persistentID: client.persistentID,
      clientIP: ipAnonymize(client.ip),
      isRejoin: lastTurn > 0,
    });

    if (
      this.gameConfig.gameType === GameType.Public &&
      this.activeClients.filter(
        (c) => c.ip === client.ip && c.clientID !== client.clientID,
      ).length >= 3
    ) {
      this.log.warn("cannot add client, already have 3 ips", {
        clientID: client.clientID,
        clientIP: ipAnonymize(client.ip),
      });
      return;
    }

    if (this.config.env() === GameEnv.Prod) {
      // Prevent multiple clients from using the same account in prod
      const conflicting = this.activeClients.find(
        (c) =>
          c.persistentID === client.persistentID &&
          c.clientID !== client.clientID,
      );
      if (conflicting !== undefined) {
        this.log.error("client ids do not match", {
          clientID: client.clientID,
          clientIP: ipAnonymize(client.ip),
          clientPersistentID: client.persistentID,
          existingIP: ipAnonymize(conflicting.ip),
          existingPersistentID: conflicting.persistentID,
        });
        // Kick the existing client instead of the new one, because this was causing issues when
        // a client wanted to replay the game afterwards.
        this.kickClient(conflicting.clientID);
      }
    }

    // Remove stale client if this is a reconnect
    const existing = this.activeClients.find(
      (c) => c.clientID === client.clientID,
    );
    if (existing !== undefined) {
      if (client.persistentID !== existing.persistentID) {
        this.log.error("persistent ids do not match", {
          clientID: client.clientID,
          clientIP: ipAnonymize(client.ip),
          clientPersistentID: client.persistentID,
          existingIP: ipAnonymize(existing.ip),
          existingPersistentID: existing.persistentID,
        });
        return;
      }

      client.isDisconnected = existing.isDisconnected;
      client.lastPing = existing.lastPing;

      existing.ws.removeAllListeners();
      this.activeClients = this.activeClients.filter((c) => c !== existing);
    }

    // Client connection accepted
    this.activeClients.push(client);
    client.lastPing = Date.now();

    this.allClients.set(client.clientID, client);

    client.ws.removeAllListeners("message");
    client.ws.removeAllListeners("close");
    client.ws.removeAllListeners("error");
    client.ws.on(
      "message",
      gatekeeper.wsHandler(client.ip, async (message: string) => {
        try {
          const parsed = ClientMessageSchema.safeParse(JSON.parse(message));
          if (!parsed.success) {
            const error = z.prettifyError(parsed.error);
            this.log.error("Failed to parse client message", error, {
              clientID: client.clientID,
            });
            client.ws.send(
              JSON.stringify({
                type: "error",
                error: error.toString(),
              } satisfies ServerErrorMessage),
            );
            // Add a small delay before closing the connection to ensure the error message is received
            setTimeout(() => {
              client.ws.close(1002, "ClientMessageSchema");
            }, 100);
            return;
          }
          const clientMsg = parsed.data;
          if (clientMsg.type === "intent") {
            if (clientMsg.intent.clientID !== client.clientID) {
              this.log.warn(
                `client id mismatch, client: ${client.clientID}, intent: ${clientMsg.intent.clientID}`,
              );
              return;
            }
            if (clientMsg.intent.type === "mark_disconnected") {
              this.log.warn(
                `Should not receive mark_disconnected intent from client`,
              );
              return;
            }
            this.addIntent(clientMsg.intent);
          }
          if (clientMsg.type === "ping") {
            this.lastPingUpdate = Date.now();
            client.lastPing = Date.now();
          }
          if (clientMsg.type === "hash") {
            client.hashes.set(clientMsg.turnNumber, clientMsg.hash);
          }
          if (clientMsg.type === "winner") {
            if (
              this.outOfSyncClients.has(client.clientID) ||
              this.kickedClients.has(client.clientID) ||
              this.winner !== null
            ) {
              return;
            }
            this.winner = clientMsg;
            this.archiveGame();
          }
        } catch (error) {
          this.log.info(
            `error handline websocket request in game server: ${error}`,
            {
              clientID: client.clientID,
            },
          );
        }
      }),
    );
    client.ws.on("close", () => {
      this.log.info("client disconnected", {
        clientID: client.clientID,
        persistentID: client.persistentID,
      });
      this.activeClients = this.activeClients.filter(
        (c) => c.clientID !== client.clientID,
      );
    });
    client.ws.on("error", (error: Error) => {
      if ((error as any).code === "WS_ERR_UNEXPECTED_RSV_1") {
        client.ws.close(1002, "WS_ERR_UNEXPECTED_RSV_1");
      }
    });

    // In case a client joined the game late and missed the start message.
    if (this._hasStarted) {
      this.sendStartGameMsg(client.ws, lastTurn);
    }
  }

  public numClients(): number {
    return this.activeClients.length;
  }

  public startTime(): number {
    if (this._startTime !== null && this._startTime > 0) {
      return this._startTime;
    } else {
      //game hasn't started yet, only works for public games
      return this.createdAt + this.config.gameCreationRate();
    }
  }

  public prestart() {
    if (this.hasStarted()) {
      return;
    }
    this._hasPrestarted = true;

    const prestartMsg = ServerPrestartMessageSchema.safeParse({
      type: "prestart",
      gameMap: this.gameConfig.gameMap,
    });

    if (!prestartMsg.success) {
      console.error(
        `error creating prestart message for game ${this.id}, ${prestartMsg.error}`.substring(
          0,
          250,
        ),
      );
      return;
    }

    const msg = JSON.stringify(prestartMsg.data);
    this.activeClients.forEach((c) => {
      this.log.info("sending prestart message", {
        clientID: c.clientID,
        persistentID: c.persistentID,
      });
      c.ws.send(msg);
    });
  }

  public start() {
    if (this._hasStarted) {
      return;
    }
    this._hasStarted = true;
    this._startTime = Date.now();
    // Set last ping to start so we don't immediately stop the game
    // if no client connects/pings.
    this.lastPingUpdate = Date.now();

    const result = GameStartInfoSchema.safeParse({
      gameID: this.id,
      config: this.gameConfig,
      players: this.activeClients.map((c) => ({
        username: c.username,
        clientID: c.clientID,
        pattern: c.pattern,
        flag: c.flag,
      })),
    });
    if (!result.success) {
      const error = z.prettifyError(result.error);
      this.log.error("Error parsing game start info", { message: error });
      return;
    }
    this.gameStartInfo = result.data satisfies GameStartInfo;

    this.endTurnIntervalID = setInterval(
      () => this.endTurn(),
      this.config.turnIntervalMs(),
    );
    this.activeClients.forEach((c) => {
      this.log.info("sending start message", {
        clientID: c.clientID,
        persistentID: c.persistentID,
      });
      this.sendStartGameMsg(c.ws, 0);
    });
  }

  private addIntent(intent: Intent) {
    this.intents.push(intent);
  }

  private sendStartGameMsg(ws: WebSocket, lastTurn: number) {
    try {
      ws.send(
        JSON.stringify({
          type: "start",
          turns: this.turns.slice(lastTurn),
          gameStartInfo: this.gameStartInfo,
        } satisfies ServerStartGameMessage),
      );
    } catch (error) {
      throw new Error(
        `error sending start message for game ${this.id}, ${error}`.substring(
          0,
          250,
        ),
      );
    }
  }

  private endTurn() {
    const pastTurn: Turn = {
      turnNumber: this.turns.length,
      intents: this.intents,
    };
    this.turns.push(pastTurn);
    this.intents = [];

    this.handleSynchronization();
    this.checkDisconnectedStatus();

    const msg = JSON.stringify({
      type: "turn",
      turn: pastTurn,
    } satisfies ServerTurnMessage);
    this.activeClients.forEach((c) => {
      c.ws.send(msg);
    });
  }

  async end() {
    // Close all WebSocket connections
    clearInterval(this.endTurnIntervalID);
    this.allClients.forEach((client) => {
      client.ws.removeAllListeners("message");
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.close(1000, "game has ended");
      }
    });
    if (!this._hasPrestarted && !this._hasStarted) {
      this.log.info(`game not started, not archiving game`);
      return;
    }
    this.log.info(`ending game with ${this.turns.length} turns`);
    try {
      if (this.allClients.size === 0) {
        this.log.info("no clients joined, not archiving game", {
          gameID: this.id,
        });
      } else if (this.winner !== null) {
        this.log.info("game already archived", {
          gameID: this.id,
        });
      } else {
        this.archiveGame();
      }
    } catch (error) {
      let errorDetails;
      if (error instanceof Error) {
        errorDetails = {
          message: error.message,
          stack: error.stack,
        };
      } else if (Array.isArray(error)) {
        errorDetails = error; // Now we'll actually see the array contents
      } else {
        try {
          errorDetails = JSON.stringify(error, null, 2);
        } catch (e) {
          errorDetails = String(error);
        }
      }

      this.log.error("Error archiving game record details:", {
        gameId: this.id,
        errorType: typeof error,
        error: errorDetails,
      });
    }
  }

  phase(): GamePhase {
    const now = Date.now();
    const alive: Client[] = [];
    for (const client of this.activeClients) {
      if (now - client.lastPing > 60_000) {
        this.log.info("no pings received, terminating connection", {
          clientID: client.clientID,
          persistentID: client.persistentID,
        });
        if (client.ws.readyState === WebSocket.OPEN) {
          client.ws.close(1000, "no heartbeats received, closing connection");
        }
      } else {
        alive.push(client);
      }
    }
    this.activeClients = alive;
    if (now > this.createdAt + this.maxGameDuration) {
      this.log.warn("game past max duration", {
        gameID: this.id,
      });
      return GamePhase.Finished;
    }

    const noRecentPings = now > this.lastPingUpdate + 20 * 1000;
    const noActive = this.activeClients.length === 0;

    if (this.gameConfig.gameType !== GameType.Public) {
      if (this._hasStarted) {
        if (noActive && noRecentPings) {
          this.log.info("private game complete", {
            gameID: this.id,
          });
          return GamePhase.Finished;
        } else {
          return GamePhase.Active;
        }
      } else {
        return GamePhase.Lobby;
      }
    }

    const msSinceCreation = now - this.createdAt;
    const lessThanLifetime = msSinceCreation < this.config.gameCreationRate();
    const notEnoughPlayers =
      this.gameConfig.gameType === GameType.Public &&
      this.gameConfig.maxPlayers &&
      this.activeClients.length < this.gameConfig.maxPlayers;
    if (lessThanLifetime && notEnoughPlayers) {
      return GamePhase.Lobby;
    }
    const warmupOver =
      now > this.createdAt + this.config.gameCreationRate() + 30 * 1000;
    if (noActive && warmupOver && noRecentPings) {
      return GamePhase.Finished;
    }

    return GamePhase.Active;
  }

  hasStarted(): boolean {
    return this._hasStarted || this._hasPrestarted;
  }

  public gameInfo(): GameInfo {
    return {
      gameID: this.id,
      clients: this.activeClients.map((c) => ({
        username: c.username,
        clientID: c.clientID,
      })),
      gameConfig: this.gameConfig,
      msUntilStart: this.isPublic()
        ? this.createdAt + this.config.gameCreationRate()
        : undefined,
    };
  }

  public isPublic(): boolean {
    return this.gameConfig.gameType === GameType.Public;
  }

  public kickClient(clientID: ClientID): void {
    if (this.kickedClients.has(clientID)) {
      this.log.warn(`cannot kick client, already kicked`, {
        clientID,
      });
      return;
    }
    const client = this.activeClients.find((c) => c.clientID === clientID);
    if (client) {
      this.log.info("Kicking client from game", {
        clientID: client.clientID,
        persistentID: client.persistentID,
      });
      client.ws.send(
        JSON.stringify({
          type: "error",
          error: "Kicked from game (you may have been playing on another tab)",
        } satisfies ServerErrorMessage),
      );
      // Add a small delay before closing the connection to ensure the error message is received
      setTimeout(() => {
        client.ws.close(1000, "Kicked from game");
        this.activeClients = this.activeClients.filter(
          (c) => c.clientID !== clientID,
        );
        this.kickedClients.add(clientID);
      }, 100);
    } else {
      this.log.warn(`cannot kick client, not found in game`, {
        clientID,
      });
    }
  }

  private checkDisconnectedStatus() {
    if (this.turns.length % 5 !== 0) {
      return;
    }

    const now = Date.now();
    for (const [clientID, client] of this.allClients) {
      if (
        client.isDisconnected === false &&
        now - client.lastPing > this.disconnectedTimeout
      ) {
        this.markClientDisconnected(client, true);
      } else if (
        client.isDisconnected &&
        now - client.lastPing < this.disconnectedTimeout
      ) {
        this.markClientDisconnected(client, false);
      }
    }
  }

  private markClientDisconnected(client: Client, isDisconnected: boolean) {
    client.isDisconnected = isDisconnected;
    this.addIntent({
      type: "mark_disconnected",
      clientID: client.clientID,
      isDisconnected: isDisconnected,
    });
  }

  private archiveGame() {
    this.log.info("archiving game", {
      gameID: this.id,
      winner: this.winner?.winner,
    });

    // Players must stay in the same order as the game start info.
    const playerRecords: PlayerRecord[] = this.gameStartInfo.players.map(
      (player) => {
        const stats = this.winner?.allPlayersStats[player.clientID];
        if (stats === undefined) {
          this.log.warn(`Unable to find stats for clientID ${player.clientID}`);
        }
        return {
          clientID: player.clientID,
          username: player.username,
          persistentID:
            this.allClients.get(player.clientID)?.persistentID ?? "",
          stats,
        } satisfies PlayerRecord;
      },
    );
    archive(
      createGameRecord(
        this.id,
        this.gameStartInfo.config,
        playerRecords,
        this.turns,
        this._startTime ?? 0,
        Date.now(),
        this.winner?.winner,
        this.config,
      ),
    );
  }

  private handleSynchronization() {
    if (this.activeClients.length <= 1) {
      return;
    }
    if (this.turns.length % 10 !== 0 || this.turns.length < 10) {
      // Check hashes every 10 turns
      return;
    }

    const lastHashTurn = this.turns.length - 10;

    const { mostCommonHash, outOfSyncClients } =
      this.findOutOfSyncClients(lastHashTurn);

    if (outOfSyncClients.length === 0) {
      this.turns[lastHashTurn].hash = mostCommonHash;
      return;
    }

    const serverDesync = ServerDesyncSchema.safeParse({
      type: "desync",
      turn: lastHashTurn,
      correctHash: mostCommonHash,
      clientsWithCorrectHash:
        this.activeClients.length - outOfSyncClients.length,
      totalActiveClients: this.activeClients.length,
    });
    if (!serverDesync.success) {
      this.log.warn("failed to create desync message", {
        gameID: this.id,
        error: serverDesync.error,
      });
      return;
    }

    const desyncMsg = JSON.stringify(serverDesync.data);
    for (const c of outOfSyncClients) {
      this.outOfSyncClients.add(c.clientID);
      if (this.sentDesyncMessageClients.has(c.clientID)) {
        continue;
      }
      this.sentDesyncMessageClients.add(c.clientID);
      this.log.info("sending desync to client", {
        gameID: this.id,
        clientID: c.clientID,
        persistentID: c.persistentID,
      });
      c.ws.send(desyncMsg);
    }
  }

  findOutOfSyncClients(turnNumber: number): {
    mostCommonHash: number | null;
    outOfSyncClients: Client[];
  } {
    const counts = new Map<number, number>();

    // Count occurrences of each hash
    for (const client of this.activeClients) {
      if (client.hashes.has(turnNumber)) {
        const clientHash = client.hashes.get(turnNumber)!;
        counts.set(clientHash, (counts.get(clientHash) ?? 0) + 1);
      }
    }

    // Find the most common hash
    let mostCommonHash: number | null = null;
    let maxCount = 0;

    for (const [hash, count] of counts.entries()) {
      if (count > maxCount) {
        mostCommonHash = hash;
        maxCount = count;
      }
    }

    // Create a list of clients whose hash doesn't match the most common one
    let outOfSyncClients: Client[] = [];

    for (const client of this.activeClients) {
      if (client.hashes.has(turnNumber)) {
        const clientHash = client.hashes.get(turnNumber)!;
        if (clientHash !== mostCommonHash) {
          outOfSyncClients.push(client);
        }
      }
    }

    // If half clients out of sync assume all are out of sync.
    if (outOfSyncClients.length >= Math.floor(this.activeClients.length / 2)) {
      outOfSyncClients = this.activeClients;
    }

    return {
      mostCommonHash,
      outOfSyncClients,
    };
  }
}
