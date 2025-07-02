import { EventBus } from "../../core/EventBus";
import { GameView } from "../../core/game/GameView";
import { UserSettings } from "../../core/game/UserSettings";
import { GameStartingModal } from "../GameStartingModal";
import { RefreshGraphicsEvent as RedrawGraphicsEvent } from "../InputHandler";
import { TransformHandler } from "./TransformHandler";
import { UIState } from "./UIState";
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
import { GameTopBar } from "./layers/GameTopBar";
import { GutterAdModal } from "./layers/GutterAdModal";
import { HeadsUpMessage } from "./layers/HeadsUpMessage";
import { Layer } from "./layers/Layer";
import { Leaderboard } from "./layers/Leaderboard";
import { MainRadialMenu } from "./layers/MainRadialMenu";
import { MultiTabModal } from "./layers/MultiTabModal";
import { NameLayer } from "./layers/NameLayer";
import { PlayerInfoOverlay } from "./layers/PlayerInfoOverlay";
import { PlayerPanel } from "./layers/PlayerPanel";
import { RailroadLayer } from "./layers/RailroadLayer";
import { ReplayPanel } from "./layers/ReplayPanel";
import { SpawnAd } from "./layers/SpawnAd";
import { SpawnTimer } from "./layers/SpawnTimer";
import { StructureIconsLayer } from "./layers/StructureIconsLayer";
import { StructureLayer } from "./layers/StructureLayer";
import { TeamStats } from "./layers/TeamStats";
import { TerrainLayer } from "./layers/TerrainLayer";
import { TerritoryLayer } from "./layers/TerritoryLayer";
import { UILayer } from "./layers/UILayer";
import { UnitInfoModal } from "./layers/UnitInfoModal";
import { UnitLayer } from "./layers/UnitLayer";
import { WinModal } from "./layers/WinModal";

export function createRenderer(
  canvas: HTMLCanvasElement,
  game: GameView,
  eventBus: EventBus,
  userSettings: UserSettings,
): GameRenderer {
  const transformHandler = new TransformHandler(game, eventBus, canvas);

  const uiState = { attackRatio: 20 };

  //hide when the game renders
  const startingModal = document.querySelector(
    "game-starting-modal",
  ) as GameStartingModal;
  startingModal.hide();

  // TODO maybe append this to dcoument instead of querying for them?
  const emojiTable = document.querySelector("emoji-table") as EmojiTable;
  if (!emojiTable || !(emojiTable instanceof EmojiTable)) {
    console.error("EmojiTable element not found in the DOM");
  }
  emojiTable.eventBus = eventBus;
  emojiTable.transformHandler = transformHandler;
  emojiTable.game = game;
  emojiTable.initEventBus();

  const buildMenu = document.querySelector("build-menu") as BuildMenu;
  if (!buildMenu || !(buildMenu instanceof BuildMenu)) {
    console.error("BuildMenu element not found in the DOM");
  }
  buildMenu.game = game;
  buildMenu.eventBus = eventBus;

  const leaderboard = document.querySelector("leader-board") as Leaderboard;
  if (!emojiTable || !(leaderboard instanceof Leaderboard)) {
    console.error("EmojiTable element not found in the DOM");
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
  if (!emojiTable || !(teamStats instanceof TeamStats)) {
    console.error("EmojiTable element not found in the DOM");
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
  eventsDisplay.userSettings = userSettings;

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

  const gameTopBar = document.querySelector("game-top-bar") as GameTopBar;
  if (!(gameTopBar instanceof GameTopBar)) {
    console.error("top bar not found");
  }
  gameTopBar.game = game;
  gameTopBar.eventBus = eventBus;
  gameTopBar.userSettings = userSettings;

  const playerPanel = document.querySelector("player-panel") as PlayerPanel;
  if (!(playerPanel instanceof PlayerPanel)) {
    console.error("player panel not found");
  }
  playerPanel.g = game;
  playerPanel.eventBus = eventBus;
  playerPanel.emojiTable = emojiTable;
  playerPanel.uiState = uiState;

  const chatModal = document.querySelector("chat-modal") as ChatModal;
  if (!(chatModal instanceof ChatModal)) {
    console.error("chat modal not found");
  }
  chatModal.g = game;
  chatModal.eventBus = eventBus;

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

  const unitInfoModal = document.querySelector(
    "unit-info-modal",
  ) as UnitInfoModal;
  if (!(unitInfoModal instanceof UnitInfoModal)) {
    console.error("unit info modal not found");
  }
  unitInfoModal.game = game;
  const structureLayer = new StructureLayer(
    game,
    eventBus,
    transformHandler,
    unitInfoModal,
  );
  unitInfoModal.structureLayer = structureLayer;
  // unitInfoModal.eventBus = eventBus;

  const spawnAd = document.querySelector("spawn-ad") as SpawnAd;
  if (!(spawnAd instanceof SpawnAd)) {
    console.error("spawn ad not found");
  }
  spawnAd.g = game;

  const gutterAdModal = document.querySelector(
    "gutter-ad-modal",
  ) as GutterAdModal;
  if (!(gutterAdModal instanceof GutterAdModal)) {
    console.error("gutter ad modal not found");
  }
  gutterAdModal.eventBus = eventBus;

  const alertFrame = document.querySelector("alert-frame") as AlertFrame;
  if (!(alertFrame instanceof AlertFrame)) {
    console.error("alert frame not found");
  } else {
    alertFrame.userSettings = userSettings;
  }
  alertFrame.game = game;

  const layers: Layer[] = [
    new TerrainLayer(game, transformHandler),
    new TerritoryLayer(game, eventBus, transformHandler, userSettings),
    new RailroadLayer(game),
    structureLayer,
    new StructureIconsLayer(game, transformHandler),
    new UnitLayer(game, eventBus, transformHandler),
    new FxLayer(game),
    new UILayer(game, eventBus, transformHandler),
    new NameLayer(game, transformHandler),
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
    new SpawnTimer(game, transformHandler),
    leaderboard,
    gameLeftSidebar,
    gameTopBar,
    gameRightSidebar,
    controlPanel,
    playerInfo,
    winModal,
    replayPanel,
    teamStats,
    playerPanel,
    headsUpMessage,
    unitInfoModal,
    multiTabModal,
    spawnAd,
    gutterAdModal,
    alertFrame,
  ];

  return new GameRenderer(
    game,
    eventBus,
    canvas,
    transformHandler,
    uiState,
    layers,
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
  ) {
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("2d context not supported");
    this.context = context;
  }

  initialize() {
    this.eventBus.on(RedrawGraphicsEvent, (e) => {
      this.layers.forEach((l) => {
        if (l.redraw) {
          l.redraw();
        }
      });
    });

    this.layers.forEach((l) => l.init?.());

    document.body.appendChild(this.canvas);
    window.addEventListener("resize", () => this.resizeCanvas());
    this.resizeCanvas();

    //show whole map on startup
    this.transformHandler.centerAll(0.9);

    requestAnimationFrame(() => this.renderGame());
  }

  resizeCanvas() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
    this.transformHandler.updateCanvasBoundingRect();
    //this.redraw()
  }

  renderGame() {
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
      layer.renderLayer?.(this.context);
    }
    handleTransformState(false, isTransformActive); // Ensure context is clean after rendering
    this.transformHandler.resetChanged();

    requestAnimationFrame(() => this.renderGame());

    const duration = performance.now() - start;
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
