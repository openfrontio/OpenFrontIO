import { ServerConfig } from "../core/configuration/Config";
import { consolex } from "../core/Consolex";
import {
  ClientID,
  ClientMessage,
  ClientMessageSchema,
  GameConfig,
  GameRecordSchema,
  Intent,
  PlayerRecord,
  ServerMessage,
  ServerStartGameMessageSchema,
  Turn,
} from "../core/Schemas";
import { CreateGameRecord } from "../core/Util";
import { LobbyConfig } from "./ClientGameRunner";
import { getPersistentIDFromCookie } from "./Main";

export class LocalServer {
  private turns: Turn[] = [];
  private intents: Intent[] = [];
  private startedAt: number;

  private endTurnIntervalID;

  private paused = false;

  private winner: ClientID | null = null;

  constructor(
    private serverConfig: ServerConfig,
    private gameConfig: GameConfig,
    private lobbyConfig: LobbyConfig,
    private clientConnect: () => void,
    private clientMessage: (message: ServerMessage) => void,
  ) {}

  start() {
    this.startedAt = Date.now();
    this.endTurnIntervalID = setInterval(
      () => this.endTurn(),
      this.serverConfig.turnIntervalMs(),
    );
    this.clientConnect();
    this.clientMessage(
      ServerStartGameMessageSchema.parse({
        type: "start",
        config: this.gameConfig,
        turns: [],
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
    if (clientMsg.type == "winner") {
      this.winner = clientMsg.winner;
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

  public endGame() {
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
    const record = CreateGameRecord(
      this.lobbyConfig.gameID,
      this.gameConfig,
      players,
      this.turns,
      this.startedAt,
      Date.now(),
      this.winner,
    );
    // Clear turns because beacon only supports up to 64kb
    record.turns = [];
    // For unload events, sendBeacon is the only reliable method
    const blob = new Blob([JSON.stringify(GameRecordSchema.parse(record))], {
      type: "application/json",
    });
    navigator.sendBeacon("/archive_singleplayer_game", blob);
  }
}
