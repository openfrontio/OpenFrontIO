import { translateText } from "../client/Utils";
import { EventBus } from "../core/EventBus";
import {
  ClientID,
  GameID,
  GameRecord,
  GameStartInfo,
  PlayerRecord,
  ServerMessage,
  Winner,
} from "../core/Schemas";
import { createGameRecord } from "../core/Util";
import { ServerConfig } from "../core/configuration/Config";
import { getConfig } from "../core/configuration/ConfigLoader";
import { Cell, PlayerActions, UnitType } from "../core/game/Game";
import { TileRef } from "../core/game/GameMap";
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
import {
  DoBoatAttackEvent,
  InputHandler,
  MouseMoveEvent,
  MouseUpEvent,
} from "./InputHandler";
import { endGame, startGame, startTime } from "./LocalPersistantStats";
import { getPersistentID } from "./Main";
import {
  SendAttackIntentEvent,
  SendBoatAttackIntentEvent,
  SendHashEvent,
  SendSpawnIntentEvent,
  Transport,
} from "./Transport";
import { createCanvas } from "./Utils";
import { createRenderer, GameRenderer } from "./graphics/GameRenderer";

export interface LobbyConfig {
  serverConfig: ServerConfig;
  pattern: string | undefined;
  flag: string;
  playerName: string;
  clientID: ClientID;
  gameID: GameID;
  token: string;
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

  console.log(
    `joining lobby: gameID: ${lobbyConfig.gameID}, clientID: ${lobbyConfig.clientID}`,
  );

  const userSettings: UserSettings = new UserSettings();
  startGame(lobbyConfig.gameID, lobbyConfig.gameStartInfo?.config ?? {});

  const transport = new Transport(lobbyConfig, eventBus);

  const onconnect = () => {
    console.log(`Joined game lobby ${lobbyConfig.gameID}`);
    transport.joinGame(0);
  };
  let terrainLoad: Promise<TerrainMapData> | null = null;

  const onmessage = (message: ServerMessage) => {
    if (message.type === "prestart") {
      console.log(`lobby: game prestarting: ${JSON.stringify(message)}`);
      terrainLoad = loadTerrainMap(message.gameMap);
      onPrestart();
    }
    if (message.type === "start") {
      // Trigger prestart for singleplayer games
      onPrestart();
      console.log(`lobby: game started: ${JSON.stringify(message, null, 2)}`);
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
    console.log("leaving game");
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
  if (lobbyConfig.gameStartInfo === undefined) {
    throw new Error("missing gameStartInfo");
  }
  const config = await getConfig(
    lobbyConfig.gameStartInfo.config,
    userSettings,
    lobbyConfig.gameRecord !== undefined,
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

  console.log("going to init path finder");
  console.log("inited path finder");
  const canvas = createCanvas();
  const gameRenderer = createRenderer(canvas, gameView, eventBus);

  console.log(
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
  private myPlayer: PlayerView | null = null;
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

  private getWinner(update: WinUpdate): Winner {
    if (update.winner[0] !== "player") return update.winner;
    const clientId = this.gameView.playerBySmallID(update.winner[1]).clientID();
    if (clientId === null) return;
    return ["player", clientId];
  }

  private saveGame(update: WinUpdate) {
    if (this.myPlayer === null) {
      return;
    }
    const players: PlayerRecord[] = [
      {
        persistentID: getPersistentID(),
        username: this.lobby.playerName,
        clientID: this.lobby.clientID,
        stats: update.allPlayersStats[this.lobby.clientID],
      },
    ];
    const winner = this.getWinner(update);

    if (this.lobby.gameStartInfo === undefined) {
      throw new Error("missing gameStartInfo");
    }
    const record = createGameRecord(
      this.lobby.gameStartInfo.gameID,
      this.lobby.gameStartInfo.config,
      players,
      // Not saving turns locally
      [],
      startTime(),
      Date.now(),
      winner,
    );
    endGame(record);
  }

  public start() {
    console.log("starting client game");

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
    this.eventBus.on(DoBoatAttackEvent, (e) => this.doBoatAttackUnderCursor());

    this.renderer.initialize();
    this.input.initialize();
    this.worker.start((gu: GameUpdateViewData | ErrorUpdate) => {
      if (this.lobby.gameStartInfo === undefined) {
        throw new Error("missing gameStartInfo");
      }
      if ("errMsg" in gu) {
        showErrorModal(
          gu.errMsg,
          gu.stack ?? "missing",
          this.lobby.gameStartInfo.gameID,
          this.lobby.clientID,
        );
        console.error(gu.stack);
        this.stop(true);
        return;
      }
      this.transport.turnComplete();
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
      console.log("Connected to game server!");
      this.transport.joinGame(this.turnsSeen);
    };
    const onmessage = (message: ServerMessage) => {
      this.lastMessageTime = Date.now();
      if (message.type === "start") {
        this.hasJoined = true;
        console.log("starting game!");
        for (const turn of message.turns) {
          if (turn.turnNumber < this.turnsSeen) {
            continue;
          }
          while (turn.turnNumber - 1 > this.turnsSeen) {
            this.worker.sendTurn({
              turnNumber: this.turnsSeen,
              intents: [],
            });
            this.turnsSeen++;
          }
          this.worker.sendTurn(turn);
          this.turnsSeen++;
        }
      }
      if (message.type === "desync") {
        if (this.lobby.gameStartInfo === undefined) {
          throw new Error("missing gameStartInfo");
        }
        showErrorModal(
          `desync from server: ${JSON.stringify(message)}`,
          "",
          this.lobby.gameStartInfo.gameID,
          this.lobby.clientID,
          true,
          translateText("error_modal.desync_notice"),
        );
      }
      if (message.type === "turn") {
        if (!this.hasJoined) {
          this.transport.joinGame(0);
          return;
        }
        if (this.turnsSeen !== message.turn.turnNumber) {
          console.error(
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
    console.log(`clicked cell ${cell}`);
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
    if (this.myPlayer === null) {
      const myPlayer = this.gameView.playerByClientID(this.lobby.clientID);
      if (myPlayer === null) return;
      this.myPlayer = myPlayer;
    }
    this.myPlayer.actions(tile).then((actions) => {
      if (this.myPlayer === null) return;
      if (actions.canAttack) {
        this.eventBus.emit(
          new SendAttackIntentEvent(
            this.gameView.owner(tile).id(),
            this.myPlayer.troops() * this.renderer.uiState.attackRatio,
          ),
        );
      } else if (this.canBoatAttack(actions, tile)) {
        this.sendBoatAttackIntent(tile, cell);
      }

      const owner = this.gameView.owner(tile);
      if (owner.isPlayer()) {
        this.gameView.setFocusedPlayer(owner as PlayerView);
      } else {
        this.gameView.setFocusedPlayer(null);
      }
    });
  }

  private doBoatAttackUnderCursor(): void {
    if (!this.isActive || !this.lastMousePosition) {
      return;
    }
    const cell = this.renderer.transformHandler.screenToWorldCoordinates(
      this.lastMousePosition.x,
      this.lastMousePosition.y,
    );
    if (!this.gameView.isValidCoord(cell.x, cell.y)) {
      return;
    }

    const tile = this.gameView.ref(cell.x, cell.y);
    if (this.gameView.inSpawnPhase()) {
      return;
    }

    if (this.myPlayer === null) {
      const myPlayer = this.gameView.playerByClientID(this.lobby.clientID);
      if (myPlayer === null) return;
      this.myPlayer = myPlayer;
    }

    this.myPlayer.actions(tile).then((actions) => {
      if (!actions.canAttack && this.canBoatAttack(actions, tile)) {
        this.sendBoatAttackIntent(tile, cell);
      }
    });
  }

  private canBoatAttack(actions: PlayerActions, tile: TileRef): boolean {
    const bu = actions.buildableUnits.find(
      (bu) => bu.type === UnitType.TransportShip,
    );
    if (bu === undefined) {
      console.warn(`no transport ship buildable units`);
      return false;
    }
    return (
      bu.canBuild !== false &&
      this.shouldBoat(tile, bu.canBuild) &&
      this.gameView.isLand(tile)
    );
  }

  private sendBoatAttackIntent(tile: TileRef, cell: Cell) {
    if (!this.myPlayer) return;

    this.myPlayer
      .bestTransportShipSpawn(this.gameView.ref(cell.x, cell.y))
      .then((spawn: number | false) => {
        if (this.myPlayer === null) throw new Error("not initialized");
        let spawnCell: Cell | null = null;
        if (spawn !== false) {
          spawnCell = new Cell(this.gameView.x(spawn), this.gameView.y(spawn));
        }
        this.eventBus.emit(
          new SendBoatAttackIntentEvent(
            this.gameView.owner(tile).id(),
            cell,
            this.myPlayer.troops() * this.renderer.uiState.attackRatio,
            spawnCell,
          ),
        );
      });
  }

  private shouldBoat(tile: TileRef, src: TileRef) {
    // TODO: Global enable flag
    // TODO: Global limit autoboat to nearby shore flag
    // if (!enableAutoBoat) return false;
    // if (!limitAutoBoatNear) return true;
    const distanceSquared = this.gameView.euclideanDistSquared(tile, src);
    const limit = 100;
    const limitSquared = limit * limit;
    if (distanceSquared > limitSquared) return false;
    return true;
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
  heading = translateText("error_modal.crashed"),
) {
  const errorText = `Error: ${errMsg}\nStack: ${stack}`;

  if (document.querySelector("#error-modal")) {
    return;
  }

  const modal = document.createElement("div");

  modal.id = "error-modal";

  const content = `${translateText(heading)}\n game id: ${gameID}, client id: ${clientID}\n${translateText("error_modal.paste_discord")}\n${errorText}`;

  // Create elements
  const pre = document.createElement("pre");
  pre.textContent = content;

  const button = document.createElement("button");
  button.textContent = translateText("error_modal.copy_clipboard");
  button.className = "copy-btn";
  button.addEventListener("click", () => {
    navigator.clipboard
      .writeText(content)
      .then(() => (button.textContent = translateText("error_modal.copied")))
      .catch(
        () => (button.textContent = translateText("error_modal.failed_copy")),
      );
  });

  const closeButton = document.createElement("button");
  closeButton.textContent = "X";
  closeButton.className = "close-btn";
  closeButton.addEventListener("click", () => {
    modal.style.display = "none";
  });

  // Add to modal
  modal.appendChild(pre);
  modal.appendChild(button);
  if (closable) {
    modal.appendChild(closeButton);
  }

  document.body.appendChild(modal);
}
