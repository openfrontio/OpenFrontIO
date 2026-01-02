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
import { PlayerActions, UnitType } from "../core/game/Game";
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
import { WorkerClient } from "../core/worker/WorkerClient";
import { getPersistentID } from "./Auth";
import {
  AutoUpgradeEvent,
  DoBoatAttackEvent,
  DoGroundAttackEvent,
  InputHandler,
  MouseMoveEvent,
  MouseUpEvent,
  TickMetricsEvent,
} from "./InputHandler";
import { endGame, startGame, startTime } from "./LocalPersistantStats";
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

  private async saveGame(update: WinUpdate) {
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
      this.transport.turnComplete();
      gu.updates[GameUpdateType.Hash].forEach((hu: HashUpdate) => {
        this.eventBus.emit(new SendHashEvent(hu.tick, hu.hash));
      });
      this.gameView.update(gu);
      this.renderer.tick();

      // Emit tick metrics event for performance overlay
      this.eventBus.emit(
        new TickMetricsEvent(gu.tickExecutionDuration, this.currentTickDelay),
      );

      // Reset tick delay for next measurement
      this.currentTickDelay = undefined;

      if (gu.updates[GameUpdateType.Win].length > 0) {
        this.saveGame(gu.updates[GameUpdateType.Win][0]);
      }
    });

    const worker = this.worker;
    const keepWorkerAlive = () => {
      if (this.isActive) {
        worker.sendHeartbeat();
        requestAnimationFrame(keepWorkerAlive);
      }
    };
    requestAnimationFrame(keepWorkerAlive);

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

        if (this.turnsSeen !== message.turn.turnNumber) {
          console.error(
            `got wrong turn have turns ${this.turnsSeen}, received turn ${message.turn.turnNumber}`,
          );
        } else {
          this.worker.sendTurn(
            // Filter out pause intents in replays
            this.gameView.config().isReplay()
              ? {
                  ...message.turn,
                  intents: message.turn.intents.filter(
                    (i) => i.type !== "toggle_pause",
                  ),
                }
              : message.turn,
          );
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
