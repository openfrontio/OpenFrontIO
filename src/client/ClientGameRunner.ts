import {
  PlayerID,
  GameMapType,
  Difficulty,
  GameType,
  TeamName,
} from "../core/game/Game";
import { EventBus } from "../core/EventBus";
import { createRenderer, GameRenderer } from "./graphics/GameRenderer";
import { InputHandler, MouseUpEvent } from "./InputHandler";
import {
  ClientID,
  GameConfig,
  GameID,
  ServerMessage,
  PlayerRecord,
  GameRecord,
} from "../core/Schemas";
import { loadTerrainMap } from "../core/game/TerrainMapLoader";
import {
  SendAttackIntentEvent,
  SendHashEvent,
  SendSpawnIntentEvent,
  Transport,
} from "./Transport";
import { createCanvas } from "./Utils";
import {
  ErrorUpdate,
  GameUpdateType,
  HashUpdate,
  WinUpdate,
} from "../core/game/GameUpdates";
import { WorkerClient } from "../core/worker/WorkerClient";
import { consolex, initRemoteSender } from "../core/Consolex";
import { ServerConfig } from "../core/configuration/Config";
import { getConfig } from "../core/configuration/ConfigLoader";
import { GameView, PlayerView } from "../core/game/GameView";
import { GameUpdateViewData } from "../core/game/GameUpdates";
import { UserSettings } from "../core/game/UserSettings";
import { LocalPersistantStats } from "./LocalPersistantStats";
import { createGameRecord } from "../core/Util";
import { getPersistentIDFromCookie } from "./Main";

export interface LobbyConfig {
  serverConfig: ServerConfig;
  flag: () => string;
  playerName: () => string;
  clientID: ClientID;
  playerID: PlayerID;
  persistentID: string;
  gameID: GameID;
  // GameConfig only exists when playing a singleplayer game.
  gameConfig?: GameConfig;
  // GameRecord exists when replaying an archived game.
  gameRecord?: GameRecord;
}

export function joinLobby(
  lobbyConfig: LobbyConfig,
  onjoin: () => void,
): () => void {
  const eventBus = new EventBus();
  initRemoteSender(eventBus);

  consolex.log(
    `joinging lobby: gameID: ${lobbyConfig.gameID}, clientID: ${lobbyConfig.clientID}, persistentID: ${lobbyConfig.persistentID}`,
  );

  const userSettings: UserSettings = new UserSettings();
  LocalPersistantStats.startGame(
    lobbyConfig.gameID,
    lobbyConfig.playerID,
    lobbyConfig.gameConfig,
  );

  const transport = new Transport(lobbyConfig, eventBus);

  const onconnect = () => {
    consolex.log(`Joined game lobby ${lobbyConfig.gameID}`);
    transport.joinGame(0);
  };
  const onmessage = (message: ServerMessage) => {
    if (message.type == "start") {
      consolex.log("lobby: game started");
      onjoin();
      // For multiplayer games, GameConfig is not known until game starts.
      lobbyConfig.gameConfig = message.config;
      createClientGame(lobbyConfig, eventBus, transport, userSettings).then(
        (r) => r.start(),
      );
    }
  };
  transport.connect(onconnect, onmessage);
  return () => {
    consolex.log("leaving game");
    transport.leaveGame();
  };
}

export async function createClientGame(
  lobbyConfig: LobbyConfig,
  eventBus: EventBus,
  transport: Transport,
  userSettings: UserSettings,
): Promise<ClientGameRunner> {
  const config = await getConfig(lobbyConfig.gameConfig, userSettings);

  const gameMap = await loadTerrainMap(lobbyConfig.gameConfig.gameMap);
  const worker = new WorkerClient(
    lobbyConfig.gameID,
    lobbyConfig.gameConfig,
    lobbyConfig.clientID,
  );
  await worker.initialize();
  const gameView = new GameView(
    worker,
    config,
    gameMap.gameMap,
    lobbyConfig.clientID,
    lobbyConfig.gameID,
  );

  consolex.log("going to init path finder");
  consolex.log("inited path finder");
  const canvas = createCanvas();
  const gameRenderer = createRenderer(
    canvas,
    gameView,
    eventBus,
    lobbyConfig.clientID,
  );

  consolex.log(
    `creating private game got difficulty: ${lobbyConfig.gameConfig.difficulty}`,
  );

  return new ClientGameRunner(
    lobbyConfig,
    eventBus,
    gameRenderer,
    new InputHandler(canvas, eventBus),
    transport,
    worker,
    gameView,
  );
}

export class ClientGameRunner {
  private myPlayer: PlayerView;
  private isActive = false;

  private turnsSeen = 0;
  private hasJoined = false;

  constructor(
    private lobby: LobbyConfig,
    private eventBus: EventBus,
    private renderer: GameRenderer,
    private input: InputHandler,
    private transport: Transport,
    private worker: WorkerClient,
    private gameView: GameView,
  ) {}

  private saveGame(update: WinUpdate) {
    const players: PlayerRecord[] = [
      {
        ip: null,
        persistentID: getPersistentIDFromCookie(),
        username: this.lobby.playerName(),
        clientID: this.lobby.clientID,
      },
    ];
    let winner: ClientID | TeamName | null = null;
    if (update.winnerType == "player") {
      winner = this.gameView
        .playerBySmallID(update.winner as number)
        .clientID();
    } else {
      winner = update.winner as TeamName;
    }

    const record = createGameRecord(
      this.lobby.gameID,
      this.lobby.gameConfig,
      players,
      // Not saving turns locally
      [],
      LocalPersistantStats.startTime(),
      Date.now(),
      winner,
      update.winnerType,
      update.allPlayersStats,
    );
    LocalPersistantStats.endGame(record);
  }

  public start() {
    consolex.log("starting client game");
    this.isActive = true;
    this.eventBus.on(MouseUpEvent, (e) => this.inputEvent(e));

    this.renderer.initialize();
    this.input.initialize();
    this.worker.start((gu: GameUpdateViewData | ErrorUpdate) => {
      if ("errMsg" in gu) {
        showErrorModal(
          gu.errMsg,
          gu.stack,
          this.lobby.gameID,
          this.lobby.clientID,
        );
        this.stop(true);
        return;
      }
      gu.updates[GameUpdateType.Hash].forEach((hu: HashUpdate) => {
        this.eventBus.emit(new SendHashEvent(hu.tick, hu.hash));
      });
      this.gameView.update(gu);
      this.renderer.tick();

      if (gu.updates[GameUpdateType.Win].length > 0) {
        this.saveGame(gu.updates[GameUpdateType.Win][0]);
      }
    });
    const worker = this.worker;
    const keepWorkerAlive = () => {
      worker.sendHeartbeat();
      requestAnimationFrame(keepWorkerAlive);
    };
    requestAnimationFrame(keepWorkerAlive);

    const onconnect = () => {
      consolex.log("Connected to game server!");
      this.transport.joinGame(this.turnsSeen);
    };
    const onmessage = (message: ServerMessage) => {
      if (message.type == "start") {
        this.hasJoined = true;
        consolex.log("starting game!");
        for (const turn of message.turns) {
          if (turn.turnNumber < this.turnsSeen) {
            continue;
          }
          while (turn.turnNumber - 1 > this.turnsSeen) {
            this.worker.sendTurn({
              turnNumber: this.turnsSeen,
              gameID: turn.gameID,
              intents: [],
            });
            this.turnsSeen++;
          }
          this.worker.sendTurn(turn);
          this.turnsSeen++;
        }
      }
      if (message.type == "desync") {
        showErrorModal(
          `desync from server: ${JSON.stringify(message)}`,
          "",
          this.lobby.gameID,
          this.lobby.clientID,
          true,
          "You are desynced from other players. What you see might differ from other players.",
        );
      }
      if (message.type == "turn") {
        if (!this.hasJoined) {
          this.transport.joinGame(0);
          return;
        }
        if (this.turnsSeen != message.turn.turnNumber) {
          consolex.error(
            `got wrong turn have turns ${this.turnsSeen}, received turn ${message.turn.turnNumber}`,
          );
        } else {
          this.worker.sendTurn(message.turn);
          this.turnsSeen++;
        }
      }
    };
    this.transport.connect(onconnect, onmessage);
  }

  public stop(saveFullGame: boolean = false) {
    this.worker.cleanup();
    this.isActive = false;
    this.transport.leaveGame(saveFullGame);
  }

  private inputEvent(event: MouseUpEvent) {
    if (!this.isActive) {
      return;
    }
    const cell = this.renderer.transformHandler.screenToWorldCoordinates(
      event.x,
      event.y,
    );
    if (!this.gameView.isValidCoord(cell.x, cell.y)) {
      return;
    }
    consolex.log(`clicked cell ${cell}`);
    const tile = this.gameView.ref(cell.x, cell.y);
    if (
      this.gameView.isLand(tile) &&
      !this.gameView.hasOwner(tile) &&
      this.gameView.inSpawnPhase()
    ) {
      this.eventBus.emit(new SendSpawnIntentEvent(cell));
      return;
    }
    if (this.gameView.inSpawnPhase()) {
      return;
    }
    if (this.myPlayer == null) {
      this.myPlayer = this.gameView.playerByClientID(this.lobby.clientID);
      if (this.myPlayer == null) {
        return;
      }
    }
    this.myPlayer.actions(tile).then((actions) => {
      console.log(`got actions: ${JSON.stringify(actions)}`);
      if (actions.canAttack) {
        this.eventBus.emit(
          new SendAttackIntentEvent(
            this.gameView.owner(tile).id(),
            this.myPlayer.troops() * this.renderer.uiState.attackRatio,
          ),
        );
      }
    });
  }
}

function showErrorModal(
  errMsg: string,
  stack: string,
  gameID: GameID,
  clientID: ClientID,
  closable = false,
  heading = "Game crashed!",
) {
  const errorText = `Error: ${errMsg}\nStack: ${stack}`;

  if (document.querySelector("#error-modal")) {
    return;
  }

  const modal = document.createElement("div");
  const content = `${heading}\n game id: ${gameID}, client id: ${clientID}\nPlease paste the following in your bug report in Discord:\n${errorText}`;

  // Create elements
  const pre = document.createElement("pre");
  pre.textContent = content;

  const button = document.createElement("button");
  button.textContent = "Copy to clipboard";
  button.style.cssText =
    "padding: 8px 16px; margin-top: 10px; background: #4CAF50; color: white; border: none; border-radius: 4px; cursor: pointer;";
  button.addEventListener("click", () => {
    navigator.clipboard
      .writeText(content)
      .then(() => (button.textContent = "Copied!"))
      .catch(() => (button.textContent = "Failed to copy"));
  });

  const closeButton = document.createElement("button");
  closeButton.textContent = "X";
  closeButton.style.cssText =
    "color: white;top: 0px;right: 0px;cursor: pointer;background: red;margin-right: 0px;position: fixed;width: 40px;";
  closeButton.addEventListener("click", () => {
    modal.style.display = "none";
  });

  // Add to modal
  modal.style.cssText =
    "position:fixed; padding:20px; background:white; border:1px solid black; top:50%; left:50%; transform:translate(-50%,-50%); z-index:9999;";
  modal.appendChild(pre);
  modal.appendChild(button);
  modal.id = "error-modal";
  if (closable) {
    modal.appendChild(closeButton);
  }

  document.body.appendChild(modal);
}
