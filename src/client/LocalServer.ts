import {
  AllPlayersStats,
  ClientMessage,
  ClientSendWinnerMessage,
  GameRecordSchema,
  Intent,
  PlayerRecord,
  ServerMessage,
  ServerStartGameMessage,
  Turn,
} from "../core/Schemas";
import { createGameRecord, decompressGameRecord, replacer } from "../core/Util";
import { EventBus } from "../core/EventBus";
import { LobbyConfig } from "./ClientGameRunner";
import { ReplaySpeedChangeEvent } from "./InputHandler";
import { defaultReplaySpeedMultiplier } from "./utilities/ReplaySpeedMultiplier";
import { getPersistentID } from "./Main";
import { z } from "zod";

export class LocalServer {
  // All turns from the game record on replay.
  private replayTurns: Turn[] = [];

  private readonly turns: Turn[] = [];

  private intents: Intent[] = [];
  private startedAt = 0;

  private paused = false;
  private replaySpeedMultiplier = defaultReplaySpeedMultiplier;

  private winner: ClientSendWinnerMessage | null = null;
  private allPlayersStats: AllPlayersStats = {};

  private turnsExecuted = 0;
  private turnStartTime = 0;

  private turnCheckInterval: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly lobbyConfig: LobbyConfig,
    private readonly clientConnect: () => void,
    private readonly clientMessage: (message: ServerMessage) => void,
    private readonly isReplay: boolean,
    private readonly eventBus: EventBus,
  ) {}

  start() {
    this.turnCheckInterval = setInterval(() => {
      const turnIntervalMs =
        this.lobbyConfig.serverConfig.turnIntervalMs() *
        this.replaySpeedMultiplier;

      if (
        this.turnsExecuted === this.turns.length &&
        Date.now() > this.turnStartTime + turnIntervalMs
      ) {
        this.turnStartTime = Date.now();
        // End turn on the server means the client will start processing the turn.
        this.endTurn();
      }
    }, 5);

    this.eventBus.on(ReplaySpeedChangeEvent, (event) => {
      this.replaySpeedMultiplier = event.replaySpeedMultiplier;
    });

    this.startedAt = Date.now();
    this.clientConnect();
    if (this.lobbyConfig.gameRecord) {
      this.replayTurns = decompressGameRecord(
        this.lobbyConfig.gameRecord,
      ).turns;
    }
    if (this.lobbyConfig.gameStartInfo === undefined) {
      throw new Error("missing gameStartInfo");
    }
    this.clientMessage({
      type: "start",
      gameStartInfo: this.lobbyConfig.gameStartInfo,
      turns: [],
    } satisfies ServerStartGameMessage);
  }

  pause() {
    this.paused = true;
  }

  resume() {
    this.paused = false;
  }

  onMessage(clientMsg: ClientMessage) {
    if (clientMsg.type === "intent") {
      if (this.lobbyConfig.gameRecord) {
        // If we are replaying a game, we don't want to process intents
        return;
      }
      if (this.paused) {
        return;
      }
      this.intents.push(clientMsg.intent);
    }
    if (clientMsg.type === "hash") {
      if (!this.lobbyConfig.gameRecord) {
        // If we are playing a singleplayer then store hash.
        this.turns[clientMsg.turnNumber].hash = clientMsg.hash;
        return;
      }
      // If we are replaying a game then verify hash.
      const archivedHash = this.replayTurns[clientMsg.turnNumber].hash;
      if (!archivedHash) {
        console.warn(
          `no archived hash found for turn ${clientMsg.turnNumber}, client hash: ${clientMsg.hash}`,
        );
        return;
      }
      if (archivedHash !== clientMsg.hash) {
        console.error(
          `desync detected on turn ${
            clientMsg.turnNumber}, client hash: ${
            clientMsg.hash}, server hash: ${
            archivedHash}`,
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
    if (clientMsg.type === "winner") {
      this.winner = clientMsg;
      this.allPlayersStats = clientMsg.allPlayersStats;
    }
  }

  // This is so the client can tell us when it finished processing the turn.
  public turnComplete() {
    this.turnsExecuted++;
  }

  // endTurn in this context means the server has collected all the intents
  // and will send the turn to the client.
  private endTurn() {
    if (this.paused) {
      return;
    }
    if (this.replayTurns.length > 0) {
      if (this.turns.length >= this.replayTurns.length) {
        this.endGame();
        return;
      }
      this.intents = this.replayTurns[this.turns.length].intents;
    }
    const pastTurn: Turn = {
      turnNumber: this.turns.length,
      intents: this.intents,
    };
    this.turns.push(pastTurn);
    this.intents = [];
    this.clientMessage({
      type: "turn",
      turn: pastTurn,
    });
  }

  public endGame(saveFullGame = false) {
    console.log("local server ending game");
    clearInterval(this.turnCheckInterval);
    if (this.isReplay) {
      return;
    }
    const players: PlayerRecord[] = [
      {
        persistentID: getPersistentID(),
        username: this.lobbyConfig.playerName,
        clientID: this.lobbyConfig.clientID,
        stats: this.allPlayersStats[this.lobbyConfig.clientID],
      },
    ];
    if (this.lobbyConfig.gameStartInfo === undefined) {
      throw new Error("missing gameStartInfo");
    }
    const record = createGameRecord(
      this.lobbyConfig.gameStartInfo.gameID,
      this.lobbyConfig.gameStartInfo.config,
      players,
      this.turns,
      this.startedAt,
      Date.now(),
      this.winner?.winner,
      this.lobbyConfig.serverConfig,
      this.lobbyConfig.gameStartInfo.lobbyCreatedAt,
    );
    if (!saveFullGame) {
      // Clear turns because beacon only supports up to 64kb
      record.turns = [];
    }
    // For unload events, sendBeacon is the only reliable method
    const result = GameRecordSchema.safeParse(record);
    if (!result.success) {
      const error = z.prettifyError(result.error);
      console.error("Error parsing game record", error);
      return;
    }
    const blob = new Blob([JSON.stringify(result.data, replacer)], {
      type: "application/json",
    });
    const workerPath = this.lobbyConfig.serverConfig.workerPath(
      this.lobbyConfig.gameStartInfo.gameID,
    );
    navigator.sendBeacon(`/${workerPath}/api/archive_singleplayer_game`, blob);
  }
}
