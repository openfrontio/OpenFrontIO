import { Config, GameEnv, ServerConfig } from "../core/configuration/Config";
import { consolex } from "../core/Consolex";
import { GameEvent } from "../core/EventBus";
import {
  AllPlayersStats,
  ClientID,
  ClientMessage,
  ClientMessageSchema,
  ClientSendWinnerMessage,
  GameConfig,
  GameID,
  GameRecordSchema,
  Intent,
  PlayerRecord,
  ServerMessage,
  ServerStartGameMessageSchema,
  ServerTurnMessageSchema,
  Turn,
} from "../core/Schemas";
import {
  createGameRecord,
  decompressGameRecord,
  generateID,
} from "../core/Util";
import { LobbyConfig } from "./ClientGameRunner";
import { getPersistentIDFromCookie } from "./Main";

export class LocalServer {
  private turns: Turn[] = [];
  private intents: Intent[] = [];
  private startedAt: number;

  private endTurnIntervalID;

  private paused = false;

  private winner: ClientSendWinnerMessage = null;
  private allPlayersStats: AllPlayersStats = {};

  constructor(
    private lobbyConfig: LobbyConfig,
    private clientConnect: () => void,
    private clientMessage: (message: ServerMessage) => void,
  ) {}

  start() {
    this.startedAt = Date.now();
    if (!this.lobbyConfig.gameRecord) {
      this.endTurnIntervalID = setInterval(
        () => this.endTurn(),
        this.lobbyConfig.serverConfig.turnIntervalMs(),
      );
    }
    this.clientConnect();
    if (this.lobbyConfig.gameRecord) {
      this.turns = decompressGameRecord(this.lobbyConfig.gameRecord).turns;
      console.log(`loaded turns: ${JSON.stringify(this.turns)}`);
    }
    this.clientMessage(
      ServerStartGameMessageSchema.parse({
        type: "start",
        config: this.lobbyConfig.gameConfig,
        turns: this.turns,
      }),
    );
  }

  pause() {
    this.paused = true;
  }

  resume() {
    this.paused = false;
  }

  onMessage(message: string) {
    const clientMsg: ClientMessage = ClientMessageSchema.parse(
      JSON.parse(message),
    );
    if (clientMsg.type == "intent") {
      if (this.lobbyConfig.gameRecord) {
        // If we are replaying a game, we don't want to process intents
        return;
      }
      if (this.paused) {
        if (clientMsg.intent.type == "troop_ratio") {
          // Store troop change events because otherwise they are
          // not registered when game is paused.
          this.intents.push(clientMsg.intent);
        }
        return;
      }
      this.intents.push(clientMsg.intent);
    }
    if (clientMsg.type == "hash") {
      if (!this.lobbyConfig.gameRecord) {
        // If we are playing a singleplayer then store hash.
        this.turns[clientMsg.turnNumber].hash = clientMsg.hash;
        return;
      }
      // If we are replaying a game then verify hash.
      const archivedHash = this.turns[clientMsg.turnNumber].hash;
      if (!archivedHash) {
        console.warn(
          `no archived hash found for turn ${clientMsg.turnNumber}, client hash: ${clientMsg.hash}`,
        );
        return;
      }
      if (archivedHash != clientMsg.hash) {
        console.error(
          `desync detected on turn ${clientMsg.turnNumber}, client hash: ${clientMsg.hash}, server hash: ${archivedHash}`,
        );
        this.clientMessage({
          type: "desync",
          turn: clientMsg.turnNumber,
          correctHash: archivedHash,
          clientsWithCorrectHash: 0,
          totalActiveClients: 1,
          yourHash: clientMsg.hash,
        });
      } else {
        console.log(
          `hash verified on turn ${clientMsg.turnNumber}, client hash: ${clientMsg.hash}, server hash: ${archivedHash}`,
        );
      }
    }
    if (clientMsg.type == "winner") {
      this.winner = clientMsg;
      this.allPlayersStats = clientMsg.allPlayersStats;
    }
  }

  private endTurn() {
    if (this.paused) {
      return;
    }
    const pastTurn: Turn = {
      turnNumber: this.turns.length,
      gameID: this.lobbyConfig.gameID,
      intents: this.intents,
    };
    this.turns.push(pastTurn);
    this.intents = [];
    this.clientMessage({
      type: "turn",
      turn: pastTurn,
    });
  }

  public endGame(saveFullGame: boolean = false) {
    consolex.log("local server ending game");
    clearInterval(this.endTurnIntervalID);
    const players: PlayerRecord[] = [
      {
        ip: null,
        persistentID: getPersistentIDFromCookie(),
        username: this.lobbyConfig.playerName(),
        clientID: this.lobbyConfig.clientID,
      },
    ];
    const record = createGameRecord(
      this.lobbyConfig.gameID,
      this.lobbyConfig.gameConfig,
      players,
      this.turns,
      this.startedAt,
      Date.now(),
      this.winner?.winner,
      this.winner?.winnerType,
      this.allPlayersStats,
    );
    if (!saveFullGame) {
      // Clear turns because beacon only supports up to 64kb
      record.turns = [];
    }
    // For unload events, sendBeacon is the only reliable method
    const blob = new Blob([JSON.stringify(GameRecordSchema.parse(record))], {
      type: "application/json",
    });
    const workerPath = this.lobbyConfig.serverConfig.workerPath(
      this.lobbyConfig.gameID,
    );
    navigator.sendBeacon(`/${workerPath}/api/archive_singleplayer_game`, blob);
  }
}
