import { PlayerID, GameMapType, Difficulty, GameType } from "../core/game/Game";
import { EventBus } from "../core/EventBus";
import { createRenderer, GameRenderer } from "./graphics/GameRenderer";
import { InputHandler, MouseUpEvent } from "./InputHandler";
import {
  ClientID,
  GameConfig,
  GameID,
  ServerMessage,
  PlayerRecord,
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
import { getConfig, ServerConfig } from "../core/configuration/Config";
import { GameView, PlayerView } from "../core/game/GameView";
import { GameUpdateViewData } from "../core/game/GameUpdates";
import { UserSettings } from "../core/game/UserSettings";
import { LocalPersistantStats } from "./LocalPersistantStats";
import { CreateGameRecord } from "../core/Util";
import { getPersistentIDFromCookie } from "./Main";

export interface LobbyConfig {
  serverConfig: ServerConfig;
  flag: () => string;
  playerName: () => string;
  clientID: ClientID;
  playerID: PlayerID;
  persistentID: string;
  gameType: GameType;
  gameID: GameID;
  map: GameMapType | null;
  difficulty: Difficulty | null;
  infiniteGold: boolean | null;
  infiniteTroops: boolean | null;
  instantBuild: boolean | null;
  bots: number | null;
  disableNPCs: boolean | null;
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
  const gameConfig: GameConfig = {
    gameType: lobbyConfig.gameType,
    gameMap: lobbyConfig.map,
    difficulty: lobbyConfig.difficulty,
    disableNPCs: lobbyConfig.disableNPCs,
    bots: lobbyConfig.bots,
    infiniteGold: lobbyConfig.infiniteGold,
    infiniteTroops: lobbyConfig.infiniteTroops,
    instantBuild: lobbyConfig.instantBuild,
  };
  LocalPersistantStats.startGame(
    lobbyConfig.gameID,
    lobbyConfig.playerID,
    gameConfig,
  );

  const transport = new Transport(
    lobbyConfig,
    gameConfig,
    eventBus,
    lobbyConfig.serverConfig,
  );

  const onconnect = () => {
    consolex.log(`Joined game lobby ${lobbyConfig.gameID}`);
    transport.joinGame(0);
  };
  const onmessage = (message: ServerMessage) => {
    if (message.type == "start") {
      consolex.log("lobby: game started");
      onjoin();
      createClientGame(
        lobbyConfig,
        message.config,
        eventBus,
        transport,
        userSettings,
      ).then((r) => r.start());
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
  gameConfig: GameConfig,
  eventBus: EventBus,
  transport: Transport,
  userSettings: UserSettings,
): Promise<ClientGameRunner> {
  const config = await getConfig(gameConfig, userSettings);

  const gameMap = await loadTerrainMap(gameConfig.gameMap);
  const worker = new WorkerClient(
    lobbyConfig.gameID,
    gameConfig,
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
    `creating private game got difficulty: ${gameConfig.difficulty}`,
  );

  return new ClientGameRunner(
    gameConfig,
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
    private gameConfig: GameConfig,
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
    const record = CreateGameRecord(
      this.lobby.gameID,
      this.gameConfig,
      players,
      // Not saving turns locally
      [],
      LocalPersistantStats.startTime(),
      Date.now(),
      this.gameView.playerBySmallID(update.winnerID).id(),
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
        showErrorModal(gu.errMsg, gu.stack, this.lobby.clientID);
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
          this.lobby.clientID,
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

  public stop() {
    this.worker.cleanup();
    this.isActive = false;
    this.transport.leaveGame();
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

function showErrorModal(errMsg: string, stack: string, clientID: ClientID) {
  const errorText = `Error: ${errMsg}\nStack: ${stack}`;
  consolex.error(errorText);

  const modal = document.createElement("div");
  const content = `Game crashed! client id: ${clientID}\nPlease paste the following in your bug report in Discord:\n${errorText}`;

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

  // Add to modal
  modal.style.cssText =
    "position:fixed; padding:20px; background:white; border:1px solid black; top:50%; left:50%; transform:translate(-50%,-50%); z-index:9999;";
  modal.appendChild(pre);
  modal.appendChild(button);

  document.body.appendChild(modal);
}
