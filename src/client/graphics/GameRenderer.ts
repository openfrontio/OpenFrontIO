import { consolex } from "../../core/Consolex";
import { EventBus } from "../../core/EventBus";
import { ClientID } from "../../core/Schemas";
import { GameView } from "../../core/game/GameView";
import { RefreshGraphicsEvent as RedrawGraphicsEvent } from "../InputHandler";
import { TransformHandler } from "./TransformHandler";
import { UIState } from "./UIState";
import { BuildMenu } from "./layers/BuildMenu";
import { ControlPanel } from "./layers/ControlPanel";
import { EmojiTable } from "./layers/EmojiTable";
import { EventsDisplay } from "./layers/EventsDisplay";
import { Layer } from "./layers/Layer";
import { Leaderboard } from "./layers/Leaderboard";
import { NameLayer } from "./layers/NameLayer";
import { OptionsMenu } from "./layers/OptionsMenu";
import { PlayerInfoOverlay } from "./layers/PlayerInfoOverlay";
import { PlayerPanel } from "./layers/PlayerPanel";
import { RadialMenu } from "./layers/RadialMenu";
import { SpawnTimer } from "./layers/SpawnTimer";
import { StructureLayer } from "./layers/StructureLayer";
import { TerrainLayer } from "./layers/TerrainLayer";
import { TerritoryLayer } from "./layers/TerritoryLayer";
import { TopBar } from "./layers/TopBar";
import { UnitLayer } from "./layers/UnitLayer";
import { WinModal } from "./layers/WinModal";

export function createRenderer(
  canvas: HTMLCanvasElement,
  game: GameView,
  eventBus: EventBus,
  clientID: ClientID,
): GameRenderer {
  const transformHandler = new TransformHandler(game, eventBus, canvas);

  const uiState = { attackRatio: 20 };

  // TODO maybe append this to dcoument instead of querying for them?
  const emojiTable = document.querySelector("emoji-table") as EmojiTable;
  if (!emojiTable || !(emojiTable instanceof EmojiTable)) {
    consolex.error("EmojiTable element not found in the DOM");
  }
  const buildMenu = document.querySelector("build-menu") as BuildMenu;
  if (!buildMenu || !(buildMenu instanceof BuildMenu)) {
    consolex.error("BuildMenu element not found in the DOM");
  }
  buildMenu.game = game;
  buildMenu.eventBus = eventBus;

  const leaderboard = document.querySelector("leader-board") as Leaderboard;
  if (!emojiTable || !(leaderboard instanceof Leaderboard)) {
    consolex.error("EmojiTable element not found in the DOM");
  }
  leaderboard.clientID = clientID;
  leaderboard.eventBus = eventBus;
  leaderboard.game = game;

  const controlPanel = document.querySelector("control-panel") as ControlPanel;
  if (!(controlPanel instanceof ControlPanel)) {
    consolex.error("ControlPanel element not found in the DOM");
  }
  controlPanel.clientID = clientID;
  controlPanel.eventBus = eventBus;
  controlPanel.uiState = uiState;
  controlPanel.game = game;

  const eventsDisplay = document.querySelector(
    "events-display",
  ) as EventsDisplay;
  if (!(eventsDisplay instanceof EventsDisplay)) {
    consolex.error("events display not found");
  }
  eventsDisplay.eventBus = eventBus;
  eventsDisplay.game = game;
  eventsDisplay.clientID = clientID;

  const playerInfo = document.querySelector(
    "player-info-overlay",
  ) as PlayerInfoOverlay;
  if (!(playerInfo instanceof PlayerInfoOverlay)) {
    consolex.error("player info overlay not found");
  }
  playerInfo.eventBus = eventBus;
  playerInfo.clientID = clientID;
  playerInfo.transform = transformHandler;
  playerInfo.game = game;

  const winModel = document.querySelector("win-modal") as WinModal;
  if (!(winModel instanceof WinModal)) {
    console.error("win modal not found");
  }
  winModel.eventBus = eventBus;
  winModel.game = game;

  const optionsMenu = document.querySelector("options-menu") as OptionsMenu;
  if (!(optionsMenu instanceof OptionsMenu)) {
    console.error("options menu not found");
  }
  optionsMenu.eventBus = eventBus;
  optionsMenu.game = game;

  const topBar = document.querySelector("top-bar") as TopBar;
  if (!(topBar instanceof TopBar)) {
    console.error("top bar not found");
  }
  topBar.game = game;

  const playerPanel = document.querySelector("player-panel") as PlayerPanel;
  if (!(playerPanel instanceof PlayerPanel)) {
    console.error("player panel not found");
  }
  playerPanel.g = game;
  playerPanel.eventBus = eventBus;
  playerPanel.emojiTable = emojiTable;

  const layers: Layer[] = [
    new TerrainLayer(game),
    new TerritoryLayer(game, eventBus),
    new StructureLayer(game, eventBus),
    new UnitLayer(game, eventBus, clientID),
    new NameLayer(game, transformHandler, clientID),
    eventsDisplay,
    buildMenu,
    new RadialMenu(
      eventBus,
      game,
      transformHandler,
      clientID,
      emojiTable as EmojiTable,
      buildMenu,
      uiState,
      playerInfo,
      playerPanel,
    ),
    new SpawnTimer(game, transformHandler),
    leaderboard,
    controlPanel,
    playerInfo,
    winModel,
    optionsMenu,
    topBar,
    playerPanel,
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
    this.context = canvas.getContext("2d");
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

    this.transformHandler = new TransformHandler(
      this.game,
      this.eventBus,
      this.canvas,
    );

    requestAnimationFrame(() => this.renderGame());
  }

  resizeCanvas() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
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

    // Save the current context state
    this.context.save();

    this.transformHandler.handleTransform(this.context);

    this.layers.forEach((l) => {
      if (l.shouldTransform?.()) {
        l.renderLayer?.(this.context);
      }
    });

    this.context.restore();

    this.layers.forEach((l) => {
      if (!l.shouldTransform?.()) {
        l.renderLayer?.(this.context);
      }
    });

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
