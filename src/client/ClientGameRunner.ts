import { Config } from "src/core/configuration/Config";
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
import {
  BuildableUnit,
  PlayerType,
  Structures,
  UnitType,
} from "../core/game/Game";
import { TileRef } from "../core/game/GameMap";
import { GameMapLoader } from "../core/game/GameMapLoader";
import {
  ErrorUpdate,
  GameUpdateType,
  GameUpdateViewData,
  HashUpdate,
  WinUpdate,
} from "../core/game/GameUpdates";
import { loadTerrainMap, TerrainMapData } from "../core/game/TerrainMapLoader";
import {
  GRAPHICS_KEY,
  USER_SETTINGS_CHANGED_EVENT,
  UserSettings,
} from "../core/game/UserSettings";
import { WorkerClient } from "../core/worker/WorkerClient";
import { getPersistentID } from "./Auth";
import {
  AutoUpgradeEvent,
  DoBoatAttackEvent,
  DoBreakAllianceEvent,
  DoGroundAttackEvent,
  DoRequestAllianceEvent,
  DoRetaliateAttackEvent,
  InputHandler,
  MouseMoveEvent,
  MouseUpEvent,
  TickMetricsEvent,
  ToggleRenderDebugGuiEvent,
} from "./InputHandler";
import { endGame, startGame, startTime } from "./LocalPersistantStats";
import { terrainMapFileLoader } from "./TerrainMapFileLoader";
import { GoToPlayerEvent } from "./TransformHandler";
import {
  MoveWarshipIntentEvent,
  SendAllianceExtensionIntentEvent,
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
import { WebGLFrameBuilder } from "./WebGLFrameBuilder";
import { createRenderer, GameRenderer } from "./hud/GameRenderer";
import {
  applyGraphicsOverrides,
  createRenderSettings,
  deepAssign,
  MapRenderer,
  preloadAtlasData,
  renderDpr,
  type RenderSettings,
} from "./render/gl";
import { ALL_UNIT_TYPES, UnitState } from "./render/types";
import { SoundManager } from "./sound/SoundManager";
import { themeProvider } from "./theme/ThemeProvider";
import { GameView, PlayerView } from "./view";

export interface LobbyConfig {
  cosmetics: PlayerCosmeticRefs;
  playerName: string;
  playerClanTag: string | null;
  // In-flight clan-tag ownership check; resolves to the tag to submit (null if
  // it failed). Runs parallel to the WS handshake — only the join waits on it.
  clanTagCheck?: Promise<string | null>;
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
  themeProvider.reset(); // fresh colour allocators for this game
  startGame(lobbyConfig.gameID, lobbyConfig.gameStartInfo?.config ?? {});

  const transport = new Transport(lobbyConfig, eventBus);

  let currentGameRunner: ClientGameRunner | null = null;

  const onconnect = async () => {
    // Drop the tag if the ownership check failed; the server re-checks anyway.
    if (lobbyConfig.clanTagCheck !== undefined) {
      lobbyConfig.playerClanTag = await lobbyConfig.clanTagCheck;
    }
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

// Build the WebGL view + its glCanvas. Must run before createRenderer so the
// controllers can be wired directly to the view.
function createWebGLView(
  terrainMap: TerrainMapData,
  config: Config,
  settings: RenderSettings,
): {
  view: MapRenderer;
  glCanvas: HTMLCanvasElement;
  cachedWebGLFrameCallback: { current: FrameRequestCallback | null };
} {
  const gameMap = terrainMap.gameMap;
  const mapWidth = gameMap.width();
  const mapHeight = gameMap.height();

  const terrainBytes = new Uint8Array(mapWidth * mapHeight);
  for (let y = 0; y < mapHeight; y++) {
    for (let x = 0; x < mapWidth; x++) {
      terrainBytes[y * mapWidth + x] = gameMap.terrainByte(gameMap.ref(x, y));
    }
  }

  const glCanvas = createCanvas();
  glCanvas.id = "webgl-debug-canvas";
  glCanvas.style.pointerEvents = "none";
  document.body.insertBefore(glCanvas, document.body.firstChild);

  // Capture the WebGL renderer's animation-frame callback rather than letting
  // it run its own RAF loop. Two independent RAF loops race: when the user
  // pans, the WebGL renderer can draw with one-frame-stale camera state
  // because its RAF fires before canvas2D's RAF (which would have synced the
  // camera). Driving WebGL's draw synchronously from canvas2D's onPreRender
  // hook locks them to the same frame.
  const cachedWebGLFrameCallback: { current: FrameRequestCallback | null } = {
    current: null,
  };
  const captureRaf = (cb: FrameRequestCallback): number => {
    cachedWebGLFrameCallback.current = cb;
    return 0;
  };
  const captureCaf = (_id: number): void => {
    cachedWebGLFrameCallback.current = null;
  };

  const palette = new Float32Array(4096 * 2 * 4);
  const view = new MapRenderer(
    glCanvas,
    {
      mapWidth,
      mapHeight,
      unitTypes: [...ALL_UNIT_TYPES],
      players: [],
      // Pre-allocate renderer textures for up to 1024 players. We add players
      // dynamically via view.addPlayers() as they come in from the simulation,
      // but the NamePass / palette / relation matrix all need a static upper
      // bound at construction time.
      maxPlayers: 1024,
    },
    terrainBytes,
    palette,
    config,
    settings,
    captureRaf,
    captureCaf,
  );

  (window as unknown as { __webglView?: unknown }).__webglView = view;

  return { view, glCanvas, cachedWebGLFrameCallback };
}

function mountWebGLFrameLoop(
  terrainMap: TerrainMapData,
  view: MapRenderer,
  glCanvas: HTMLCanvasElement,
  cachedWebGLFrameCallback: { current: FrameRequestCallback | null },
  transformHandler: import("./TransformHandler").TransformHandler,
  gameView: GameView,
  eventBus: EventBus,
): { builder: WebGLFrameBuilder; stopFrameLoop: () => void } {
  const gameMap = terrainMap.gameMap;
  const mapWidth = gameMap.width();
  const mapHeight = gameMap.height();

  // Cache canvas dimensions to avoid forced reflows every frame. Reading
  // clientWidth/clientHeight flushes pending layout — at 60fps that's a
  // measurable cost. Only update on resize events from the observer.
  let cachedCanvasW = glCanvas.clientWidth;
  let cachedCanvasH = glCanvas.clientHeight;
  const resizeObs = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) {
        cachedCanvasW = width;
        cachedCanvasH = height;
      }
    }
  });
  resizeObs.observe(glCanvas);

  const syncCamera = (): void => {
    const scale = transformHandler.scale;
    const dpr = renderDpr();
    const centerX =
      transformHandler.offsetX +
      mapWidth / 2 +
      (cachedCanvasW - mapWidth) / (2 * scale);
    const centerY =
      transformHandler.offsetY +
      mapHeight / 2 +
      (cachedCanvasH - mapHeight) / (2 * scale);
    view.setCameraState(centerX, centerY, scale * dpr);
    // Invoke the WebGL renderer's frame callback synchronously, with the just-
    // updated camera state. The callback re-arms itself via captureRaf, so
    // we'll get a fresh callback ready for the next canvas2D frame.
    const cb = cachedWebGLFrameCallback.current;
    cachedWebGLFrameCallback.current = null;
    cb?.(performance.now());
  };

  // Move-target chevrons: when the player issues a warship move, show the
  // animated chevron pass at the target tile. The renderer needs the target's
  // tile x/y and the warship's owner smallID (so the chevrons use the right
  // color).
  eventBus.on(MoveWarshipIntentEvent, (e) => {
    const tile = e.tile;
    const tx = gameView.x(tile);
    const ty = gameView.y(tile);
    // Resolve owner via the first unit in the move set.
    const firstUnit = gameView.unit(e.unitIds[0]);
    if (firstUnit === undefined) return;
    view.showMoveIndicator(tx, ty, firstUnit.owner().smallID());
  });

  // Self-driving RAF: syncCamera reads the latest camera state from
  // TransformHandler, pushes it to WebGL, and synchronously invokes the
  // renderer's captured frame callback (which draws). One RAF = one
  // synchronized camera-update + WebGL render.
  let rafId: number | null = null;
  const driveFrame = (): void => {
    syncCamera();
    rafId = requestAnimationFrame(driveFrame);
  };
  rafId = requestAnimationFrame(driveFrame);

  // Tear down the per-frame loop so a stopped game stops driving WebGL and
  // releases the view for disposal. Left running, the RAF keeps the WebGL
  // context referenced (and alive) forever — each new game would then stack
  // another context until the browser's limit is hit.
  const stopFrameLoop = (): void => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    resizeObs.disconnect();
  };

  const builder = new WebGLFrameBuilder(view);

  // When context is lost and restored, WebGL loses all textures and geometry.
  // Force a full re-upload of the simulation state.
  view.onContextRestored = () => {
    builder.clearCaches();

    // Full upload of terrain, territory & trail state
    const mapSize = mapWidth * mapHeight;
    const allRefs = new Array(mapSize);
    const allTerrain = new Uint8Array(mapSize);
    for (let i = 0; i < mapSize; i++) {
      allRefs[i] = i;
      allTerrain[i] = gameView.terrainByte(i);
    }
    view.applyTerrainDelta(allRefs, allTerrain);

    const frameData = gameView.frameData();
    view.uploadTileAndTrailState(frameData.tileState, frameData.trailState);

    // Structures, railroads and relations normally skip GPU upload unless
    // marked dirty, now force
    view.updateStructures(frameData.units as Map<number, UnitState>);
    view.uploadRailroadState(frameData.railroadState);
    view.updateRelations(frameData.relationMatrix, frameData.relationSize);

    builder.update(gameView);
  };

  return { builder, stopFrameLoop };
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
  const config = new Config(
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
  // Kick off the font-atlas fetch so it overlaps with worker init; the
  // render passes need it parsed before createWebGLView runs.
  const atlasDataLoad = preloadAtlasData();
  const worker = new WorkerClient(lobbyConfig.gameStartInfo, clientID);
  await worker.initialize();
  await atlasDataLoad;
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

  // Transparent fullscreen overlay used purely as the pointer-event /
  // bounding-rect target for InputHandler + TransformHandler. The actual
  // map drawing happens on the WebGL canvas created in createWebGLView.
  const inputOverlay = document.createElement("div");
  inputOverlay.id = "game-input-overlay";
  inputOverlay.style.position = "fixed";
  inputOverlay.style.left = "0";
  inputOverlay.style.top = "0";
  inputOverlay.style.width = "100%";
  inputOverlay.style.height = "100%";
  inputOverlay.style.touchAction = "none";
  document.body.appendChild(inputOverlay);

  const soundManager = new SoundManager(eventBus, userSettings);
  try {
    // Resolve render settings (defaults + user overrides) up front so the
    // renderer is built with the final values — no construct-with-defaults,
    // re-apply-overrides dance, and texture-baking passes (terrain) get the
    // right colors on the first build.
    const resolveRenderSettings = (): RenderSettings => {
      const settings = createRenderSettings();
      applyGraphicsOverrides(settings, userSettings.graphicsOverrides());
      return settings;
    };

    const { view, glCanvas, cachedWebGLFrameCallback } = createWebGLView(
      gameMap,
      config,
      resolveRenderSettings(),
    );

    const graphicsListenerAbort = new AbortController();

    view.setShowPatterns(userSettings.territoryPatterns());
    globalThis.addEventListener(
      `${USER_SETTINGS_CHANGED_EVENT}:settings.territoryPatterns`,
      (e) => view.setShowPatterns((e as CustomEvent<string>).detail === "true"),
      { signal: graphicsListenerAbort.signal },
    );

    // Re-resolve names drawn on the map when the anonymous-names setting toggles
    // so they switch live, like the leaderboard.
    globalThis.addEventListener(
      `${USER_SETTINGS_CHANGED_EVENT}:settings.anonymousNames`,
      () => webglBuilder.refreshNames(gameView),
      { signal: graphicsListenerAbort.signal },
    );

    // Re-resolve settings and copy them onto the renderer's live object in
    // place (passes hold a reference to it, so they pick the change up).
    const regenerateRenderSettings = (): void => {
      deepAssign(view.getSettings(), resolveRenderSettings());
    };
    // Rebuild the GPU-derived graphics state that the per-frame passes don't
    // pick up from the live settings object on their own.
    const refreshDerivedGraphics = (): void => {
      // Terrain is baked into a GPU texture rather than read per-frame, so a
      // terrain-color override (e.g. ocean) needs an explicit texture rebuild.
      view.rebuildTerrain();
      // A graphics override can switch the active theme (e.g. colorblind mode),
      // so re-theme existing players and re-upload the palette to recolor their
      // territory fills/borders live.
      gameView.refreshPlayerColors();
      webglBuilder.refreshPalette(gameView);
    };
    // Re-apply render settings, then re-theme and recolor players, on a
    // graphics-override change (covers a theme switch such as colorblind mode).
    const onGraphicsChanged = (): void => {
      regenerateRenderSettings();
      refreshDerivedGraphics();
    };
    // No initial regenerate or terrain rebuild needed — the renderer was
    // constructed with the resolved settings above, so the terrain texture
    // already bakes any saved ocean-color override.
    globalThis.addEventListener(
      `${USER_SETTINGS_CHANGED_EVENT}:${GRAPHICS_KEY}`,
      onGraphicsChanged,
      { signal: graphicsListenerAbort.signal },
    );

    // Loaded on demand so lil-gui and the debug GUI stay out of the main bundle.
    let debugGui: { open(): void; destroy(): void } | null = null;
    let debugGuiLoading = false;
    eventBus.on(ToggleRenderDebugGuiEvent, () => {
      if (debugGui === null) {
        if (debugGuiLoading) return;
        debugGuiLoading = true;
        import("./render/gl/debug/index")
          .then(({ createDebugGui }) => {
            debugGui = createDebugGui(
              view.getSettings(),
              resolveRenderSettings,
              refreshDerivedGraphics,
            );
            debugGui.open();
          })
          .finally(() => {
            debugGuiLoading = false;
          });
      } else {
        debugGui.destroy();
        debugGui = null;
      }
    });

    const gameRenderer = createRenderer(
      inputOverlay,
      gameView,
      eventBus,
      lobbyConfig.playerRole,
      view,
    );

    const { builder: webglBuilder, stopFrameLoop } = mountWebGLFrameLoop(
      gameMap,
      view,
      glCanvas,
      cachedWebGLFrameCallback,
      gameRenderer.transformHandler,
      gameView,
      eventBus,
    );

    // Releases all WebGL/DOM resources this game created. Without it, stopping
    // a game (e.g. joining another without a page reload) leaks the WebGL
    // context, canvas and input overlay — a few games and mobile browsers hit
    // their WebGL context limit. Idempotent: stop() may be called more than once.
    let rendererDisposed = false;
    const disposeRenderer = (): void => {
      if (rendererDisposed) return;
      rendererDisposed = true;
      stopFrameLoop();
      view.dispose();
      glCanvas.remove();
      inputOverlay.remove();
    };

    console.log(
      `creating private game got difficulty: ${lobbyConfig.gameStartInfo.config.difficulty}`,
    );

    return new ClientGameRunner(
      lobbyConfig,
      clientID,
      eventBus,
      gameRenderer,
      new InputHandler(gameView, gameRenderer.uiState, inputOverlay, eventBus),
      transport,
      worker,
      gameView,
      soundManager,
      userSettings,
      webglBuilder,
      graphicsListenerAbort,
      disposeRenderer,
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
    private userSettings: UserSettings,
    private webglBuilder: WebGLFrameBuilder | null = null,
    private graphicsListenerAbort: AbortController | null = null,
    private disposeRenderer: (() => void) | null = null,
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
      DoRetaliateAttackEvent,
      this.doRetaliateAttackMostRecent.bind(this),
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
      this.webglBuilder?.update(this.gameView);
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
          this.gameView.myPlayer() &&
          this.userSettings.goToPlayer()
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
    this.graphicsListenerAbort?.abort();
    this.disposeRenderer?.();
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

  private doRetaliateAttackMostRecent(): void {
    if (!this.isActive || this.gameView.inSpawnPhase()) {
      return;
    }

    if (this.myPlayer === null) {
      if (!this.clientID) return;
      const myPlayer = this.gameView.playerByClientID(this.clientID);
      if (myPlayer === null) return;
      this.myPlayer = myPlayer;
    }

    const incomingAttacks = this.myPlayer.incomingAttacks().filter((a) => {
      const t = (
        this.gameView.playerBySmallID(a.attackerID) as PlayerView
      ).type();
      return t !== PlayerType.Bot;
    });

    if (incomingAttacks.length === 0) return;

    const mostRecentAttack = incomingAttacks[incomingAttacks.length - 1];

    const attacker = this.gameView.playerBySmallID(
      mostRecentAttack.attackerID,
    ) as PlayerView;
    if (!attacker) return;

    const counterTroops = Math.min(
      mostRecentAttack.troops,
      this.renderer.uiState.attackRatio * this.myPlayer.troops(),
    );
    this.eventBus.emit(new SendAttackIntentEvent(attacker.id(), counterTroops));
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
      } else if (actions.interaction?.allianceInfo?.canExtend) {
        this.eventBus.emit(new SendAllianceExtensionIntentEvent(recipient));
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
