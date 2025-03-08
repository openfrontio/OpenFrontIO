import { RateLimiterMemory } from "rate-limiter-flexible";
import WebSocket from "ws";
import {
  AllPlayersStats,
  ClientID,
  ClientMessage,
  ClientMessageSchema,
  GameConfig,
  GameInfo,
  Intent,
  PlayerRecord,
  ServerDesyncSchema,
  ServerStartGameMessageSchema,
  ServerTurnMessageSchema,
  Turn,
} from "../core/Schemas";
import { CreateGameRecord } from "../core/Util";
import { ServerConfig } from "../core/configuration/Config";
import { GameType } from "../core/game/Game";
import { archive } from "./Archive";
import { Client } from "./Client";
import { slog } from "./StructuredLog";
import { gatekeeper } from "./Gatekeeper";

export enum GamePhase {
  Lobby = "LOBBY",
  Active = "ACTIVE",
  Finished = "FINISHED",
}

export class GameServer {
  private outOfSyncClients = new Set<ClientID>();

  private maxGameDuration = 3 * 60 * 60 * 1000; // 3 hours

  private turns: Turn[] = [];
  private intents: Intent[] = [];
  public activeClients: Client[] = [];
  // Used for record record keeping
  private allClients: Map<ClientID, Client> = new Map();
  private _hasStarted = false;
  private _startTime: number = null;

  private endTurnIntervalID;

  private lastPingUpdate = 0;

  private winner: ClientID | null = null;
  // This field is currently only filled at victory
  private allPlayersStats: AllPlayersStats = {};

  constructor(
    public readonly id: string,
    public readonly createdAt: number,
    public readonly highTraffic: boolean,
    private config: ServerConfig,
    public gameConfig: GameConfig,
  ) {}

  public updateGameConfig(gameConfig: GameConfig): void {
    if (gameConfig.gameMap != null) {
      this.gameConfig.gameMap = gameConfig.gameMap;
    }
    if (gameConfig.difficulty != null) {
      this.gameConfig.difficulty = gameConfig.difficulty;
    }
    if (gameConfig.disableNPCs != null) {
      this.gameConfig.disableNPCs = gameConfig.disableNPCs;
    }
    if (gameConfig.bots != null) {
      this.gameConfig.bots = gameConfig.bots;
    }
    if (gameConfig.infiniteGold != null) {
      this.gameConfig.infiniteGold = gameConfig.infiniteGold;
    }
    if (gameConfig.infiniteTroops != null) {
      this.gameConfig.infiniteTroops = gameConfig.infiniteTroops;
    }
    if (gameConfig.instantBuild != null) {
      this.gameConfig.instantBuild = gameConfig.instantBuild;
    }
  }

  public addClient(client: Client, lastTurn: number) {
    console.log(`${this.id}: adding client ${client.clientID}`);
    slog({
      logKey: "client_joined_game",
      msg: `client ${client.clientID} (re)joining game ${this.id}`,
      data: {
        clientID: client.clientID,
        clientIP: client.ip,
        gameID: this.id,
        isRejoin: lastTurn > 0,
      },
      clientID: client.clientID,
      persistentID: client.persistentID,
      gameID: this.id,
    });

    if (
      this.gameConfig.gameType == GameType.Public &&
      this.activeClients.filter(
        (c) => c.ip == client.ip && c.clientID != client.clientID,
      ).length >= 3
    ) {
      console.log(
        `cannot add client ${client.clientID}, already have 3 ips (${client.ip})`,
      );
      return;
    }

    // Remove stale client if this is a reconnect
    const existing = this.activeClients.find(
      (c) => c.clientID == client.clientID,
    );
    if (existing != null) {
      existing.ws.removeAllListeners("message");
    }
    this.activeClients = this.activeClients.filter(
      (c) => c.clientID != client.clientID,
    );
    this.activeClients.push(client);
    client.lastPing = Date.now();

    this.allClients.set(client.clientID, client);

    client.ws.on(
      "message",
      gatekeeper.wsHandler(client.ip, async (message: string) => {
        try {
          let clientMsg: ClientMessage = null;
          try {
            clientMsg = ClientMessageSchema.parse(JSON.parse(message));
          } catch (error) {
            throw Error(`error parsing schema for ${client.ip}`);
          }
          if (this.allClients.has(clientMsg.clientID)) {
            const client = this.allClients.get(clientMsg.clientID);
            if (client.persistentID != clientMsg.persistentID) {
              console.warn(
                `Client ID ${clientMsg.clientID} sent incorrect id ${clientMsg.persistentID}, does not match persistent id ${client.persistentID}`,
              );
              return;
            }
          }

          // Clear out persistent id to make sure it doesn't get sent to other clients.
          clientMsg.persistentID = null;

          if (clientMsg.type == "intent") {
            if (clientMsg.gameID == this.id) {
              this.addIntent(clientMsg.intent);
            } else {
              console.warn(
                `${this.id}: client ${clientMsg.clientID} sent to wrong game`,
              );
            }
          }
          if (clientMsg.type == "ping") {
            this.lastPingUpdate = Date.now();
            client.lastPing = Date.now();
          }
          if (clientMsg.type == "hash") {
            client.hashes.set(clientMsg.tick, clientMsg.hash);
          }
          if (clientMsg.type == "winner") {
            this.winner = clientMsg.winner;
            this.allPlayersStats = clientMsg.allPlayersStats;
          }
        } catch (error) {
          console.log(
            `error handline websocket request in game server: ${error}`,
          );
        }
      }),
    );
    client.ws.on("close", () => {
      console.log(`${this.id}: client ${client.clientID} disconnected`);
      this.activeClients = this.activeClients.filter(
        (c) => c.clientID != client.clientID,
      );
    });
    client.ws.on("error", (error: Error) => {
      if ((error as any).code === "WS_ERR_UNEXPECTED_RSV_1") {
        client.ws.close(1002);
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
    if (this._startTime > 0) {
      return this._startTime;
    } else {
      //game hasn't started yet, only works for public games
      return this.createdAt + this.config.lobbyLifetime(this.highTraffic);
    }
  }

  public start() {
    this._hasStarted = true;
    this._startTime = Date.now();
    // Set last ping to start so we don't immediately stop the game
    // if no client connects/pings.
    this.lastPingUpdate = Date.now();

    this.endTurnIntervalID = setInterval(
      () => this.endTurn(),
      this.config.turnIntervalMs(),
    );
    this.activeClients.forEach((c) => {
      console.log(`${this.id}: sending start message to ${c.clientID}`);
      this.sendStartGameMsg(c.ws, 0);
    });
  }

  private addIntent(intent: Intent) {
    this.intents.push(intent);
  }

  private sendStartGameMsg(ws: WebSocket, lastTurn: number) {
    try {
      ws.send(
        JSON.stringify(
          ServerStartGameMessageSchema.parse({
            type: "start",
            turns: this.turns.slice(lastTurn),
            config: this.gameConfig,
          }),
        ),
      );
    } catch (error) {
      throw new Error(`error sending start message for game ${this.id}`);
    }
  }

  private endTurn() {
    const pastTurn: Turn = {
      turnNumber: this.turns.length,
      gameID: this.id,
      intents: this.intents,
    };
    this.turns.push(pastTurn);
    this.intents = [];

    this.maybeSendDesync();

    let msg = "";
    try {
      msg = JSON.stringify(
        ServerTurnMessageSchema.parse({
          type: "turn",
          turn: pastTurn,
        }),
      );
    } catch (error) {
      console.log(`error sending message for game ${this.id}`);
      return;
    }

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
    console.log(
      `${this.id}: ending game ${this.id} with ${this.turns.length} turns`,
    );
    try {
      if (this.allClients.size > 0) {
        const playerRecords: PlayerRecord[] = Array.from(
          this.allClients.values(),
        ).map((client) => ({
          ip: client.ip,
          clientID: client.clientID,
          username: client.username,
          persistentID: client.persistentID,
        }));
        archive(
          CreateGameRecord(
            this.id,
            this.gameConfig,
            playerRecords,
            this.turns,
            this._startTime,
            Date.now(),
            this.winner,
            this.allPlayersStats,
          ),
        );
      } else {
        console.log(`${this.id}: no clients joined, not archiving game`);
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

      console.error("Error archiving game record details:", {
        gameId: this.id,
        errorType: typeof error,
        error: errorDetails,
      });
    }
  }

  phase(): GamePhase {
    const now = Date.now();
    const alive = [];
    for (const client of this.activeClients) {
      if (now - client.lastPing > 60_000) {
        console.log(
          `${this.id}: no pings from ${client.clientID}, terminating connection`,
        );
        if (client.ws.readyState === WebSocket.OPEN) {
          client.ws.close(1000, "no heartbeats received, closing connection");
        }
      } else {
        alive.push(client);
      }
    }
    this.activeClients = alive;
    if (now > this.createdAt + this.maxGameDuration) {
      console.warn(`${this.id}: game past max duration ${this.id}`);
      return GamePhase.Finished;
    }

    const noRecentPings = now > this.lastPingUpdate + 20 * 1000;
    const noActive = this.activeClients.length == 0;

    if (this.gameConfig.gameType != GameType.Public) {
      if (this._hasStarted) {
        if (noActive && noRecentPings) {
          console.log(`${this.id}: private game: ${this.id} complete`);
          return GamePhase.Finished;
        } else {
          return GamePhase.Active;
        }
      } else {
        return GamePhase.Lobby;
      }
    }

    if (now - this.createdAt < this.config.lobbyLifetime(this.highTraffic)) {
      return GamePhase.Lobby;
    }
    const warmupOver =
      now >
      this.createdAt + this.config.lobbyLifetime(this.highTraffic) + 30 * 1000;
    if (noActive && warmupOver && noRecentPings) {
      return GamePhase.Finished;
    }

    return GamePhase.Active;
  }

  hasStarted(): boolean {
    return this._hasStarted;
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
        ? this.createdAt + this.config.lobbyLifetime(this.highTraffic)
        : undefined,
    };
  }

  public isPublic(): boolean {
    return this.gameConfig.gameType == GameType.Public;
  }

  private maybeSendDesync() {
    if (this.activeClients.length <= 1) {
      return;
    }
    if (this.turns.length % 10 == 0 && this.turns.length != 0) {
      const lastHashTurn = this.turns.length - 10;

      let { mostCommonHash, outOfSyncClients } =
        this.findOutOfSyncClients(lastHashTurn);

      if (
        outOfSyncClients.length >= Math.floor(this.activeClients.length / 2)
      ) {
        // If half clients out of sync assume all are out of sync.
        outOfSyncClients = this.activeClients;
      }

      for (const oos of outOfSyncClients) {
        if (!this.outOfSyncClients.has(oos.clientID)) {
          console.warn(
            `Game ${this.id}: has out of sync client ${oos.clientID} on turn ${lastHashTurn}`,
          );
          this.outOfSyncClients.add(oos.clientID);
        }
      }
      return;
      // TODO: renable this once desync issue fixed

      const serverDesync = ServerDesyncSchema.safeParse({
        type: "desync",
        turn: lastHashTurn,
        correctHash: mostCommonHash,
        clientsWithCorrectHash:
          this.activeClients.length - outOfSyncClients.length,
        totalActiveClients: this.activeClients.length,
      });
      if (serverDesync.success) {
        const desyncMsg = JSON.stringify(serverDesync.data);
        for (const c of outOfSyncClients) {
          console.log(
            `game: ${this.id}: sending desync to client ${c.clientID}`,
          );
          c.ws.send(desyncMsg);
        }
      } else {
        console.warn(`failed to create desync message ${serverDesync.error}`);
      }
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
        counts.set(clientHash, (counts.get(clientHash) || 0) + 1);
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
    const outOfSyncClients: Client[] = [];

    for (const client of this.activeClients) {
      if (client.hashes.has(turnNumber)) {
        const clientHash = client.hashes.get(turnNumber)!;
        if (clientHash !== mostCommonHash) {
          outOfSyncClients.push(client);
        }
      }
    }

    return {
      mostCommonHash,
      outOfSyncClients,
    };
  }
}
