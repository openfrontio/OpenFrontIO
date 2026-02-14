import { EventBus } from "../../core/EventBus";
import { GameView } from "../../core/game/GameView";
import { UserSettings } from "../../core/game/UserSettings";
import { DioxusGameStartingModal } from "../ProfileAndSettingsBridges";
import {
  DioxusBuildMenu,
  DioxusRadialMenu,
  DioxusWinModal,
} from "../GameActionBridges";
import { RefreshGraphicsEvent as RedrawGraphicsEvent } from "../InputHandler";
import { FrameProfiler } from "./FrameProfiler";
import { TransformHandler } from "./TransformHandler";
import { UIState } from "./UIState";
import { AdTimer } from "./layers/AdTimer";
import {
  DioxusAlertFrame,
  DioxusChatDisplay,
  DioxusControlPanel,
  DioxusEmojiTable,
  DioxusEventsDisplay,
  DioxusGameLeftSidebar,
  DioxusGameRightSidebar,
  DioxusHeadsUpMessage,
  DioxusImmunityTimer,
  DioxusLeaderboard,
  DioxusPerformanceOverlay,
  DioxusPlayerInfoOverlay,
  DioxusPlayerPanel,
  DioxusReplayPanel,
  DioxusSettingsModal,
  DioxusSpawnTimer,
  DioxusTeamStats,
  DioxusUnitDisplay,
} from "./layers/AdvancedLayerBridges";
import {
  DioxusChatModal,
  DioxusMultiTabModal,
  DioxusPlayerModerationModal,
  DioxusSendResourceModal,
} from "../InGameModalBridges";
import { DynamicUILayer } from "./layers/DynamicUILayer";
import { FxLayer } from "./layers/FxLayer";
import { Layer } from "./layers/Layer";
import { NameLayer } from "./layers/NameLayer";
import { NukeTrajectoryPreviewLayer } from "./layers/NukeTrajectoryPreviewLayer";
import { RailroadLayer } from "./layers/RailroadLayer";
import { SAMRadiusLayer } from "./layers/SAMRadiusLayer";
import { StructureIconsLayer } from "./layers/StructureIconsLayer";
import { StructureLayer } from "./layers/StructureLayer";
import { TerrainLayer } from "./layers/TerrainLayer";
import { TerritoryLayer } from "./layers/TerritoryLayer";
import { UILayer } from "./layers/UILayer";
import { UnitLayer } from "./layers/UnitLayer";

export function createRenderer(
  canvas: HTMLCanvasElement,
  game: GameView,
  eventBus: EventBus,
): GameRenderer {
  const transformHandler = new TransformHandler(game, eventBus, canvas);
  const userSettings = new UserSettings();

  const uiState = {
    attackRatio: 20,
    ghostStructure: null,
    rocketDirectionUp: true,
  } as UIState;

  //hide when the game renders
  const startingModal = document.querySelector(
    "dioxus-game-starting-modal",
  ) as DioxusGameStartingModal;
  startingModal.hide();

  // TODO maybe append this to document instead of querying for them?
  const emojiTable = document.querySelector(
    "dioxus-emoji-table",
  ) as DioxusEmojiTable;
  if (!emojiTable || !(emojiTable instanceof DioxusEmojiTable)) {
    console.error("DioxusEmojiTable element not found in the DOM");
  }
  emojiTable.transformHandler = transformHandler;
  emojiTable.game = game;
  emojiTable.initEventBus(eventBus);

  // BuildMenu - Dioxus implementation
  const dioxusBuildMenu = document.querySelector(
    "dioxus-build-menu",
  ) as DioxusBuildMenu | null;
  if (dioxusBuildMenu) {
    if (!(dioxusBuildMenu instanceof DioxusBuildMenu)) {
      customElements.upgrade(dioxusBuildMenu);
    }
    dioxusBuildMenu.game = game;
    dioxusBuildMenu.eventBus = eventBus;
    dioxusBuildMenu.uiState = uiState;
    dioxusBuildMenu.transformHandler = transformHandler;
  } else {
    console.error("DioxusBuildMenu element not found in the DOM");
  }

  // RadialMenu - Dioxus implementation
  const dioxusRadialMenu = document.querySelector(
    "dioxus-radial-menu",
  ) as DioxusRadialMenu | null;
  if (dioxusRadialMenu) {
    if (!(dioxusRadialMenu instanceof DioxusRadialMenu)) {
      customElements.upgrade(dioxusRadialMenu);
    }
    dioxusRadialMenu.game = game;
    dioxusRadialMenu.eventBus = eventBus;
    dioxusRadialMenu.uiState = uiState;
    dioxusRadialMenu.transformHandler = transformHandler;
  } else {
    console.error("DioxusRadialMenu element not found in the DOM");
  }

  // Leaderboard - Dioxus implementation
  const dioxusLeaderboard = document.querySelector(
    "dioxus-leader-board",
  ) as DioxusLeaderboard | null;
  if (dioxusLeaderboard) {
    if (!(dioxusLeaderboard instanceof DioxusLeaderboard)) {
      customElements.upgrade(dioxusLeaderboard);
    }
    dioxusLeaderboard.eventBus = eventBus;
    dioxusLeaderboard.game = game;
  } else {
    console.error("DioxusLeaderboard element not found in the DOM");
  }

  const gameLeftSidebar = document.querySelector(
    "dioxus-game-left-sidebar",
  ) as DioxusGameLeftSidebar;
  if (
    !gameLeftSidebar ||
    !(gameLeftSidebar instanceof DioxusGameLeftSidebar)
  ) {
    console.error("DioxusGameLeftSidebar element not found in the DOM");
  }
  gameLeftSidebar.game = game;

  // TeamStats - Dioxus implementation
  const dioxusTeamStats = document.querySelector(
    "dioxus-team-stats",
  ) as DioxusTeamStats | null;
  if (dioxusTeamStats) {
    if (!(dioxusTeamStats instanceof DioxusTeamStats)) {
      customElements.upgrade(dioxusTeamStats);
    }
    dioxusTeamStats.eventBus = eventBus;
    dioxusTeamStats.game = game;
  } else {
    console.error("DioxusTeamStats element not found in the DOM");
  }

  const controlPanel = document.querySelector(
    "dioxus-control-panel",
  ) as DioxusControlPanel;
  if (!(controlPanel instanceof DioxusControlPanel)) {
    console.error("DioxusControlPanel element not found in the DOM");
  }
  controlPanel.eventBus = eventBus;
  controlPanel.uiState = uiState;
  controlPanel.game = game;

  const eventsDisplay = document.querySelector(
    "dioxus-events-display",
  ) as DioxusEventsDisplay;
  if (!(eventsDisplay instanceof DioxusEventsDisplay)) {
    console.error("events display not found");
  }
  eventsDisplay.eventBus = eventBus;
  eventsDisplay.game = game;
  eventsDisplay.uiState = uiState;

  const chatDisplay = document.querySelector(
    "dioxus-chat-display",
  ) as DioxusChatDisplay;
  if (!(chatDisplay instanceof DioxusChatDisplay)) {
    console.error("chat display not found");
  }
  chatDisplay.eventBus = eventBus;
  chatDisplay.game = game;

  const playerInfo = document.querySelector(
    "dioxus-player-info-overlay",
  ) as DioxusPlayerInfoOverlay;
  if (!(playerInfo instanceof DioxusPlayerInfoOverlay)) {
    console.error("player info overlay not found");
  }
  playerInfo.eventBus = eventBus;
  playerInfo.transform = transformHandler;
  playerInfo.game = game;

  // WinModal - Dioxus implementation
  const dioxusWinModal = document.querySelector(
    "dioxus-win-modal",
  ) as DioxusWinModal | null;
  if (dioxusWinModal) {
    if (!(dioxusWinModal instanceof DioxusWinModal)) {
      customElements.upgrade(dioxusWinModal);
    }
    dioxusWinModal.eventBus = eventBus;
    dioxusWinModal.game = game;
  } else {
    console.error("DioxusWinModal element not found in the DOM");
  }

  // Dioxus SendResourceModal
  const dioxusSendResourceModal = document.querySelector(
    "dioxus-send-resource-modal",
  ) as DioxusSendResourceModal | null;
  if (dioxusSendResourceModal) {
    if (!(dioxusSendResourceModal instanceof DioxusSendResourceModal)) {
      customElements.upgrade(dioxusSendResourceModal);
    }
    dioxusSendResourceModal.game = game;
    dioxusSendResourceModal.eventBus = eventBus;
    dioxusSendResourceModal.uiState = uiState;
  }

  const replayPanel = document.querySelector(
    "dioxus-replay-panel",
  ) as DioxusReplayPanel;
  if (!(replayPanel instanceof DioxusReplayPanel)) {
    console.error("replay panel not found");
  }
  replayPanel.eventBus = eventBus;
  replayPanel.game = game;

  const gameRightSidebar = document.querySelector(
    "dioxus-game-right-sidebar",
  ) as DioxusGameRightSidebar;
  if (!(gameRightSidebar instanceof DioxusGameRightSidebar)) {
    console.error("Game Right bar not found");
  }
  gameRightSidebar.game = game;
  gameRightSidebar.eventBus = eventBus;

  // SettingsModal - Dioxus implementation
  const dioxusSettingsModal = document.querySelector(
    "dioxus-settings-modal",
  ) as DioxusSettingsModal | null;
  if (dioxusSettingsModal) {
    if (!(dioxusSettingsModal instanceof DioxusSettingsModal)) {
      customElements.upgrade(dioxusSettingsModal);
    }
    dioxusSettingsModal.userSettings = userSettings;
    dioxusSettingsModal.eventBus = eventBus;
  } else {
    console.error("DioxusSettingsModal element not found in the DOM");
  }

  const unitDisplay = document.querySelector(
    "dioxus-unit-display",
  ) as DioxusUnitDisplay;
  if (!(unitDisplay instanceof DioxusUnitDisplay)) {
    console.error("unit display not found");
  }
  unitDisplay.game = game;
  unitDisplay.eventBus = eventBus;
  unitDisplay.uiState = uiState;

  const playerPanel = document.querySelector(
    "dioxus-player-panel",
  ) as DioxusPlayerPanel;
  if (!(playerPanel instanceof DioxusPlayerPanel)) {
    console.error("player panel not found");
  }
  playerPanel.g = game;
  playerPanel.initEventBus(eventBus);
  playerPanel.emojiTable = emojiTable;
  playerPanel.uiState = uiState;

  // Wire up DioxusRadialMenu dependencies that are defined late
  if (dioxusRadialMenu) {
    dioxusRadialMenu.emojiTable = emojiTable as DioxusEmojiTable;
    dioxusRadialMenu.buildMenu = dioxusBuildMenu!;
    dioxusRadialMenu.playerPanel = playerPanel;
  }

  // ChatModal - Dioxus implementation
  const dioxusChatModal = document.querySelector(
    "dioxus-chat-modal",
  ) as DioxusChatModal | null;
  if (dioxusChatModal) {
    if (!(dioxusChatModal instanceof DioxusChatModal)) {
      customElements.upgrade(dioxusChatModal);
    }
    dioxusChatModal.eventBus = eventBus;
    dioxusChatModal.game = game;
  } else {
    console.error("DioxusChatModal element not found in the DOM");
  }

  // PlayerModerationModal - Dioxus implementation
  const dioxusPlayerModerationModal = document.querySelector(
    "dioxus-player-moderation-modal",
  ) as DioxusPlayerModerationModal | null;
  if (dioxusPlayerModerationModal) {
    if (
      !(dioxusPlayerModerationModal instanceof DioxusPlayerModerationModal)
    ) {
      customElements.upgrade(dioxusPlayerModerationModal);
    }
    dioxusPlayerModerationModal.eventBus = eventBus;
  } else {
    console.error("DioxusPlayerModerationModal element not found in the DOM");
  }

  // MultiTabModal - Dioxus implementation
  const dioxusMultiTabModal = document.querySelector(
    "dioxus-multi-tab-modal",
  ) as DioxusMultiTabModal | null;
  if (dioxusMultiTabModal) {
    if (!(dioxusMultiTabModal instanceof DioxusMultiTabModal)) {
      customElements.upgrade(dioxusMultiTabModal);
    }
    dioxusMultiTabModal.game = game;
  } else {
    console.error("DioxusMultiTabModal element not found in the DOM");
  }

  const headsUpMessage = document.querySelector(
    "dioxus-heads-up-message",
  ) as DioxusHeadsUpMessage;
  if (!(headsUpMessage instanceof DioxusHeadsUpMessage)) {
    console.error("heads-up message not found");
  }
  headsUpMessage.game = game;

  const structureLayer = new StructureLayer(game, eventBus, transformHandler);
  const samRadiusLayer = new SAMRadiusLayer(game, eventBus, uiState);

  const performanceOverlay = document.querySelector(
    "dioxus-performance-overlay",
  ) as DioxusPerformanceOverlay;
  if (!(performanceOverlay instanceof DioxusPerformanceOverlay)) {
    console.error("performance overlay not found");
  }
  performanceOverlay.eventBus = eventBus;
  performanceOverlay.userSettings = userSettings;

  const alertFrame = document.querySelector(
    "dioxus-alert-frame",
  ) as DioxusAlertFrame;
  if (!(alertFrame instanceof DioxusAlertFrame)) {
    console.error("alert frame not found");
  }
  alertFrame.game = game;

  const spawnTimer = document.querySelector(
    "dioxus-spawn-timer",
  ) as DioxusSpawnTimer;
  if (!(spawnTimer instanceof DioxusSpawnTimer)) {
    console.error("spawn timer not found");
  }
  spawnTimer.game = game;
  spawnTimer.transformHandler = transformHandler;

  const immunityTimer = document.querySelector(
    "dioxus-immunity-timer",
  ) as DioxusImmunityTimer;
  if (!(immunityTimer instanceof DioxusImmunityTimer)) {
    console.error("immunity timer not found");
  }
  immunityTimer.game = game;

  // When updating these layers please be mindful of the order.
  // Try to group layers by the return value of shouldTransform.
  // Not grouping the layers may cause excessive calls to context.save() and context.restore().
  const layers: Layer[] = [
    new TerrainLayer(game, transformHandler),
    new TerritoryLayer(game, eventBus, transformHandler, userSettings),
    new RailroadLayer(game, eventBus, transformHandler),
    structureLayer,
    samRadiusLayer,
    new UnitLayer(game, eventBus, transformHandler),
    new FxLayer(game),
    new UILayer(game, eventBus, transformHandler),
    new NukeTrajectoryPreviewLayer(game, eventBus, transformHandler, uiState),
    new StructureIconsLayer(game, eventBus, uiState, transformHandler),
    new DynamicUILayer(game, transformHandler, eventBus),
    new NameLayer(game, transformHandler, eventBus),
    eventsDisplay,
    chatDisplay,
    // BuildMenu - Dioxus implementation
    ...(dioxusBuildMenu ? [dioxusBuildMenu] : []),
    // RadialMenu - Dioxus implementation
    ...(dioxusRadialMenu ? [dioxusRadialMenu] : []),
    spawnTimer,
    immunityTimer,
    ...(dioxusLeaderboard ? [dioxusLeaderboard] : []),
    gameLeftSidebar,
    unitDisplay,
    gameRightSidebar,
    controlPanel,
    playerInfo,
    ...(dioxusWinModal ? [dioxusWinModal] : []),
    replayPanel,
    ...(dioxusSettingsModal ? [dioxusSettingsModal] : []),
    ...(dioxusTeamStats ? [dioxusTeamStats] : []),
    playerPanel,
    headsUpMessage,
    ...(dioxusMultiTabModal ? [dioxusMultiTabModal] : []),
    // Dioxus SendResourceModal
    ...(dioxusSendResourceModal ? [dioxusSendResourceModal] : []),
    // Dioxus ChatModal
    ...(dioxusChatModal ? [dioxusChatModal] : []),
    // Dioxus PlayerModerationModal
    ...(dioxusPlayerModerationModal ? [dioxusPlayerModerationModal] : []),
    new AdTimer(game),
    alertFrame,
    performanceOverlay,
  ];

  return new GameRenderer(
    game,
    eventBus,
    canvas,
    transformHandler,
    uiState,
    layers,
    performanceOverlay,
  );
}

export class GameRenderer {
  private context: CanvasRenderingContext2D;

  constructor(
    private game: GameView,
    private eventBus: EventBus,
    private canvas: HTMLCanvasElement,
    public transformHandler: TransformHandler,
    public uiState: UIState,
    private layers: Layer[],
    private performanceOverlay: DioxusPerformanceOverlay,
  ) {
    const context = canvas.getContext("2d", { alpha: false });
    if (context === null) throw new Error("2d context not supported");
    this.context = context;
  }

  initialize() {
    this.eventBus.on(RedrawGraphicsEvent, () => this.redraw());
    this.layers.forEach((l) => l.init?.());

    // only append the canvas if it's not already in the document to avoid reparenting side-effects
    if (!document.body.contains(this.canvas)) {
      document.body.appendChild(this.canvas);
    }

    window.addEventListener("resize", () => this.resizeCanvas());
    this.resizeCanvas();

    //show whole map on startup
    this.transformHandler.centerAll(0.9);

    let rafId = requestAnimationFrame(() => this.renderGame());
    this.canvas.addEventListener("contextlost", () => {
      cancelAnimationFrame(rafId);
    });
    this.canvas.addEventListener("contextrestored", () => {
      this.redraw();
      rafId = requestAnimationFrame(() => this.renderGame());
    });
  }

  resizeCanvas() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
    this.transformHandler.updateCanvasBoundingRect();
    //this.redraw()
  }

  redraw() {
    this.layers.forEach((l) => {
      if (l.redraw) {
        l.redraw();
      }
    });
  }

  renderGame() {
    FrameProfiler.clear();
    const start = performance.now();
    // Set background
    this.context.fillStyle = this.game
      .config()
      .theme()
      .backgroundColor()
      .toHex();
    this.context.fillRect(0, 0, this.canvas.width, this.canvas.height);

    const handleTransformState = (
      needsTransform: boolean,
      active: boolean,
    ): boolean => {
      if (needsTransform && !active) {
        this.context.save();
        this.transformHandler.handleTransform(this.context);
        return true;
      } else if (!needsTransform && active) {
        this.context.restore();
        return false;
      }
      return active;
    };

    let isTransformActive = false;

    for (const layer of this.layers) {
      const needsTransform = layer.shouldTransform?.() ?? false;
      isTransformActive = handleTransformState(
        needsTransform,
        isTransformActive,
      );

      const layerStart = FrameProfiler.start();
      layer.renderLayer?.(this.context);
      FrameProfiler.end(layer.constructor?.name ?? "UnknownLayer", layerStart);
    }
    handleTransformState(false, isTransformActive); // Ensure context is clean after rendering
    this.transformHandler.resetChanged();

    requestAnimationFrame(() => this.renderGame());
    const duration = performance.now() - start;

    const layerDurations = FrameProfiler.consume();
    this.performanceOverlay.updateFrameMetrics(duration, layerDurations);

    if (duration > 50) {
      console.warn(
        `tick ${this.game.ticks()} took ${duration}ms to render frame`,
      );
    }
  }

  tick() {
    this.layers.forEach((l) => l.tick?.());
  }

  resize(width: number, height: number): void {
    this.canvas.width = Math.ceil(width / window.devicePixelRatio);
    this.canvas.height = Math.ceil(height / window.devicePixelRatio);
  }
}
