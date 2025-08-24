import {
  AutoUpgradeEvent,
  DoBoatAttackEvent,
  DoGroundAttackEvent,
  InputHandler,
  MouseMoveEvent,
  MouseUpEvent,
} from "./InputHandler";
import {
  ClientID,
  GameID,
  GameRecord,
  GameStartInfo,
  PlayerRecord,
  ServerMessage,
} from "../core/Schemas";
import {
  ErrorUpdate,
  GameUpdateType,
  GameUpdateViewData,
  HashUpdate,
  WinUpdate,
} from "../core/game/GameUpdates";
import { GameRenderer, createRenderer } from "./graphics/GameRenderer";
import { GameView, PlayerView } from "../core/game/GameView";
import { PlayerActions, UnitType } from "../core/game/Game";
import {
  SendAttackIntentEvent,
  SendBoatAttackIntentEvent,
  SendHashEvent,
  SendSpawnIntentEvent,
  SendUpgradeStructureIntentEvent,
  Transport,
  TurnDebtEvent,
} from "./Transport";
import { TerrainMapData, loadTerrainMap } from "../core/game/TerrainMapLoader";
import { endGame, startGame, startTime } from "./LocalPersistantStats";
import { CatchupMessage } from "./graphics/layers/CatchupMessage";
import { EventBus } from "../core/EventBus";
import { GameMapLoader } from "../core/game/GameMapLoader";
import { ServerConfig } from "../core/configuration/Config";
import { TileRef } from "../core/game/GameMap";
import { UserSettings } from "../core/game/UserSettings";
import { WorkerClient } from "../core/worker/WorkerClient";
import { createCanvas } from "./Utils";
import { createGameRecord } from "../core/Util";
import { getConfig } from "../core/configuration/ConfigLoader";
import { getPersistentID } from "./Main";
import { showErrorModal } from "./components/ErrorModal";
import { terrainMapFileLoader } from "./TerrainMapFileLoader";

export type LobbyConfig = {
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
};

export function joinLobby(
  eventBus: EventBus,
  lobbyConfig: LobbyConfig,
  onPrestart: () => void,
  onJoin: () => void,
): () => void {
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
      terrainLoad = loadTerrainMap(message.gameMap, terrainMapFileLoader);
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
        terrainMapFileLoader,
      ).then((r) => r.start());
    }
    if (message.type === "error") {
      showErrorModal(
        message.error,
        message.message,
        lobbyConfig.gameID,
        lobbyConfig.clientID,
        true,
        false,
        "error_modal.connection_error",
      );
    }
  };
  transport.connect(onconnect, onmessage);
  return () => {
    console.log("leaving game");
    transport.leaveGame();
  };
}

async function createClientGame(
  lobbyConfig: LobbyConfig,
  eventBus: EventBus,
  transport: Transport,
  userSettings: UserSettings,
  terrainLoad: Promise<TerrainMapData> | null,
  mapLoader: GameMapLoader,
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
    gameMap = await loadTerrainMap(
      lobbyConfig.gameStartInfo.config.gameMap,
      mapLoader,
    );
  }
  const worker = new WorkerClient(
    lobbyConfig.gameStartInfo,
    lobbyConfig.clientID,
  );
  await worker.initialize();
  const gameView = new GameView(
    worker,
    config,
    gameMap,
    lobbyConfig.clientID,
    lobbyConfig.gameStartInfo.gameID,
    lobbyConfig.gameStartInfo.players,
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

  // Turn debt tracking
  private turnsSeen = 0;
  private turnsProcessed = 0;
  private readonly turnDebtThreshold = 20;
  private readonly turnDebtExitThreshold = 5;
  private isInTurnDebt = false;
  private peakTurnDebt = 0;
  private readonly catchupMessage: CatchupMessage = new CatchupMessage();

  private hasJoined = false;

  private lastMousePosition: { x: number; y: number } | null = null;

  private lastMessageTime = 0;
  private connectionCheckInterval: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly lobby: LobbyConfig,
    private readonly eventBus: EventBus,
    private readonly renderer: GameRenderer,
    private readonly input: InputHandler,
    private readonly transport: Transport,
    private readonly worker: WorkerClient,
    private readonly gameView: GameView,
  ) {
    this.lastMessageTime = Date.now();
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

    if (this.lobby.gameStartInfo === undefined) {
      throw new Error("missing gameStartInfo");
    }
    const record = createGameRecord(
      this.lobby.gameStartInfo.gameID,
      this.lobby.gameStartInfo.config,
      players,
      // Not saving turns locally
      [],
      startTime() ?? 0,
      Date.now(),
      update.winner,
      this.lobby.serverConfig,
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
    this.eventBus.on(MouseUpEvent, this.inputEvent.bind(this));
    this.eventBus.on(MouseMoveEvent, this.onMouseMove.bind(this));
    this.eventBus.on(AutoUpgradeEvent, this.autoUpgradeEvent.bind(this));
    this.eventBus.on(
      DoBoatAttackEvent,
      this.doBoatAttackUnderCursor.bind(this),
    );
    this.eventBus.on(
      DoGroundAttackEvent,
      this.doGroundAttackUnderCursor.bind(this),
    );

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
      this.onTurnProcessed();

      if (gu.updates[GameUpdateType.Win].length > 0) {
        this.saveGame(gu.updates[GameUpdateType.Win][0]);
      }
    });
    const { worker } = this;
    const keepWorkerAlive = () => {
      if (this.isActive) {
        worker.sendHeartbeat();
        requestAnimationFrame(keepWorkerAlive);
      }
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
          false,
          "error_modal.desync_notice",
        );
      }
      if (message.type === "error") {
        showErrorModal(
          message.error,
          message.message,
          this.lobby.gameID,
          this.lobby.clientID,
          true,
          false,
          "error_modal.connection_error",
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

  public stop(saveFullGame = false) {
    if (!this.isActive) return;

    this.isActive = false;
    this.worker.cleanup();
    this.transport.leaveGame(saveFullGame);
    if (this.connectionCheckInterval) {
      clearInterval(this.connectionCheckInterval);
      this.connectionCheckInterval = null;
    }
    this.catchupMessage.hide();
  }

  private inputEvent(event: MouseUpEvent) {
    if (!this.isActive || this.isInTurnDebt) {
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
      this.eventBus.emit(new SendSpawnIntentEvent(tile));
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
        this.sendBoatAttackIntent(tile);
      }

      const owner = this.gameView.owner(tile);
      if (owner.isPlayer()) {
        this.gameView.setFocusedPlayer(owner);
      } else {
        this.gameView.setFocusedPlayer(null);
      }
    });
  }

  private autoUpgradeEvent(event: AutoUpgradeEvent) {
    if (!this.isActive || this.isInTurnDebt) {
      return;
    }

    const cell = this.renderer.transformHandler.screenToWorldCoordinates(
      event.x,
      event.y,
    );
    if (!this.gameView.isValidCoord(cell.x, cell.y)) {
      return;
    }

    const tile = this.gameView.ref(cell.x, cell.y);

    if (this.myPlayer === null) {
      const myPlayer = this.gameView.playerByClientID(this.lobby.clientID);
      if (myPlayer === null) return;
      this.myPlayer = myPlayer;
    }

    if (this.gameView.inSpawnPhase()) {
      return;
    }

    this.myPlayer.actions(tile).then((actions) => {
      const upgradeUnits: {
        unitId: number;
        unitType: UnitType;
        distance: number;
      }[] = [];

      for (const bu of actions.buildableUnits) {
        if (bu.canUpgrade !== false) {
          const existingUnit = this.gameView
            .units()
            .find((unit) => unit.id() === bu.canUpgrade);
          if (existingUnit) {
            const distance = this.gameView.manhattanDist(
              tile,
              existingUnit.tile(),
            );

            upgradeUnits.push({
              unitId: bu.canUpgrade,
              unitType: bu.type,
              distance,
            });
          }
        }
      }

      if (upgradeUnits.length > 0) {
        upgradeUnits.sort((a, b) => a.distance - b.distance);
        const bestUpgrade = upgradeUnits[0];

        this.eventBus.emit(
          new SendUpgradeStructureIntentEvent(
            bestUpgrade.unitId,
            bestUpgrade.unitType,
          ),
        );
      }
    });
  }

  private doBoatAttackUnderCursor(): void {
    const tile = this.getTileUnderCursor();
    if (tile === null || this.isInTurnDebt) {
      return;
    }

    if (this.myPlayer === null) {
      const myPlayer = this.gameView.playerByClientID(this.lobby.clientID);
      if (myPlayer === null) return;
      this.myPlayer = myPlayer;
    }

    this.myPlayer.actions(tile).then((actions) => {
      if (!actions.canAttack && this.canBoatAttack(actions, tile)) {
        this.sendBoatAttackIntent(tile);
      }
    });
  }

  private doGroundAttackUnderCursor(): void {
    const tile = this.getTileUnderCursor();
    if (tile === null || this.isInTurnDebt) {
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
      }
    });
  }

  private getTileUnderCursor(): TileRef | null {
    if (!this.isActive || !this.lastMousePosition) {
      return null;
    }
    if (this.gameView.inSpawnPhase()) {
      return null;
    }
    const cell = this.renderer.transformHandler.screenToWorldCoordinates(
      this.lastMousePosition.x,
      this.lastMousePosition.y,
    );
    if (!this.gameView.isValidCoord(cell.x, cell.y)) {
      return null;
    }
    return this.gameView.ref(cell.x, cell.y);
  }

  private canBoatAttack(actions: PlayerActions, tile: TileRef): boolean {
    const bu = actions.buildableUnits.find(
      (bu) => bu.type === UnitType.TransportShip,
    );
    if (bu === undefined) {
      console.warn("no transport ship buildable units");
      return false;
    }
    return (
      bu.canBuild !== false &&
      this.shouldBoat(tile, bu.canBuild) &&
      this.gameView.isLand(tile)
    );
  }

  private sendBoatAttackIntent(tile: TileRef) {
    if (!this.myPlayer || this.isInTurnDebt) return;

    this.myPlayer.bestTransportShipSpawn(tile).then((spawn: number | false) => {
      if (this.myPlayer === null) throw new Error("Not initialized");
      this.eventBus.emit(
        new SendBoatAttackIntentEvent(
          this.gameView.owner(tile).id(),
          tile,
          this.myPlayer.troops() * this.renderer.uiState.attackRatio,
          spawn === false ? null : spawn,
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
        this.gameView.setFocusedPlayer(owner);
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
        .sort((a, b) => a.distSquared - b.distSquared);

      if (units.length > 0) {
        this.gameView.setFocusedPlayer(units[0].unit.owner());
      } else {
        this.gameView.setFocusedPlayer(null);
      }
    }
  }

  private onConnectionCheck() {
    if (this.transport.isLocal) {
      return;
    }
    const now = Date.now();
    const timeSinceLastMessage = now - this.lastMessageTime;
    if (timeSinceLastMessage > 5000) {
      console.log(
        `No message from server for ${timeSinceLastMessage} ms, reconnecting`,
      );
      this.lastMessageTime = now;
      this.transport.reconnect();
    }
  }

  private onTurnProcessed() {
    const wasInDebt = this.isInTurnDebt;
    this.turnsProcessed++;
    const turnDebt = this.turnsSeen - this.turnsProcessed;
    this.isInTurnDebt = this.isInTurnDebt || turnDebt >= this.turnDebtThreshold;

    if (this.isInTurnDebt) {
      // +1 because peak was before this turn was processed
      this.peakTurnDebt = Math.max(turnDebt + 1, this.peakTurnDebt);
      const turnsLeft = turnDebt - this.turnDebtExitThreshold;
      const totalTurnsToProcess = this.peakTurnDebt - this.turnDebtExitThreshold;
      const progress = Math.round(
        ((totalTurnsToProcess - turnsLeft) / Math.max(totalTurnsToProcess, 1) * 100),
      );
      this.catchupMessage.show(progress);
    }

    if(turnDebt < this.turnDebtExitThreshold) {
      this.peakTurnDebt = 0;
      this.isInTurnDebt = false;
      this.catchupMessage.hide();
    }

    if (wasInDebt !== this.isInTurnDebt) {
      this.eventBus.emit(new TurnDebtEvent(this.isInTurnDebt));
    }
  }
}
