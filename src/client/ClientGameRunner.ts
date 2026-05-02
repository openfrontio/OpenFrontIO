import { translateText } from "../client/Utils";
import { EventBus } from "../core/EventBus";
import {
  ClientID,
  GameID,
  GameRecord,
  GameStartInfo,
  LobbyInfoEvent,
  PlayerCosmeticRefs,
  PlayerRecord,
  ServerMessage,
} from "../core/Schemas";
import { createPartialGameRecord, findClosestBy, replacer } from "../core/Util";
import { ServerConfig } from "../core/configuration/Config";
import { getGameLogicConfig } from "../core/configuration/ConfigLoader";
import { BuildableUnit, Structures, UnitType } from "../core/game/Game";
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
  DoBreakAllianceEvent,
  DoGroundAttackEvent,
  DoRequestAllianceEvent,
  InputHandler,
  MouseMoveEvent,
  MouseUpEvent,
  TickMetricsEvent,
} from "./InputHandler";
import { endGame, startGame, startTime } from "./LocalPersistantStats";
import { terrainMapFileLoader } from "./TerrainMapFileLoader";
import {
  SendAllianceRequestIntentEvent,
  SendAttackIntentEvent,
  SendBoatAttackIntentEvent,
  SendBreakAllianceIntentEvent,
  SendHashEvent,
  SendSpawnIntentEvent,
  SendUpgradeStructureIntentEvent,
  Transport,
} from "./Transport";
import { createCanvas } from "./Utils";
import { createRenderer, GameRenderer } from "./graphics/GameRenderer";
import { GoToPlayerEvent } from "./graphics/TransformHandler";
import { SoundManager } from "./sound/SoundManager";

export interface LobbyConfig {
  serverConfig: ServerConfig;
  cosmetics: PlayerCosmeticRefs;
  playerName: string;
  playerClanTag: string | null;
  playerRole: string | null;
  gameID: GameID;
  turnstileToken: string | null;
  // GameStartInfo only exists when playing a singleplayer game.
  gameStartInfo?: GameStartInfo;
  // GameRecord exists when replaying an archived game.
  gameRecord?: GameRecord;
}

export interface JoinLobbyResult {
  stop: (force?: boolean) => boolean;
  prestart: Promise<void>;
  join: Promise<void>;
}

export function joinLobby(
  eventBus: EventBus,
  lobbyConfig: LobbyConfig,
): JoinLobbyResult {
  // Mutable clientID state — assigned by server (multiplayer) or derived from gameStartInfo (singleplayer)
  let clientID: ClientID | undefined;

  let resolvePrestart: () => void;
  let resolveJoin: () => void;
  const prestartPromise = new Promise<void>((r) => (resolvePrestart = r));
  const joinPromise = new Promise<void>((r) => (resolveJoin = r));

  console.log(`joining lobby: gameID: ${lobbyConfig.gameID}`);

  const userSettings: UserSettings = new UserSettings();
  startGame(lobbyConfig.gameID, lobbyConfig.gameStartInfo?.config ?? {});

  const transport = new Transport(lobbyConfig, eventBus);

  let currentGameRunner: ClientGameRunner | null = null;

  const onconnect = () => {
    // Always send join - server will detect reconnection via persistentID
    console.log(`Joining game lobby ${lobbyConfig.gameID}`);
    transport.joinGame();
  };
  let terrainLoad: Promise<TerrainMapData> | null = null;

  const onmessage = (message: ServerMessage) => {
    if (message.type === "lobby_info") {
      // Server tells us our assigned clientID
      clientID = message.myClientID;
      eventBus.emit(new LobbyInfoEvent(message.lobby, message.myClientID));
      return;
    }
    if (message.type === "prestart") {
      console.log(
        `lobby: game prestarting: ${JSON.stringify(message, replacer)}`,
      );
      terrainLoad = loadTerrainMap(
        message.gameMap,
        message.gameMapSize,
        terrainMapFileLoader,
      );
      resolvePrestart();
    }
    if (message.type === "start") {
      // Trigger prestart for singleplayer games
      resolvePrestart();
      console.log(
        `lobby: game started: ${JSON.stringify(message, replacer, 2)}`,
      );
      // Server tells us our assigned clientID (also sent on start for late joins)
      clientID = message.myClientID;
      resolveJoin();
      // For multiplayer games, GameStartInfo is not known until game starts.
      lobbyConfig.gameStartInfo = message.gameStartInfo;
      createClientGame(
        lobbyConfig,
        clientID,
        eventBus,
        transport,
        userSettings,
        terrainLoad,
        terrainMapFileLoader,
      )
        .then((r) => {
          currentGameRunner = r;
          r.start();
        })
        .catch((e) => {
          console.error("error creating client game", e);

          currentGameRunner = null;

          const startingModal = document.querySelector(
            "game-starting-modal",
          ) as HTMLElement;
          if (startingModal) {
            startingModal.classList.add("hidden");
          }
          showErrorModal(
            e.message,
            e.stack,
            lobbyConfig.gameID,
            clientID,
            true,
            false,
            "error_modal.connection_error",
          );
        });
    }
    if (message.type === "error") {
      if (message.error === "full-lobby") {
        document.dispatchEvent(
          new CustomEvent("leave-lobby", {
            detail: { lobby: lobbyConfig.gameID, cause: "full-lobby" },
            bubbles: true,
            composed: true,
          }),
        );
      } else if (message.error === "kick_reason.host_left") {
        alert(translateText("kick_reason.host_left"));
        document.dispatchEvent(
          new CustomEvent("leave-lobby", {
            detail: { lobby: lobbyConfig.gameID, cause: "host-left" },
            bubbles: true,
            composed: true,
          }),
        );
      } else {
        showErrorModal(
          message.error,
          message.message,
          lobbyConfig.gameID,
          clientID,
          true,
          false,
          "error_modal.connection_error",
        );
      }
    }
  };
  transport.connect(onconnect, onmessage);
  return {
    stop: (force: boolean = false) => {
      if (!force && currentGameRunner?.shouldPreventWindowClose()) {
        console.log("Player is active, prevent leaving game");
        return false;
      }
      console.log("leaving game");
      if (currentGameRunner) {
        currentGameRunner.stop();
        currentGameRunner = null;
      } else {
        transport.leaveGame();
      }
      return true;
    },
    prestart: prestartPromise,
    join: joinPromise,
  };
}

async function createClientGame(
  lobbyConfig: LobbyConfig,
  clientID: ClientID | undefined,
  eventBus: EventBus,
  transport: Transport,
  userSettings: UserSettings,
  terrainLoad: Promise<TerrainMapData> | null,
  mapLoader: GameMapLoader,
): Promise<ClientGameRunner> {
  if (lobbyConfig.gameStartInfo === undefined) {
    throw new Error("missing gameStartInfo");
  }
  const config = await getGameLogicConfig(
    lobbyConfig.gameStartInfo.config,
    userSettings,
    lobbyConfig.gameRecord !== undefined,
  );
  let gameMap: TerrainMapData;

  if (terrainLoad) {
    gameMap = await terrainLoad;
  } else {
    gameMap = await loadTerrainMap(
      lobbyConfig.gameStartInfo.config.gameMap,
      lobbyConfig.gameStartInfo.config.gameMapSize,
      mapLoader,
    );
  }
  const worker = new WorkerClient(lobbyConfig.gameStartInfo, clientID);
  await worker.initialize();
  const gameView = new GameView(
    worker,
    config,
    gameMap,
    clientID,
    lobbyConfig.playerName,
    lobbyConfig.playerClanTag,
    lobbyConfig.gameStartInfo.gameID,
    lobbyConfig.gameStartInfo.players,
  );

  const canvas = createCanvas();
  const soundManager = new SoundManager(eventBus, userSettings);
  try {
    const gameRenderer = createRenderer(
      canvas,
      gameView,
      eventBus,
      lobbyConfig.playerRole,
    );

    console.log(
      `creating private game got difficulty: ${lobbyConfig.gameStartInfo.config.difficulty}`,
    );

    return new ClientGameRunner(
      lobbyConfig,
      clientID,
      eventBus,
      gameRenderer,
      new InputHandler(gameView, gameRenderer.uiState, canvas, eventBus),
      transport,
      worker,
      gameView,
      soundManager,
    );
  } catch (err) {
    soundManager.dispose();
    throw err;
  }
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
    private clientID: ClientID | undefined,
    private eventBus: EventBus,
    private renderer: GameRenderer,
    private input: InputHandler,
    private transport: Transport,
    private worker: WorkerClient,
    private gameView: GameView,
    private soundManager: SoundManager,
  ) {
    this.lastMessageTime = Date.now();
  }

  /**
   * Determines whether window closing should be prevented.
   *
   * Used to show a confirmation dialog when the user attempts to close
   * the window or navigate away during an active game session.
   *
   * @returns {boolean} `true` if the window close should be prevented
   * (when the player is alive in the game), `false` otherwise
   * (when the player is not alive or doesn't exist)
   */
  public shouldPreventWindowClose(): boolean {
    // Show confirmation dialog if player is alive in the game
    return !!this.myPlayer?.isAlive();
  }

  private async saveGame(update: WinUpdate) {
    if (!this.clientID) {
      return;
    }
    const players: PlayerRecord[] = [
      {
        persistentID: getPersistentID(),
        username: this.lobby.playerName,
        clanTag: this.lobby.playerClanTag ?? null,
        clientID: this.clientID,
        stats: update.allPlayersStats[this.clientID],
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
      this.lobby.gameStartInfo.visibleAt,
    );
    endGame(record);
  }

  public start() {
    this.soundManager.playBackgroundMusic();
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
    this.eventBus.on(
      DoRequestAllianceEvent,
      this.doRequestAllianceUnderCursor.bind(this),
    );
    this.eventBus.on(
      DoBreakAllianceEvent,
      this.doBreakAllianceUnderCursor.bind(this),
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
          this.clientID,
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

    const onconnect = () => {
      console.log("Connected to game server!");
      this.transport.rejoinGame(this.turnsSeen);
    };

    let hasGoneToPlayer = false;
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
                this.clientID,
                true,
                false,
                translateText("error_modal.spawn_failed.title"),
              );
              return;
            }

            this.eventBus.emit(new GoToPlayerEvent(myPlayer, 10));
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
          this.clientID,
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
          this.clientID,
          true,
          false,
          "error_modal.connection_error",
        );
      }
      if (message.type === "turn") {
        if (
          !this.gameView.inSpawnPhase() &&
          !hasGoneToPlayer &&
          this.gameView.myPlayer()
        ) {
          hasGoneToPlayer = true;
          this.eventBus.emit(new GoToPlayerEvent(this.gameView.myPlayer()!, 8));
        }

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
    this.soundManager.dispose();
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
      if (!this.clientID) return;
      const myPlayer = this.gameView.playerByClientID(this.clientID);
      if (myPlayer === null) return;
      this.myPlayer = myPlayer;
    }
    this.myPlayer.actions(tile, [UnitType.TransportShip]).then((actions) => {
      if (actions.canAttack) {
        this.eventBus.emit(
          new SendAttackIntentEvent(
            this.gameView.owner(tile).id(),
            this.myPlayer!.troops() * this.renderer.uiState.attackRatio,
          ),
        );
      } else if (this.canAutoBoat(actions.buildableUnits, tile)) {
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
      if (!this.clientID) return;
      const myPlayer = this.gameView.playerByClientID(this.clientID);
      if (myPlayer === null) return;
      this.myPlayer = myPlayer;
    }

    if (this.gameView.inSpawnPhase()) {
      return;
    }

    this.findAndUpgradeNearestBuilding(tile);
  }

  private findAndUpgradeNearestBuilding(clickedTile: TileRef) {
    this.myPlayer!.actions(clickedTile, Structures.types).then((actions) => {
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

      if (upgradeUnits.length === 0) {
        return;
      }

      // Upgrade the closest affordable building. But if there's an unaffordable
      // building (any type) that's closer to clickedTile than the best candidate,
      // do nothing — the player clicked on that unaffordable building intending
      // to upgrade it, and we must not spend their gold on a different building.
      const bestUpgrade = findClosestBy(upgradeUnits, (u) => u.distance);
      if (!bestUpgrade) {
        return;
      }

      // Check if any unaffordable building is closer than bestUpgrade
      for (const bu of actions.buildableUnits) {
        if (bu.canUpgrade === false && bu.type !== bestUpgrade.unitType) {
          const myPlayerID = this.myPlayer!.id();
          const closestOfType = this.gameView
            .nearbyUnits(
              clickedTile,
              this.gameView.config().structureMinDist(),
              bu.type,
            )
            .filter(({ unit }) => unit.owner().id() === myPlayerID)
            .sort((a, b) => a.distSquared - b.distSquared)[0];

          if (closestOfType) {
            const dist = this.gameView.manhattanDist(
              clickedTile,
              closestOfType.unit.tile(),
            );
            if (dist <= bestUpgrade.distance) {
              // An unaffordable building of type bu.type is at least as close
              // as bestUpgrade — player clicked on it, not on bestUpgrade.
              return;
            }
          }
        }
      }

      this.eventBus.emit(
        new SendUpgradeStructureIntentEvent(
          bestUpgrade.unitId,
          bestUpgrade.unitType,
        ),
      );
    });
  }

  private doBoatAttackUnderCursor(): void {
    const tile = this.getTileUnderCursor();
    if (tile === null) {
      return;
    }

    if (this.myPlayer === null) {
      if (!this.clientID) return;
      const myPlayer = this.gameView.playerByClientID(this.clientID);
      if (myPlayer === null) return;
      this.myPlayer = myPlayer;
    }

    this.myPlayer
      .buildables(tile, [UnitType.TransportShip])
      .then((buildables) => {
        if (this.canBoatAttack(buildables) !== false) {
          this.sendBoatAttackIntent(tile);
        } else {
          console.warn(
            "Boat attack triggered but can't send Transport Ship to tile",
          );
        }
      });
  }

  private doGroundAttackUnderCursor(): void {
    const tile = this.getTileUnderCursor();
    if (tile === null) {
      return;
    }

    if (this.myPlayer === null) {
      if (!this.clientID) return;
      const myPlayer = this.gameView.playerByClientID(this.clientID);
      if (myPlayer === null) return;
      this.myPlayer = myPlayer;
    }

    this.myPlayer.actions(tile, null).then((actions) => {
      if (actions.canAttack) {
        this.eventBus.emit(
          new SendAttackIntentEvent(
            this.gameView.owner(tile).id(),
            this.myPlayer!.troops() * this.renderer.uiState.attackRatio,
          ),
        );
      }
    });
  }

  private doRequestAllianceUnderCursor(): void {
    const tile = this.getTileUnderCursor();
    if (tile === null) return;

    if (this.myPlayer === null) {
      if (!this.clientID) return;
      const myPlayer = this.gameView.playerByClientID(this.clientID);
      if (myPlayer === null) return;
      this.myPlayer = myPlayer;
    }

    const myPlayer = this.myPlayer;

    const tileOwner = this.gameView.owner(tile);
    if (!tileOwner.isPlayer()) return;
    const recipient = tileOwner as PlayerView;

    myPlayer.actions(tile).then((actions) => {
      if (actions.interaction?.canSendAllianceRequest) {
        this.eventBus.emit(
          new SendAllianceRequestIntentEvent(myPlayer, recipient),
        );
      }
    });
  }

  private doBreakAllianceUnderCursor(): void {
    const tile = this.getTileUnderCursor();
    if (tile === null) return;

    if (this.myPlayer === null) {
      if (!this.clientID) return;
      const myPlayer = this.gameView.playerByClientID(this.clientID);
      if (myPlayer === null) return;
      this.myPlayer = myPlayer;
    }

    const myPlayer = this.myPlayer;

    const tileOwner = this.gameView.owner(tile);
    if (!tileOwner.isPlayer()) return;
    const recipient = tileOwner as PlayerView;

    myPlayer.actions(tile).then((actions) => {
      if (actions.interaction?.canBreakAlliance) {
        this.eventBus.emit(
          new SendBreakAllianceIntentEvent(myPlayer, recipient),
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

  private canBoatAttack(buildables: BuildableUnit[]): false | TileRef {
    const bu = buildables.find((bu) => bu.type === UnitType.TransportShip);
    return bu?.canBuild ?? false;
  }

  private sendBoatAttackIntent(tile: TileRef) {
    if (!this.myPlayer) return;

    this.eventBus.emit(
      new SendBoatAttackIntentEvent(
        tile,
        this.myPlayer.troops() * this.renderer.uiState.attackRatio,
      ),
    );
  }

  private canAutoBoat(buildables: BuildableUnit[], tile: TileRef): boolean {
    if (!this.gameView.isLand(tile)) return false;

    const canBuild = this.canBoatAttack(buildables);
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
  clientID: ClientID | undefined,
  closable = false,
  showDiscord = true,
  heading = "error_modal.crashed",
) {
  if (document.querySelector("#error-modal")) {
    return;
  }

  const translatedError = translateText(error);
  const displayError = translatedError === error ? error : translatedError;

  const modal = document.createElement("div");
  modal.id = "error-modal";

  const content = [
    showDiscord ? translateText("error_modal.paste_discord") : null,
    translateText(heading),
    `game id: ${gameID}`,
    `client id: ${clientID}`,
    `Error: ${displayError}`,
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
