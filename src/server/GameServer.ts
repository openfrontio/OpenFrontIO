import ipAnonymize from "ip-anonymize";
import { Logger } from "winston";
import WebSocket from "ws";
import { z } from "zod";
import { GameEnv, ServerConfig } from "../core/configuration/Config";
import { GameType } from "../core/game/Game";
import {
  ClientID,
  ClientMessageSchema,
  ClientRejoinMessage,
  ClientSendWinnerMessage,
  GameConfig,
  GameInfo,
  GameMapSize,
  GameStartInfo,
  GameStartInfoSchema,
  Intent,
  PlayerRecord,
  ServerDesyncSchema,
  ServerErrorMessage,
  ServerLobbyInfoMessage,
  ServerPrestartMessageSchema,
  ServerStartGameMessage,
  Turn,
} from "../core/Schemas";
import { createPartialGameRecord, getClanTag } from "../core/Util";
import { archive, finalizeGameRecord } from "./Archive";
import { Client } from "./Client";
import { ClientGrid } from "./ClientGrid";
import { getMapManifest } from "./MapLandTiles";
export enum GamePhase {
  Lobby = "LOBBY",
  Active = "ACTIVE",
  Finished = "FINISHED",
}

const KICK_REASON_DUPLICATE_SESSION = "kick_reason.duplicate_session";
const KICK_REASON_LOBBY_CREATOR = "kick_reason.lobby_creator";

export class GameServer {
  private sentDesyncMessageClients = new Set<ClientID>();

  private maxGameDuration = 3 * 60 * 60 * 1000; // 3 hours

  private disconnectedTimeout = 1 * 30 * 1000; // 30 seconds

  private turnsAsJSON: string[] = []; // Objects stored as JSON strings to save memory
  // private turns: Turn[] = []; // Removed to save memory
  private intents: Intent[] = [];
  public activeClients: Client[] = [];
  private allClients: Map<ClientID, Client> = new Map();
  private clientsDisconnectedStatus: Map<ClientID, boolean> = new Map();
  private _hasStarted = false;
  private _startTime: number | null = null;

  private endTurnIntervalID: ReturnType<typeof setInterval> | undefined;

  private lastPingUpdate = 0;

  private winner: ClientSendWinnerMessage | null = null;

  // Note: This can be undefined if accessed before the game starts.
  private gameStartInfo!: GameStartInfo;

  private log: Logger;

  private _hasPrestarted = false;

  private kickedClients: Set<ClientID> = new Set();
  private outOfSyncClients: Set<ClientID> = new Set();

  private isPaused = false;

  private websockets: Set<WebSocket> = new Set();

  private winnerVotes: Map<
    string,
    { winner: ClientSendWinnerMessage; ips: Set<string> }
  > = new Map();

  private _hasEnded = false;

  public desyncCount = 0;

  private lobbyInfoIntervalId: ReturnType<typeof setInterval> | null = null;
  private clientGrid: ClientGrid | undefined;

  constructor(
    public readonly id: string,
    readonly log_: Logger,
    public readonly createdAt: number,
    private config: ServerConfig,
    public gameConfig: GameConfig,
    private lobbyCreatorID?: string,
    private startsAt?: number,
  ) {
    this.log = log_.child({ gameID: id });
  }

  public updateGameConfig(gameConfig: Partial<GameConfig>): void {
    if (gameConfig.gameMap !== undefined) {
      this.gameConfig.gameMap = gameConfig.gameMap;
    }
    if (gameConfig.gameMapSize !== undefined) {
      this.gameConfig.gameMapSize = gameConfig.gameMapSize;
    }
    if (gameConfig.difficulty !== undefined) {
      this.gameConfig.difficulty = gameConfig.difficulty;
    }
    if (gameConfig.disableNations !== undefined) {
      this.gameConfig.disableNations = gameConfig.disableNations;
    }
    if (gameConfig.bots !== undefined) {
      this.gameConfig.bots = gameConfig.bots;
    }
    if (gameConfig.infiniteGold !== undefined) {
      this.gameConfig.infiniteGold = gameConfig.infiniteGold;
    }
    if (gameConfig.donateGold !== undefined) {
      this.gameConfig.donateGold = gameConfig.donateGold;
    }
    if (gameConfig.infiniteTroops !== undefined) {
      this.gameConfig.infiniteTroops = gameConfig.infiniteTroops;
    }
    if (gameConfig.donateTroops !== undefined) {
      this.gameConfig.donateTroops = gameConfig.donateTroops;
    }
    if (gameConfig.maxTimerValue !== undefined) {
      this.gameConfig.maxTimerValue = gameConfig.maxTimerValue;
    }
    if (gameConfig.instantBuild !== undefined) {
      this.gameConfig.instantBuild = gameConfig.instantBuild;
    }
    if (gameConfig.randomSpawn !== undefined) {
      this.gameConfig.randomSpawn = gameConfig.randomSpawn;
    }
    if (gameConfig.spawnImmunityDuration !== undefined) {
      this.gameConfig.spawnImmunityDuration = gameConfig.spawnImmunityDuration;
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
    if (gameConfig.goldMultiplier !== undefined) {
      this.gameConfig.goldMultiplier = gameConfig.goldMultiplier;
    }
    if (gameConfig.startingGold !== undefined) {
      this.gameConfig.startingGold = gameConfig.startingGold;
    }
  }

  public joinClient(client: Client) {
    this.websockets.add(client.ws);
    if (this.kickedClients.has(client.clientID)) {
      this.log.warn(`cannot add client, already kicked`, {
        clientID: client.clientID,
      });
      return;
    }

    if (this.allClients.has(client.clientID)) {
      this.log.warn("cannot add client, already in game", {
        clientID: client.clientID,
      });
      return;
    }

    if (
      this.gameConfig.maxPlayers &&
      this.activeClients.length >= this.gameConfig.maxPlayers
    ) {
      this.log.warn(`cannot add client, game full`, {
        clientID: client.clientID,
      });

      client.ws.send(
        JSON.stringify({
          type: "error",
          error: "full-lobby",
        } satisfies ServerErrorMessage),
      );
      return;
    }

    // Log when lobby creator joins private game
    if (client.clientID === this.lobbyCreatorID) {
      this.log.info("Lobby creator joined", {
        gameID: this.id,
        creatorID: this.lobbyCreatorID,
      });
    }
    this.log.info("client joining game", {
      clientID: client.clientID,
      persistentID: client.persistentID,
      clientIP: ipAnonymize(client.ip),
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
        this.kickClient(conflicting.clientID, KICK_REASON_DUPLICATE_SESSION);
      }
    }

    // Client connection accepted
    this.activeClients.push(client);
    client.lastPing = Date.now();
    this.markClientDisconnected(client.clientID, false);
    this.allClients.set(client.clientID, client);
    this.addListeners(client);
    this.startLobbyInfoBroadcast();

    // In case a client joined the game late and missed the start message.
    if (this._hasStarted) {
      this.sendStartGameMsg(client, 0);
    }
  }

  public rejoinClient(
    ws: WebSocket,
    persistentID: string,
    msg: ClientRejoinMessage,
  ): void {
    this.websockets.add(ws);

    if (this.kickedClients.has(msg.clientID)) {
      this.log.warn("cannot rejoin client, client has been kicked", {
        clientID: msg.clientID,
      });
      return;
    }

    const client = this.allClients.get(msg.clientID);
    if (!client) {
      this.log.warn("cannot rejoin client, existing client not found", {
        clientID: msg.clientID,
      });
      return;
    }

    if (client.persistentID !== persistentID) {
      this.log.error("persistent ids do not match", {
        clientID: msg.clientID,
        clientPersistentID: persistentID,
        existingIP: ipAnonymize(client.ip),
        existingPersistentID: client.persistentID,
      });
      return;
    }

    this.activeClients = this.activeClients.filter(
      (c) => c.clientID !== msg.clientID,
    );
    this.activeClients.push(client);
    client.lastPing = Date.now();
    this.markClientDisconnected(msg.clientID, false);

    client.ws = ws;
    this.addListeners(client);
    this.startLobbyInfoBroadcast();

    if (this._hasStarted) {
      this.sendStartGameMsg(client, msg.lastTurn);
    }
  }

  private addListeners(client: Client) {
    client.ws.removeAllListeners("message");
    client.ws.on("message", async (message: string) => {
      try {
        // Fast-path: avoid Zod parsing for high-frequency messages (intent, ping, hash)
        // We use a safe cast or raw access.
        const raw = JSON.parse(message);
        let clientMsg: any = raw;

        if (
          raw.type !== "intent" &&
          raw.type !== "ping" &&
          raw.type !== "hash" &&
          raw.type !== "update_view"
        ) {
          const parsed = ClientMessageSchema.safeParse(raw);
          if (!parsed.success) {
            const error = z.prettifyError(parsed.error);
            this.log.warn(`Failed to parse client message ${error}`, {
              clientID: client.clientID,
            });
            client.ws.send(
              JSON.stringify({
                type: "error",
                error,
                message: `Server could not parse message from client: ${message}`,
              } satisfies ServerErrorMessage),
            );
            return;
          }
          clientMsg = parsed.data;
        }
        // For cached types, we proceed with 'raw' as 'clientMsg'.
        // This assumes 'raw' matches the schema.
        // If it doesn't, we might get runtime errors in the switch case,
        // but since we wrap in try-catch (line 298), it's safe.
        switch (clientMsg.type) {
          case "rejoin": {
            // Client is already connected, no auth required, send start game message if game has started
            if (this._hasStarted) {
              this.sendStartGameMsg(client, clientMsg.lastTurn);
            }
            break;
          }
          case "intent": {
            if (clientMsg.intent.clientID !== client.clientID) {
              this.log.warn(
                `client id mismatch, client: ${client.clientID}, intent: ${clientMsg.intent.clientID}`,
              );
              return;
            }
            switch (clientMsg.intent.type) {
              case "mark_disconnected": {
                this.log.warn(
                  `Should not receive mark_disconnected intent from client`,
                );
                return;
              }

              // Handle kick_player intent via WebSocket
              case "kick_player": {
                // Check if the authenticated client is the lobby creator
                if (client.clientID !== this.lobbyCreatorID) {
                  this.log.warn(`Only lobby creator can kick players`, {
                    clientID: client.clientID,
                    creatorID: this.lobbyCreatorID,
                    target: clientMsg.intent.target,
                    gameID: this.id,
                  });
                  return;
                }

                // Don't allow lobby creator to kick themselves
                if (client.clientID === clientMsg.intent.target) {
                  this.log.warn(`Cannot kick yourself`, {
                    clientID: client.clientID,
                  });
                  return;
                }

                // Log and execute the kick
                this.log.info(`Lobby creator initiated kick of player`, {
                  creatorID: client.clientID,
                  target: clientMsg.intent.target,
                  gameID: this.id,
                  kickMethod: "websocket",
                });

                this.kickClient(
                  clientMsg.intent.target,
                  KICK_REASON_LOBBY_CREATOR,
                );
                return;
              }
              case "update_game_config": {
                // Only lobby creator can update config
                if (client.clientID !== this.lobbyCreatorID) {
                  this.log.warn(`Only lobby creator can update game config`, {
                    clientID: client.clientID,
                    creatorID: this.lobbyCreatorID,
                    gameID: this.id,
                  });
                  return;
                }

                if (this.isPublic()) {
                  this.log.warn(`Cannot update public game via WebSocket`, {
                    gameID: this.id,
                    clientID: client.clientID,
                  });
                  return;
                }

                if (this.hasStarted()) {
                  this.log.warn(
                    `Cannot update game config after it has started`,
                    {
                      gameID: this.id,
                      clientID: client.clientID,
                    },
                  );
                  return;
                }

                if (clientMsg.intent.config.gameType === GameType.Public) {
                  this.log.warn(`Cannot update game to public via WebSocket`, {
                    gameID: this.id,
                    clientID: client.clientID,
                  });
                  return;
                }

                this.log.info(
                  `Lobby creator updated game config via WebSocket`,
                  {
                    creatorID: client.clientID,
                    gameID: this.id,
                  },
                );

                this.updateGameConfig(clientMsg.intent.config);
                return;
              }
              case "toggle_pause": {
                // Only lobby creator can pause/resume
                if (client.clientID !== this.lobbyCreatorID) {
                  this.log.warn(`Only lobby creator can toggle pause`, {
                    clientID: client.clientID,
                    creatorID: this.lobbyCreatorID,
                    gameID: this.id,
                  });
                  return;
                }

                if (clientMsg.intent.paused) {
                  // Pausing: send intent and complete current turn before pause takes effect
                  this.addIntent(clientMsg.intent);
                  this.endTurn();
                  this.isPaused = true;
                } else {
                  // Unpausing: clear pause flag before sending intent so next turn can execute
                  this.isPaused = false;
                  this.addIntent(clientMsg.intent);
                  this.endTurn();
                }

                this.log.info(`Game ${this.isPaused ? "paused" : "resumed"}`, {
                  clientID: client.clientID,
                  gameID: this.id,
                });
                break;
              }
              default: {
                // Don't process intents while game is paused
                if (!this.isPaused) {
                  this.addIntent(clientMsg.intent);
                }
                break;
              }
            }
            break;
          }
          case "ping": {
            this.lastPingUpdate = Date.now();
            client.lastPing = Date.now();
            break;
          }
          case "hash": {
            client.hashes.set(clientMsg.turnNumber, clientMsg.hash);
            break;
          }
          case "winner": {
            this.handleWinner(client, clientMsg);
            break;
          }
          default: {
            this.log.warn(`Unknown message type: ${(clientMsg as any).type}`, {
              clientID: client.clientID,
            });
            break;
          }
        }
      } catch (error) {
        this.log.info(
          `error handline websocket request in game server: ${error}`,
          {
            clientID: client.clientID,
          },
        );
      }
    });
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
  }

  public numClients(): number {
    return this.activeClients.length;
  }

  public prestart() {
    if (this.hasStarted()) {
      return;
    }
    this._hasPrestarted = true;

    const prestartMsg = ServerPrestartMessageSchema.safeParse({
      type: "prestart",
      gameMap: this.gameConfig.gameMap,
      gameMapSize: this.gameConfig.gameMapSize,
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

  private startLobbyInfoBroadcast() {
    if (this._hasStarted || this._hasEnded) {
      return;
    }
    if (this.lobbyInfoIntervalId !== null) {
      return;
    }
    this.broadcastLobbyInfo();
    this.lobbyInfoIntervalId = setInterval(() => {
      if (
        this._hasStarted ||
        this._hasEnded ||
        this.activeClients.length === 0
      ) {
        this.stopLobbyInfoBroadcast();
        return;
      }
      this.broadcastLobbyInfo();
    }, 1000);
  }

  private stopLobbyInfoBroadcast() {
    if (this.lobbyInfoIntervalId === null) {
      return;
    }
    clearInterval(this.lobbyInfoIntervalId);
    this.lobbyInfoIntervalId = null;
  }

  private broadcastLobbyInfo() {
    const msg = JSON.stringify({
      type: "lobby_info",
      lobby: this.gameInfo(),
    } satisfies ServerLobbyInfoMessage);
    this.activeClients.forEach((c) => {
      if (c.ws.readyState === WebSocket.OPEN) {
        c.ws.send(msg);
      }
    });
  }

  private async initClientGrid() {
    const manifest = await getMapManifest(this.gameConfig.gameMap);
    if (!manifest) {
      this.log.error("Failed to load map manifest for ClientGrid");
      return;
    }
    // Handle compact/normal size logic if needed.
    // TerrainMapLoader logic:
    // Normal: uses manifest.map
    // Compact: uses manifest.map4x (which is smaller resolution, but covers same area? No, compact is smaller map)
    // Wait, compact map is literally smaller.
    // If mapSize is Compact, we should use map4x dimensions?
    // Let's check TerrainMapLoader again.
    // loadTerrainMap: if Normal -> manifest.map. if Compact -> manifest.map4x.
    // Yes.

    let width = manifest.map.width;
    let height = manifest.map.height;

    if (this.gameConfig.gameMapSize === GameMapSize.Compact) {
      width = manifest.map4x.width;
      height = manifest.map4x.height;
    }
    this.clientGrid = new ClientGrid(width, height);
    this.log.info(`ClientGrid initialized with size ${width}x${height}`);
  }

  public start() {
    this.initClientGrid().catch((e) =>
      this.log.error("Failed to init ClientGrid", e),
    );

    if (this._hasStarted || this._hasEnded) {
      return;
    }
    this._hasStarted = true;
    this._startTime = Date.now();
    // Set last ping to start so we don't immediately stop the game
    // if no client connects/pings.
    this.lastPingUpdate = Date.now();

    const result = GameStartInfoSchema.safeParse({
      gameID: this.id,
      lobbyCreatedAt: this.createdAt,
      config: this.gameConfig,
      players: this.activeClients.map((c) => ({
        username: c.username,
        clientID: c.clientID,
        cosmetics: c.cosmetics,
        isLobbyCreator: this.lobbyCreatorID === c.clientID,
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
      this.sendStartGameMsg(c, 0);
    });
  }

  private addIntent(intent: Intent) {
    this.intents.push(intent);
  }

  private sendStartGameMsg(client: Client, lastTurn: number) {
    this.log.info(`Sending start message to client`, {
      clientID: client.clientID,
      lobbyCreatorID: this.lobbyCreatorID,
      isLobbyCreator: this.lobbyCreatorID === client.clientID,
    });

    try {
      client.ws.send(
        JSON.stringify({
          type: "start",
          turns: this.turnsAsJSON.slice(lastTurn).map((t) => JSON.parse(t)),
          gameStartInfo: this.gameStartInfo,
          lobbyCreatedAt: this.createdAt,
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
    // Skip turn execution if game is paused
    if (this.isPaused) {
      return;
    }

    const pastTurn: Turn = {
      turnNumber: this.turnsAsJSON.length,
      intents: this.intents,
    };

    // Optimize: Serialize once
    const turnJSON = JSON.stringify(pastTurn);
    this.turnsAsJSON.push(turnJSON);

    this.intents.length = 0;

    this.handleSynchronization();
    this.checkDisconnectedStatus();

    // Optimize: Construct message string manually to avoid extra object allocation/serialization
    // The schema is { type: "turn", turn: Turn }
    // We already have turn serialized as turnJSON.
    const msg = `{"type":"turn","turn":${turnJSON}}`;

    this.activeClients.forEach((c) => {
      c.ws.send(msg);
    });
  }

  async end() {
    this._hasEnded = true;
    // Close all WebSocket connections
    if (this.endTurnIntervalID) {
      clearInterval(this.endTurnIntervalID);
      this.endTurnIntervalID = undefined;
    }
    this.websockets.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close(1000, "game has ended");
      }
    });
    if (!this._hasPrestarted && !this._hasStarted) {
      this.log.info(`game not started, not archiving game`);
      return;
    }
    this.log.info(`ending game with ${this.turnsAsJSON.length} turns`);
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
    let writeIdx = 0;
    for (let i = 0; i < this.activeClients.length; i++) {
      const client = this.activeClients[i];
      if (now - client.lastPing > 60_000) {
        this.log.info("no pings received, terminating connection", {
          clientID: client.clientID,
          persistentID: client.persistentID,
        });
        if (client.ws.readyState === WebSocket.OPEN) {
          client.ws.close(1000, "no heartbeats received, closing connection");
        }
      } else {
        if (writeIdx !== i) {
          this.activeClients[writeIdx] = client;
        }
        writeIdx++;
      }
    }

    if (writeIdx < this.activeClients.length) {
      this.activeClients.length = writeIdx;
    }
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

    // Public Games

    const lessThanLifetime = Date.now() < this.startsAt!;
    const notEnoughPlayers =
      this.gameConfig.gameType === GameType.Public &&
      this.gameConfig.maxPlayers &&
      this.activeClients.length < this.gameConfig.maxPlayers;
    if (lessThanLifetime && notEnoughPlayers) {
      return GamePhase.Lobby;
    }
    const warmupOver = now > this.startsAt! + 30 * 1000;
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
      startsAt: this.startsAt,
      serverTime: Date.now(),
    };
  }

  public isPublic(): boolean {
    return this.gameConfig.gameType === GameType.Public;
  }

  public kickClient(
    clientID: ClientID,
    reasonKey: string = KICK_REASON_DUPLICATE_SESSION,
  ): void {
    if (this.kickedClients.has(clientID)) {
      this.log.warn(`cannot kick client, already kicked`, {
        clientID,
        reasonKey,
      });
      return;
    }

    if (!this.allClients.has(clientID)) {
      this.log.warn(`cannot kick client, not found in game`, {
        clientID,
        reasonKey,
      });
      return;
    }

    this.kickedClients.add(clientID);

    const client = this.activeClients.find((c) => c.clientID === clientID);
    if (client) {
      this.log.info("Kicking client from game", {
        clientID: client.clientID,
        persistentID: client.persistentID,
        reasonKey,
      });
      client.ws.send(
        JSON.stringify({
          type: "error",
          error: reasonKey,
        } satisfies ServerErrorMessage),
      );
      client.ws.close(1000, reasonKey);
      this.activeClients = this.activeClients.filter(
        (c) => c.clientID !== clientID,
      );
    } else {
      this.log.warn(`cannot kick client, not found in game`, {
        clientID,
        reasonKey,
      });
    }
  }

  private checkDisconnectedStatus() {
    if (this.turnsAsJSON.length % 5 !== 0) {
      return;
    }

    const now = Date.now();
    for (const [clientID, client] of this.allClients) {
      const isDisconnected = this.isClientDisconnected(clientID);
      if (!isDisconnected && now - client.lastPing > this.disconnectedTimeout) {
        this.markClientDisconnected(clientID, true);
      } else if (
        isDisconnected &&
        now - client.lastPing < this.disconnectedTimeout
      ) {
        this.markClientDisconnected(clientID, false);
      }
    }
  }

  public isClientDisconnected(clientID: string): boolean {
    return this.clientsDisconnectedStatus.get(clientID) ?? true;
  }

  private markClientDisconnected(clientID: string, isDisconnected: boolean) {
    this.clientsDisconnectedStatus.set(clientID, isDisconnected);
    this.addIntent({
      type: "mark_disconnected",
      clientID: clientID,
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
          cosmetics: player.cosmetics,
          clanTag: getClanTag(player.username) ?? undefined,
        } satisfies PlayerRecord;
      },
    );

    // Deserialize turns for archiving
    const turns: Turn[] = this.turnsAsJSON.map((t) => JSON.parse(t));

    archive(
      finalizeGameRecord(
        createPartialGameRecord(
          this.id,
          this.gameStartInfo.config,
          playerRecords,
          turns,
          this._startTime ?? 0,
          Date.now(),
          this.winner?.winner,
          this.createdAt,
        ),
      ),
    );
  }

  private handleSynchronization() {
    if (this.activeClients.length <= 1) {
      return;
    }
    if (this.turnsAsJSON.length % 10 !== 0 || this.turnsAsJSON.length < 10) {
      // Check hashes every 10 turns
      return;
    }

    // Optimization: Cleanup old hashes to prevent memory leak
    const cleanupThreshold = this.turnsAsJSON.length - 20;
    if (cleanupThreshold > 0) {
      for (const client of this.allClients.values()) {
        // Optimization: Delete specifically the old ones if we know the interval,
        // but iterating keys is safer for correctness.
        for (const t of client.hashes.keys()) {
          if (t < cleanupThreshold) {
            client.hashes.delete(t);
          }
        }
      }
    }

    const lastHashTurn = this.turnsAsJSON.length - 10;

    const { mostCommonHash, outOfSyncClients } =
      this.findOutOfSyncClients(lastHashTurn);

    this.desyncCount += outOfSyncClients.length;

    if (outOfSyncClients.length === 0) {
      // Update hash in the stored JSON
      try {
        const t: Turn = JSON.parse(this.turnsAsJSON[lastHashTurn]);
        t.hash = mostCommonHash;
        this.turnsAsJSON[lastHashTurn] = JSON.stringify(t);
      } catch (e) {
        this.log.error(
          `Failed to update hash in turnsAsJSON for turn ${lastHashTurn}`,
          e,
        );
      }
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

    // Update the stored serialized turn with the hash
    if (this.turnsAsJSON[lastHashTurn]) {
      try {
        const t: Turn = JSON.parse(this.turnsAsJSON[lastHashTurn]);
        t.hash = mostCommonHash;
        this.turnsAsJSON[lastHashTurn] = JSON.stringify(t);
      } catch (e) {
        this.log.error(`failed to update hash for turn ${lastHashTurn}: ${e}`);
      }
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
    // Use Boyer-Moore Voting Algorithm to find the majority hash with O(1) space
    let candidate: number | null = null;
    let count = 0;

    for (const client of this.activeClients) {
      if (client.hashes.has(turnNumber)) {
        const hash = client.hashes.get(turnNumber)!;
        if (count === 0) {
          candidate = hash;
          count = 1;
        } else if (hash === candidate) {
          count++;
        } else {
          count--;
        }
      }
    }

    // Verify candidate is actually the most common (or majority)
    // If count > 0, candidate is the likely majority.
    // If count == 0, we have no majority, but we can just picking the candidate implies nothing.
    // However, for game sync, we expect a strong majority.
    // We need to do a second pass to confirm count and find outOfSyncClients.

    const mostCommonHash: number | null = candidate;
    // If no candidate (no one sent hashes), standard logic applies.

    // If we have a candidate, verify it's actually common enough?
    // Actually we just need "most common". Boyer-Moore guarantees majority.
    // If no majority exists (e.g. 33% A, 33% B, 34% C), Boyer-Moore might return C.
    // That is acceptable as "most common".

    // Re-count to be sure and populate outOfSyncClients
    let outOfSyncClients: Client[] = [];

    // If nobody sent a hash yet
    if (mostCommonHash === null) {
      return { mostCommonHash: null, outOfSyncClients: [] };
    }

    // Verify pass
    // Also handling the edge case where candidate might not be the true most common if no majority exists,
    // but in a deterministic game, majority SHOULD exist.

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

  private handleWinner(client: Client, clientMsg: ClientSendWinnerMessage) {
    if (
      this.outOfSyncClients.has(client.clientID) ||
      this.kickedClients.has(client.clientID) ||
      this.winner !== null ||
      client.reportedWinner !== null
    ) {
      return;
    }
    client.reportedWinner = clientMsg.winner;

    // Add client vote
    const winnerKey = JSON.stringify(clientMsg.winner);
    if (!this.winnerVotes.has(winnerKey)) {
      this.winnerVotes.set(winnerKey, { ips: new Set(), winner: clientMsg });
    }
    const potentialWinner = this.winnerVotes.get(winnerKey)!;
    potentialWinner.ips.add(client.ip);

    const activeUniqueIPs = new Set(this.activeClients.map((c) => c.ip));

    const ratio = `${potentialWinner.ips.size}/${activeUniqueIPs.size}`;
    this.log.info(
      `received winner vote ${clientMsg.winner}, ${ratio} votes for this winner`,
      {
        clientID: client.clientID,
      },
    );

    if (potentialWinner.ips.size * 2 < activeUniqueIPs.size) {
      return;
    }

    // Vote succeeded
    this.winner = potentialWinner.winner;
    this.log.info(
      `Winner determined by ${potentialWinner.ips.size}/${activeUniqueIPs.size} active IPs`,
      {
        winnerKey: winnerKey,
      },
    );
    this.archiveGame();
  }
}
