import { consolex, initRemoteSender } from "../core/Consolex";
import { EventBus } from "../core/EventBus";
import {
  ClientID,
  GameID,
  GameRecord,
  GameStartInfo,
  PlayerRecord,
  ServerMessage,
} from "../core/Schemas";
import { createGameRecord } from "../core/Util";
import { ServerConfig } from "../core/configuration/Config";
import { getConfig } from "../core/configuration/ConfigLoader";
import { TeamName, UnitType } from "../core/game/Game";
import {
  ErrorUpdate,
  GameUpdateType,
  GameUpdateViewData,
  HashUpdate,
  WinUpdate,
} from "../core/game/GameUpdates";
import { GameView, PlayerView } from "../core/game/GameView";
import { loadTerrainMap, TerrainMapData } from "../core/game/TerrainMapLoader";
import { UserSettings } from "../core/game/UserSettings";
import { WorkerClient } from "../core/worker/WorkerClient";
import { InputHandler, MouseMoveEvent, MouseUpEvent } from "./InputHandler";
import { endGame, startGame, startTime } from "./LocalPersistantStats";
import { getPersistentIDFromCookie } from "./Main";
import {
  SendAttackIntentEvent,
  SendHashEvent,
  SendSpawnIntentEvent,
  Transport,
} from "./Transport";
import { createCanvas } from "./Utils";
import { createRenderer, GameRenderer } from "./graphics/GameRenderer";

export interface LobbyConfig {
  serverConfig: ServerConfig;
  flag: string;
  playerName: string;
  clientID: ClientID;
  gameID: GameID;
  persistentID: string;
  // GameStartInfo only exists when playing a singleplayer game.
  gameStartInfo?: GameStartInfo;
  // GameRecord exists when replaying an archived game.
  gameRecord?: GameRecord;
}

export function joinLobby(
  lobbyConfig: LobbyConfig,
  onPrestart: () => void,
  onJoin: () => void,
): () => void {
  const eventBus = new EventBus();
  initRemoteSender(eventBus);

  consolex.log(
    `joinging lobby: gameID: ${lobbyConfig.gameID}, clientID: ${lobbyConfig.clientID}, persistentID: ${lobbyConfig.persistentID.slice(0, 5)}`,
  );

  const userSettings: UserSettings = new UserSettings();
  startGame(lobbyConfig.gameID, lobbyConfig.gameStartInfo?.config);

  const transport = new Transport(lobbyConfig, eventBus);

  const onconnect = () => {
    consolex.log(`Joined game lobby ${lobbyConfig.gameID}`);
    transport.joinGame(0);
  };
  let terrainLoad: Promise<TerrainMapData> | null = null;

  const onmessage = (message: ServerMessage) => {
    if (message.type == "prestart") {
      consolex.log(`lobby: game prestarting: ${JSON.stringify(message)}`);
      terrainLoad = loadTerrainMap(message.gameMap);
      onPrestart();
    }
    if (message.type == "start") {
      // Trigger prestart for singleplayer games
      onPrestart();
      consolex.log(`lobby: game started: ${JSON.stringify(message)}`);
      onJoin();
      // For multiplayer games, GameStartInfo is not known until game starts.
      lobbyConfig.gameStartInfo = message.gameStartInfo;
      createClientGame(
        lobbyConfig,
        eventBus,
        transport,
        userSettings,
        terrainLoad,
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
  eventBus: EventBus,
  transport: Transport,
  userSettings: UserSettings,
  terrainLoad: Promise<TerrainMapData> | null,
): Promise<ClientGameRunner> {
  const config = await getConfig(
    lobbyConfig.gameStartInfo.config,
    userSettings,
  );
  let gameMap: TerrainMapData | null = null;

  if (terrainLoad) {
    gameMap = await terrainLoad;
  } else {
    gameMap = await loadTerrainMap(lobbyConfig.gameStartInfo.config.gameMap);
  }
  const worker = new WorkerClient(
    lobbyConfig.gameStartInfo,
    lobbyConfig.clientID,
  );
  await worker.initialize();
  const gameView = new GameView(
    worker,
    config,
    gameMap.gameMap,
    lobbyConfig.clientID,
    lobbyConfig.gameStartInfo.gameID,
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
    `creating private game got difficulty: ${lobbyConfig.gameStartInfo.config.difficulty}`,
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

  private lastMousePosition: { x: number; y: number } | null = null;

  private lastMessageTime: number = 0;
  private connectionCheckInterval: NodeJS.Timeout | null = null;

  constructor(
    private lobby: LobbyConfig,
    private eventBus: EventBus,
    private renderer: GameRenderer,
    private input: InputHandler,
    private transport: Transport,
    private worker: WorkerClient,
    private gameView: GameView,
  ) {
    this.lastMessageTime = Date.now();
  }

  private saveGame(update: WinUpdate) {
    const players: PlayerRecord[] = [
      {
        ip: null,
        persistentID: getPersistentIDFromCookie(),
        username: this.lobby.playerName,
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
      this.lobby.gameStartInfo.gameID,
      this.lobby.gameStartInfo,
      players,
      // Not saving turns locally
      [],
      startTime(),
      Date.now(),
      winner,
      update.winnerType,
      update.allPlayersStats,
    );
    endGame(record);
  }

  public start() {
    consolex.log("starting client game");
    this.isActive = true;
    this.lastMessageTime = Date.now();
    setTimeout(() => {
      this.connectionCheckInterval = setInterval(
        () => this.onConnectionCheck(),
        1000,
      );
    }, 20000);
    this.eventBus.on(MouseUpEvent, (e) => this.inputEvent(e));
    this.eventBus.on(MouseMoveEvent, (e) => this.onMouseMove(e));

    this.renderer.initialize();
    this.input.initialize();
    this.worker.start((gu: GameUpdateViewData | ErrorUpdate) => {
      if ("errMsg" in gu) {
        showErrorModal(
          gu.errMsg,
          gu.stack,
          this.lobby.gameStartInfo.gameID,
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
      this.lastMessageTime = Date.now();
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
          this.lobby.gameStartInfo.gameID,
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
    if (this.connectionCheckInterval) {
      clearInterval(this.connectionCheckInterval);
      this.connectionCheckInterval = null;
    }
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

      const owner = this.gameView.owner(tile);
      if (owner.isPlayer()) {
        this.gameView.setFocusedPlayer(owner as PlayerView);
      } else {
        this.gameView.setFocusedPlayer(null);
      }
    });
  }

  private onMouseMove(event: MouseMoveEvent) {
    this.lastMousePosition = { x: event.x, y: event.y };
    this.checkTileUnderCursor();
  }

  private checkTileUnderCursor() {
    if (!this.lastMousePosition || !this.renderer.transformHandler) return;

    const cell = this.renderer.transformHandler.screenToWorldCoordinates(
      this.lastMousePosition.x,
      this.lastMousePosition.y,
    );

    if (!cell || !this.gameView.isValidCoord(cell.x, cell.y)) {
      return;
    }

    const tile = this.gameView.ref(cell.x, cell.y);

    if (this.gameView.isLand(tile)) {
      const owner = this.gameView.owner(tile);
      if (owner.isPlayer()) {
        this.gameView.setFocusedPlayer(owner as PlayerView);
      } else {
        this.gameView.setFocusedPlayer(null);
      }
    } else {
      const units = this.gameView
        .nearbyUnits(tile, 50, [
          UnitType.Warship,
          UnitType.TradeShip,
          UnitType.TransportShip,
        ])
        .sort((a, b) => a.distSquared - b.distSquared)
        .map((u) => u.unit);

      if (units.length > 0) {
        this.gameView.setFocusedPlayer(units[0].owner() as PlayerView);
      } else {
        this.gameView.setFocusedPlayer(null);
      }
    }
  }

  private onConnectionCheck() {
    if (this.transport.isLocal) {
      return;
    }
    const timeSinceLastMessage = Date.now() - this.lastMessageTime;
    if (timeSinceLastMessage > 5000) {
      console.log(
        `No message from server for ${timeSinceLastMessage} ms, reconnecting`,
      );
      this.lastMessageTime = Date.now();
      this.transport.reconnect();
    }
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
