import { translateText } from "../client/Utils";
import { EventBus } from "../core/EventBus";
import {
  ClientID,
  GameID,
  GameRecord,
  GameStartInfo,
  PlayerCosmeticRefs,
  PlayerRecord,
  ServerMessage,
} from "../core/Schemas";
import { createPartialGameRecord, replacer } from "../core/Util";
import { ServerConfig } from "../core/configuration/Config";
import { getConfig } from "../core/configuration/ConfigLoader";
import { GameUpdates, PlayerActions, UnitType } from "../core/game/Game";
import { TileRef } from "../core/game/GameMap";
import { GameMapLoader } from "../core/game/GameMapLoader";
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
import {
  createSharedTileRingBuffers,
  createSharedTileRingViews,
  drainTileUpdates,
  SharedTileRingBuffers,
  SharedTileRingViews,
} from "../core/worker/SharedTileRing";
import { WorkerClient } from "../core/worker/WorkerClient";
import {
  AutoUpgradeEvent,
  BacklogStatusEvent,
  DoBoatAttackEvent,
  DoGroundAttackEvent,
  InputHandler,
  MouseMoveEvent,
  MouseUpEvent,
  TickMetricsEvent,
} from "./InputHandler";
import { endGame, startGame, startTime } from "./LocalPersistantStats";
import { getPersistentID } from "./Main";
import { terrainMapFileLoader } from "./TerrainMapFileLoader";
import {
  SendAttackIntentEvent,
  SendBoatAttackIntentEvent,
  SendHashEvent,
  SendSpawnIntentEvent,
  SendUpgradeStructureIntentEvent,
  Transport,
} from "./Transport";
import { createCanvas } from "./Utils";
import { createRenderer, GameRenderer } from "./graphics/GameRenderer";
import { GoToPlayerEvent } from "./graphics/layers/Leaderboard";
import SoundManager from "./sound/SoundManager";

export interface LobbyConfig {
  serverConfig: ServerConfig;
  cosmetics: PlayerCosmeticRefs;
  playerName: string;
  clientID: ClientID;
  gameID: GameID;
  token: string;
  turnstileToken: string | null;
  // GameStartInfo only exists when playing a singleplayer game.
  gameStartInfo?: GameStartInfo;
  // GameRecord exists when replaying an archived game.
  gameRecord?: GameRecord;
}

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

  let hasJoined = false;

  const onconnect = () => {
    if (hasJoined) {
      console.log("rejoining game");
      transport.rejoinGame(0);
    } else {
      hasJoined = true;
      console.log(`Joining game lobby ${lobbyConfig.gameID}`);
      transport.joinGame();
    }
  };
  let terrainLoad: Promise<TerrainMapData> | null = null;

  const onmessage = (message: ServerMessage) => {
    if (message.type === "prestart") {
      console.log(
        `lobby: game prestarting: ${JSON.stringify(message, replacer)}`,
      );
      terrainLoad = loadTerrainMap(
        message.gameMap,
        message.gameMapSize,
        terrainMapFileLoader,
      );
      onPrestart();
    }
    if (message.type === "start") {
      // Trigger prestart for singleplayer games
      onPrestart();
      console.log(
        `lobby: game started: ${JSON.stringify(message, replacer, 2)}`,
      );
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
      if (message.error === "full-lobby") {
        document.dispatchEvent(
          new CustomEvent("leave-lobby", {
            detail: { lobby: lobbyConfig.gameID },
            bubbles: true,
            composed: true,
          }),
        );
      } else {
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
      lobbyConfig.gameStartInfo.config.gameMapSize,
      mapLoader,
    );
  }

  let sharedTileRingBuffers: SharedTileRingBuffers | undefined;
  let sharedTileRingViews: SharedTileRingViews | null = null;
  const isIsolated =
    typeof (globalThis as any).crossOriginIsolated === "boolean"
      ? (globalThis as any).crossOriginIsolated === true
      : false;
  const canUseSharedBuffers =
    typeof SharedArrayBuffer !== "undefined" &&
    typeof Atomics !== "undefined" &&
    isIsolated;
  const sharedStateBuffer =
    canUseSharedBuffers && gameMap.sharedStateBuffer
      ? gameMap.sharedStateBuffer
      : undefined;
  const usesSharedTileState = !!sharedStateBuffer;

  if (canUseSharedBuffers) {
    // Capacity is number of tile updates that can be queued.
    // This is a compromise between memory usage and backlog tolerance.
    const TILE_RING_CAPACITY = 262144;
    sharedTileRingBuffers = createSharedTileRingBuffers(TILE_RING_CAPACITY);
    sharedTileRingViews = createSharedTileRingViews(sharedTileRingBuffers);
  }

  const worker = new WorkerClient(
    lobbyConfig.gameStartInfo,
    lobbyConfig.clientID,
    sharedTileRingBuffers,
    sharedStateBuffer,
  );
  await worker.initialize();
  const gameView = new GameView(
    worker,
    config,
    gameMap,
    lobbyConfig.clientID,
    lobbyConfig.gameStartInfo.gameID,
    lobbyConfig.gameStartInfo.players,
    usesSharedTileState,
  );

  const canvas = createCanvas();
  const gameRenderer = createRenderer(canvas, gameView, eventBus);

  console.log(
    `creating private game got difficulty: ${lobbyConfig.gameStartInfo.config.difficulty}`,
  );

  return new ClientGameRunner(
    lobbyConfig,
    eventBus,
    gameRenderer,
    new InputHandler(gameRenderer.uiState, canvas, eventBus),
    transport,
    worker,
    gameView,
    sharedTileRingViews,
  );
}

export class ClientGameRunner {
  private myPlayer: PlayerView | null = null;
  private isActive = false;

  private turnsSeen = 0;
  private lastMousePosition: { x: number; y: number } | null = null;

  private lastMessageTime: number = 0;
  private connectionCheckInterval: NodeJS.Timeout | null = null;
  private goToPlayerTimeout: NodeJS.Timeout | null = null;

  private lastTickReceiveTime: number = 0;
  private currentTickDelay: number | undefined = undefined;

  // Track how far behind the client simulation is compared to the server.
  private serverTurnHighWater: number = 0;
  private lastProcessedTick: number = 0;
  private backlogTurns: number = 0;
  private backlogGrowing: boolean = false;
  private lastRenderedTick: number = 0;
  private workerTicksSinceSample: number = 0;
  private renderTicksSinceSample: number = 0;
  private metricsSampleStart: number = 0;

  private pendingUpdates: GameUpdateViewData[] = [];
  private pendingStart = 0;
  private isProcessingUpdates = false;
  private tileRingViews: SharedTileRingViews | null;

  constructor(
    private lobby: LobbyConfig,
    private eventBus: EventBus,
    private renderer: GameRenderer,
    private input: InputHandler,
    private transport: Transport,
    private worker: WorkerClient,
    private gameView: GameView,
    tileRingViews: SharedTileRingViews | null,
  ) {
    this.lastMessageTime = Date.now();
    this.tileRingViews = tileRingViews;
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
    const record = createPartialGameRecord(
      this.lobby.gameStartInfo.gameID,
      this.lobby.gameStartInfo.config,
      players,
      // Not saving turns locally
      [],
      startTime(),
      Date.now(),
      update.winner,
      this.lobby.gameStartInfo.lobbyCreatedAt,
    );
    endGame(record);
  }

  public start() {
    SoundManager.playBackgroundMusic();
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
        this.stop();
        return;
      }
      this.pendingUpdates.push(gu);
      this.processPendingUpdates();
    });

    const onconnect = () => {
      console.log("Connected to game server!");
      this.transport.rejoinGame(this.turnsSeen);
    };
    const onmessage = (message: ServerMessage) => {
      this.lastMessageTime = Date.now();
      if (message.type === "start") {
        console.log("starting game! in client game runner");

        if (this.gameView.config().isRandomSpawn()) {
          const goToPlayer = () => {
            const myPlayer = this.gameView.myPlayer();

            if (this.gameView.inSpawnPhase() && !myPlayer?.hasSpawned()) {
              this.goToPlayerTimeout = setTimeout(goToPlayer, 1000);
              return;
            }

            if (!myPlayer) {
              return;
            }

            if (!this.gameView.inSpawnPhase() && !myPlayer.hasSpawned()) {
              showErrorModal(
                "spawn_failed",
                translateText("error_modal.spawn_failed.description"),
                this.lobby.gameID,
                this.lobby.clientID,
                true,
                false,
                translateText("error_modal.spawn_failed.title"),
              );
              return;
            }

            this.eventBus.emit(new GoToPlayerEvent(myPlayer));
          };

          goToPlayer();
        }

        for (const turn of message.turns) {
          this.serverTurnHighWater = Math.max(
            this.serverTurnHighWater,
            turn.turnNumber,
          );
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
        // Track when we receive the turn to calculate delay
        const now = Date.now();
        if (this.lastTickReceiveTime > 0) {
          // Calculate delay between receiving turn messages
          this.currentTickDelay = now - this.lastTickReceiveTime;
        }
        this.lastTickReceiveTime = now;

        this.serverTurnHighWater = Math.max(
          this.serverTurnHighWater,
          message.turn.turnNumber,
        );

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
    this.transport.updateCallback(onconnect, onmessage);
    console.log("sending join game");
    // Rejoin game from the start so we don't miss any turns.
    this.transport.rejoinGame(0);
  }

  public stop() {
    SoundManager.stopBackgroundMusic();
    if (!this.isActive) return;

    this.isActive = false;
    this.worker.cleanup();
    this.transport.leaveGame();
    if (this.connectionCheckInterval) {
      clearInterval(this.connectionCheckInterval);
      this.connectionCheckInterval = null;
    }
    if (this.goToPlayerTimeout) {
      clearTimeout(this.goToPlayerTimeout);
      this.goToPlayerTimeout = null;
    }
  }

  private processPendingUpdates() {
    const pendingCount = this.pendingUpdates.length - this.pendingStart;
    if (this.isProcessingUpdates || pendingCount <= 0) {
      return;
    }

    this.isProcessingUpdates = true;
    const processFrame = () => {
      const BASE_SLICE_BUDGET_MS = 8; // keep UI responsive while catching up
      const MAX_SLICE_BUDGET_MS = 1000; // allow longer slices when backlog is large
      const BACKLOG_FREE_TURNS = 10; // scaling starts at this many turns
      const BACKLOG_MAX_TURNS = 500; // MAX_SLICE_BUDGET_MS is reached at this many turns
      const MAX_TICKS_PER_SLICE = 1000;

      const backlogOverhead = Math.max(
        0,
        this.backlogTurns - BACKLOG_FREE_TURNS,
      );
      const backlogScale = Math.min(
        1,
        backlogOverhead / (BACKLOG_MAX_TURNS - BACKLOG_FREE_TURNS),
      );
      const sliceBudgetMs =
        BASE_SLICE_BUDGET_MS +
        backlogScale * (MAX_SLICE_BUDGET_MS - BASE_SLICE_BUDGET_MS);

      const frameStart = performance.now();
      const batch: GameUpdateViewData[] = [];
      let lastTickDuration: number | undefined;
      let lastTick: number | undefined;

      let processedCount = 0;

      // Consume updates until we hit the time budget or per-slice cap.
      while (this.pendingStart < this.pendingUpdates.length) {
        const gu = this.pendingUpdates[this.pendingStart++];
        processedCount++;
        this.workerTicksSinceSample++;
        batch.push(gu);

        this.transport.turnComplete();
        gu.updates[GameUpdateType.Hash].forEach((hu: HashUpdate) => {
          this.eventBus.emit(new SendHashEvent(hu.tick, hu.hash));
        });
        this.updateBacklogMetrics(gu.tick);

        if (gu.updates[GameUpdateType.Win].length > 0) {
          this.saveGame(gu.updates[GameUpdateType.Win][0]);
        }

        if (gu.tickExecutionDuration !== undefined) {
          lastTickDuration = gu.tickExecutionDuration;
        }
        lastTick = gu.tick;

        const elapsed = performance.now() - frameStart;
        if (processedCount >= MAX_TICKS_PER_SLICE || elapsed >= sliceBudgetMs) {
          break;
        }
      }

      // Compact the queue if we've advanced far into it.
      if (
        this.pendingStart > 0 &&
        (this.pendingStart > 1024 ||
          this.pendingStart >= this.pendingUpdates.length / 2)
      ) {
        this.pendingUpdates = this.pendingUpdates.slice(this.pendingStart);
        this.pendingStart = 0;
      }

      // Only update view and render when ALL processing is complete
      if (
        this.pendingStart >= this.pendingUpdates.length &&
        batch.length > 0 &&
        lastTick !== undefined
      ) {
        const combinedGu = this.mergeGameUpdates(batch);
        if (combinedGu) {
          this.gameView.update(combinedGu);
        }

        const ticksPerRender =
          this.lastRenderedTick === 0
            ? lastTick
            : lastTick - this.lastRenderedTick;
        this.lastRenderedTick = lastTick;

        this.renderTicksSinceSample++;

        let workerTicksPerSecond: number | undefined;
        let renderTicksPerSecond: number | undefined;
        const now = performance.now();
        if (this.metricsSampleStart === 0) {
          this.metricsSampleStart = now;
        } else {
          const elapsedSeconds = (now - this.metricsSampleStart) / 1000;
          if (elapsedSeconds > 0) {
            workerTicksPerSecond = this.workerTicksSinceSample / elapsedSeconds;
            renderTicksPerSecond = this.renderTicksSinceSample / elapsedSeconds;
          }
          this.metricsSampleStart = now;
          this.workerTicksSinceSample = 0;
          this.renderTicksSinceSample = 0;
        }

        this.renderer.tick();
        this.eventBus.emit(
          new TickMetricsEvent(
            lastTickDuration,
            this.currentTickDelay,
            this.backlogTurns,
            ticksPerRender,
            workerTicksPerSecond,
            renderTicksPerSecond,
          ),
        );

        // Reset tick delay for next measurement
        this.currentTickDelay = undefined;
      }

      if (this.pendingStart < this.pendingUpdates.length) {
        requestAnimationFrame(processFrame);
      } else {
        this.isProcessingUpdates = false;
      }
    };

    requestAnimationFrame(processFrame);
  }

  private mergeGameUpdates(
    batch: GameUpdateViewData[],
  ): GameUpdateViewData | null {
    if (batch.length === 0) {
      return null;
    }

    const last = batch[batch.length - 1];
    const combinedUpdates: GameUpdates = {} as GameUpdates;

    // Initialize combinedUpdates with empty arrays for each existing key
    for (const key in last.updates) {
      const type = Number(key) as GameUpdateType;
      combinedUpdates[type] = [];
    }

    const combinedPackedTileUpdates: bigint[] = [];

    for (const gu of batch) {
      for (const key in gu.updates) {
        const type = Number(key) as GameUpdateType;
        // We don't care about the specific update subtype here; just treat it
        // as an array we can concatenate.
        const updatesForType = gu.updates[type] as unknown as any[];
        (combinedUpdates[type] as unknown as any[]).push(...updatesForType);
      }
    }

    if (this.tileRingViews) {
      const MAX_TILE_UPDATES_PER_RENDER = 100000;
      const tileRefs: TileRef[] = [];
      drainTileUpdates(
        this.tileRingViews,
        MAX_TILE_UPDATES_PER_RENDER,
        tileRefs,
      );
      for (const ref of tileRefs) {
        combinedPackedTileUpdates.push(BigInt(ref));
      }
    } else {
      for (const gu of batch) {
        gu.packedTileUpdates.forEach((tu) => {
          combinedPackedTileUpdates.push(tu);
        });
      }
    }

    return {
      tick: last.tick,
      updates: combinedUpdates,
      packedTileUpdates: new BigUint64Array(combinedPackedTileUpdates),
      playerNameViewData: last.playerNameViewData,
      tickExecutionDuration: last.tickExecutionDuration,
    };
  }

  private updateBacklogMetrics(processedTick: number) {
    this.lastProcessedTick = processedTick;
    const previousBacklog = this.backlogTurns;
    this.backlogTurns = Math.max(
      0,
      this.serverTurnHighWater - this.lastProcessedTick,
    );
    this.backlogGrowing = this.backlogTurns > previousBacklog;
    this.eventBus.emit(
      new BacklogStatusEvent(this.backlogTurns, this.backlogGrowing),
    );
  }

  private inputEvent(event: MouseUpEvent) {
    if (!this.isActive || this.renderer.uiState.ghostStructure !== null) {
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
      this.gameView.inSpawnPhase() &&
      !this.gameView.config().isRandomSpawn()
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
      } else if (this.canAutoBoat(actions, tile)) {
        this.sendBoatAttackIntent(tile);
      }
    });
  }

  private autoUpgradeEvent(event: AutoUpgradeEvent) {
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

    const tile = this.gameView.ref(cell.x, cell.y);

    if (this.myPlayer === null) {
      const myPlayer = this.gameView.playerByClientID(this.lobby.clientID);
      if (myPlayer === null) return;
      this.myPlayer = myPlayer;
    }

    if (this.gameView.inSpawnPhase()) {
      return;
    }

    this.findAndUpgradeNearestBuilding(tile);
  }

  private findAndUpgradeNearestBuilding(clickedTile: TileRef) {
    this.myPlayer!.actions(clickedTile).then((actions) => {
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
              clickedTile,
              existingUnit.tile(),
            );

            upgradeUnits.push({
              unitId: bu.canUpgrade,
              unitType: bu.type,
              distance: distance,
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
    if (tile === null) {
      return;
    }

    if (this.myPlayer === null) {
      const myPlayer = this.gameView.playerByClientID(this.lobby.clientID);
      if (myPlayer === null) return;
      this.myPlayer = myPlayer;
    }

    this.myPlayer.actions(tile).then((actions) => {
      if (this.canBoatAttack(actions) !== false) {
        this.sendBoatAttackIntent(tile);
      }
    });
  }

  private doGroundAttackUnderCursor(): void {
    const tile = this.getTileUnderCursor();
    if (tile === null) {
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

  private canBoatAttack(actions: PlayerActions): false | TileRef {
    const bu = actions.buildableUnits.find(
      (bu) => bu.type === UnitType.TransportShip,
    );
    if (bu === undefined) {
      console.warn(`no transport ship buildable units`);
      return false;
    }
    return bu.canBuild;
  }

  private sendBoatAttackIntent(tile: TileRef) {
    if (!this.myPlayer) return;

    this.myPlayer.bestTransportShipSpawn(tile).then((spawn: number | false) => {
      if (this.myPlayer === null) throw new Error("not initialized");
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

  private canAutoBoat(actions: PlayerActions, tile: TileRef): boolean {
    if (!this.gameView.isLand(tile)) return false;

    const canBuild = this.canBoatAttack(actions);
    if (canBuild === false) return false;

    // TODO: Global enable flag
    // TODO: Global limit autoboat to nearby shore flag
    // if (!enableAutoBoat) return false;
    // if (!limitAutoBoatNear) return true;
    const distanceSquared = this.gameView.euclideanDistSquared(tile, canBuild);
    const limit = 100;
    const limitSquared = limit * limit;
    return distanceSquared < limitSquared;
  }

  private onMouseMove(event: MouseMoveEvent) {
    this.lastMousePosition = { x: event.x, y: event.y };
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
}

function showErrorModal(
  error: string,
  message: string | undefined,
  gameID: GameID,
  clientID: ClientID,
  closable = false,
  showDiscord = true,
  heading = "error_modal.crashed",
) {
  if (document.querySelector("#error-modal")) {
    return;
  }

  const modal = document.createElement("div");
  modal.id = "error-modal";

  const content = [
    showDiscord ? translateText("error_modal.paste_discord") : null,
    translateText(heading),
    `game id: ${gameID}`,
    `client id: ${clientID}`,
    `Error: ${error}`,
    message ? `Message: ${message}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  // Create elements
  const pre = document.createElement("pre");
  pre.textContent = content;

  const button = document.createElement("button");
  button.textContent = translateText("error_modal.copy_clipboard");
  button.className = "copy-btn";
  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(content);
      button.textContent = translateText("error_modal.copied");
    } catch {
      button.textContent = translateText("error_modal.failed_copy");
    }
  });

  // Add to modal
  modal.appendChild(pre);
  modal.appendChild(button);
  if (closable) {
    const closeButton = document.createElement("button");
    closeButton.textContent = "X";
    closeButton.className = "close-btn";
    closeButton.addEventListener("click", () => {
      modal.remove();
    });
    modal.appendChild(closeButton);
  }

  document.body.appendChild(modal);
}
