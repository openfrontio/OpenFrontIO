import { EventBus } from "../../core/EventBus";
import { GameView } from "../../core/game/GameView";
import { UserSettings } from "../../core/game/UserSettings";
import { GameStartingModal } from "../GameStartingModal";
import { RefreshGraphicsEvent as RedrawGraphicsEvent } from "../InputHandler";
import { FrameProfiler } from "./FrameProfiler";
import { TransformHandler } from "./TransformHandler";
import { UIState } from "./UIState";
import { AdTimer } from "./layers/AdTimer";
import { AlertFrame } from "./layers/AlertFrame";
import { BuildMenu } from "./layers/BuildMenu";
import { ChatDisplay } from "./layers/ChatDisplay";
import { ChatModal } from "./layers/ChatModal";
import { ControlPanel } from "./layers/ControlPanel";
import { EmojiTable } from "./layers/EmojiTable";
import { EventsDisplay } from "./layers/EventsDisplay";
import { FxLayer } from "./layers/FxLayer";
import { GameLeftSidebar } from "./layers/GameLeftSidebar";
import { GameRightSidebar } from "./layers/GameRightSidebar";
import { HeadsUpMessage } from "./layers/HeadsUpMessage";
import { Layer } from "./layers/Layer";
import { Leaderboard } from "./layers/Leaderboard";
import { MainRadialMenu } from "./layers/MainRadialMenu";
import { MultiTabModal } from "./layers/MultiTabModal";
import { NameLayer } from "./layers/NameLayer";
import { NukeTrajectoryPreviewLayer } from "./layers/NukeTrajectoryPreviewLayer";
import { PerformanceOverlay } from "./layers/PerformanceOverlay";
import { PlayerInfoOverlay } from "./layers/PlayerInfoOverlay";
import { PlayerPanel } from "./layers/PlayerPanel";
import { RailroadLayer } from "./layers/RailroadLayer";
import { ReplayPanel } from "./layers/ReplayPanel";
import { SAMRadiusLayer } from "./layers/SAMRadiusLayer";
import { SettingsModal } from "./layers/SettingsModal";
import { SpawnTimer } from "./layers/SpawnTimer";
import { StructureIconsLayer } from "./layers/StructureIconsLayer";
import { StructureLayer } from "./layers/StructureLayer";
import { TeamStats } from "./layers/TeamStats";
import { TerrainLayer } from "./layers/TerrainLayer";
import { TerritoryLayer } from "./layers/TerritoryLayer";
import { UILayer } from "./layers/UILayer";
import { UnitDisplay } from "./layers/UnitDisplay";
import { UnitLayer } from "./layers/UnitLayer";
import { WinModal } from "./layers/WinModal";

export function createRenderer(
  canvas: HTMLCanvasElement,
  game: GameView,
  eventBus: EventBus,
): GameRenderer {
  const transformHandler = new TransformHandler(game, eventBus, canvas);
  const userSettings = new UserSettings();

  const uiState = { attackRatio: 20, ghostStructure: null } as UIState;

  //hide when the game renders
  const startingModal = document.querySelector(
    "game-starting-modal",
  ) as GameStartingModal;
  startingModal.hide();

  // TODO maybe append this to document instead of querying for them?
  const emojiTable = document.querySelector("emoji-table") as EmojiTable;
  if (!emojiTable || !(emojiTable instanceof EmojiTable)) {
    console.error("EmojiTable element not found in the DOM");
  }
  emojiTable.transformHandler = transformHandler;
  emojiTable.game = game;
  emojiTable.initEventBus(eventBus);

  const buildMenu = document.querySelector("build-menu") as BuildMenu;
  if (!buildMenu || !(buildMenu instanceof BuildMenu)) {
    console.error("BuildMenu element not found in the DOM");
  }
  buildMenu.game = game;
  buildMenu.eventBus = eventBus;
  buildMenu.transformHandler = transformHandler;

  const leaderboard = document.querySelector("leader-board") as Leaderboard;
  if (!leaderboard || !(leaderboard instanceof Leaderboard)) {
    console.error("LeaderBoard element not found in the DOM");
  }
  leaderboard.eventBus = eventBus;
  leaderboard.game = game;

  const gameLeftSidebar = document.querySelector(
    "game-left-sidebar",
  ) as GameLeftSidebar;
  if (!gameLeftSidebar || !(gameLeftSidebar instanceof GameLeftSidebar)) {
    console.error("GameLeftSidebar element not found in the DOM");
  }
  gameLeftSidebar.game = game;

  const teamStats = document.querySelector("team-stats") as TeamStats;
  if (!teamStats || !(teamStats instanceof TeamStats)) {
    console.error("TeamStats element not found in the DOM");
  }
  teamStats.eventBus = eventBus;
  teamStats.game = game;

  const controlPanel = document.querySelector("control-panel") as ControlPanel;
  if (!(controlPanel instanceof ControlPanel)) {
    console.error("ControlPanel element not found in the DOM");
  }
  controlPanel.eventBus = eventBus;
  controlPanel.uiState = uiState;
  controlPanel.game = game;

  const eventsDisplay = document.querySelector(
    "events-display",
  ) as EventsDisplay;
  if (!(eventsDisplay instanceof EventsDisplay)) {
    console.error("events display not found");
  }
  eventsDisplay.eventBus = eventBus;
  eventsDisplay.game = game;
  eventsDisplay.uiState = uiState;

  const chatDisplay = document.querySelector("chat-display") as ChatDisplay;
  if (!(chatDisplay instanceof ChatDisplay)) {
    console.error("chat display not found");
  }
  chatDisplay.eventBus = eventBus;
  chatDisplay.game = game;

  const playerInfo = document.querySelector(
    "player-info-overlay",
  ) as PlayerInfoOverlay;
  if (!(playerInfo instanceof PlayerInfoOverlay)) {
    console.error("player info overlay not found");
  }
  playerInfo.eventBus = eventBus;
  playerInfo.transform = transformHandler;
  playerInfo.game = game;

  const winModal = document.querySelector("win-modal") as WinModal;
  if (!(winModal instanceof WinModal)) {
    console.error("win modal not found");
  }
  winModal.eventBus = eventBus;
  winModal.game = game;

  const replayPanel = document.querySelector("replay-panel") as ReplayPanel;
  if (!(replayPanel instanceof ReplayPanel)) {
    console.error("replay panel not found");
  }
  replayPanel.eventBus = eventBus;
  replayPanel.game = game;

  const gameRightSidebar = document.querySelector(
    "game-right-sidebar",
  ) as GameRightSidebar;
  if (!(gameRightSidebar instanceof GameRightSidebar)) {
    console.error("Game Right bar not found");
  }
  gameRightSidebar.game = game;
  gameRightSidebar.eventBus = eventBus;

  const settingsModal = document.querySelector(
    "settings-modal",
  ) as SettingsModal;
  if (!(settingsModal instanceof SettingsModal)) {
    console.error("settings modal not found");
  }
  settingsModal.userSettings = userSettings;
  settingsModal.eventBus = eventBus;

  const unitDisplay = document.querySelector("unit-display") as UnitDisplay;
  if (!(unitDisplay instanceof UnitDisplay)) {
    console.error("unit display not found");
  }
  unitDisplay.game = game;
  unitDisplay.eventBus = eventBus;
  unitDisplay.uiState = uiState;

  const playerPanel = document.querySelector("player-panel") as PlayerPanel;
  if (!(playerPanel instanceof PlayerPanel)) {
    console.error("player panel not found");
  }
  playerPanel.g = game;
  playerPanel.initEventBus(eventBus);
  playerPanel.emojiTable = emojiTable;
  playerPanel.uiState = uiState;

  const chatModal = document.querySelector("chat-modal") as ChatModal;
  if (!(chatModal instanceof ChatModal)) {
    console.error("chat modal not found");
  }
  chatModal.g = game;
  chatModal.initEventBus(eventBus);

  const multiTabModal = document.querySelector(
    "multi-tab-modal",
  ) as MultiTabModal;
  if (!(multiTabModal instanceof MultiTabModal)) {
    console.error("multi-tab modal not found");
  }
  multiTabModal.game = game;

  const headsUpMessage = document.querySelector(
    "heads-up-message",
  ) as HeadsUpMessage;
  if (!(headsUpMessage instanceof HeadsUpMessage)) {
    console.error("heads-up message not found");
  }
  headsUpMessage.game = game;

  const structureLayer = new StructureLayer(game, eventBus, transformHandler);
  const samRadiusLayer = new SAMRadiusLayer(game, eventBus, uiState);

  const performanceOverlay = document.querySelector(
    "performance-overlay",
  ) as PerformanceOverlay;
  if (!(performanceOverlay instanceof PerformanceOverlay)) {
    console.error("performance overlay not found");
  }
  performanceOverlay.eventBus = eventBus;
  performanceOverlay.userSettings = userSettings;

  const alertFrame = document.querySelector("alert-frame") as AlertFrame;
  if (!(alertFrame instanceof AlertFrame)) {
    console.error("alert frame not found");
  }
  alertFrame.game = game;

  const spawnTimer = document.querySelector("spawn-timer") as SpawnTimer;
  if (!(spawnTimer instanceof SpawnTimer)) {
    console.error("spawn timer not found");
  }
  spawnTimer.game = game;
  spawnTimer.transformHandler = transformHandler;

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
    new NukeTrajectoryPreviewLayer(game, eventBus, transformHandler),
    new StructureIconsLayer(game, eventBus, uiState, transformHandler),
    new NameLayer(game, transformHandler, eventBus),
    eventsDisplay,
    chatDisplay,
    buildMenu,
    new MainRadialMenu(
      eventBus,
      game,
      transformHandler,
      emojiTable as EmojiTable,
      buildMenu,
      uiState,
      playerPanel,
    ),
    spawnTimer,
    leaderboard,
    gameLeftSidebar,
    unitDisplay,
    gameRightSidebar,
    controlPanel,
    playerInfo,
    winModal,
    replayPanel,
    settingsModal,
    teamStats,
    playerPanel,
    headsUpMessage,
    multiTabModal,
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
    private performanceOverlay: PerformanceOverlay,
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
