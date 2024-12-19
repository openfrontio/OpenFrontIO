import { Game, PlayerInfo } from "../../core/game/Game";
import { NameLayer } from "./layers/NameLayer";
import { TerrainLayer } from "./layers/TerrainLayer";
import { TerritoryLayer } from "./layers/TerritoryLayer";
import { ClientID } from "../../core/Schemas";
import { UILayer } from "./layers/UILayer";
import { EventBus } from "../../core/EventBus";
import { TransformHandler } from "./TransformHandler";
import { Layer } from "./layers/Layer";
import { EventsDisplay } from "./layers/EventsDisplay";
import { RadialMenu } from "./layers/radial/RadialMenu";
import { EmojiTable } from "./layers/radial/EmojiTable";
import { Leaderboard } from "./layers/Leaderboard";
import { ControlPanel } from "./layers/ControlPanel";
import { UIState } from "./UIState";
import { BuildMenu } from "./layers/radial/BuildMenu";
import { UnitLayer } from "./layers/UnitLayer";
import { StructureLayer } from "./layers/StructureLayer";
import { PlayerInfoOverlay } from "./layers/PlayerInfoOverlay";


export function createRenderer(canvas: HTMLCanvasElement, game: Game, eventBus: EventBus, clientID: ClientID): GameRenderer {
	const transformHandler = new TransformHandler(game, eventBus, canvas)

	const uiState = { attackRatio: 20 }

	// TODO maybe append this to dcoument instead of querying for them?
	const emojiTable = document.querySelector('emoji-table') as EmojiTable;
	if (!emojiTable || !(emojiTable instanceof EmojiTable)) {
		console.error('EmojiTable element not found in the DOM');
	}
	const buildMenu = document.querySelector('build-menu') as BuildMenu;
	if (!buildMenu || !(buildMenu instanceof BuildMenu)) {
		console.error('BuildMenu element not found in the DOM')
	}
	buildMenu.game = game
	buildMenu.eventBus = eventBus

	const leaderboard = document.querySelector('leader-board') as Leaderboard;
	if (!emojiTable || !(leaderboard instanceof Leaderboard)) {
		console.error('EmojiTable element not found in the DOM');
	}
	leaderboard.clientID = clientID
	leaderboard.eventBus = eventBus


	const controlPanel = document.querySelector('control-panel') as ControlPanel;
	if (!(controlPanel instanceof ControlPanel)) {
		console.error('ControlPanel element not found in the DOM');
	}
	controlPanel.clientID = clientID
	controlPanel.eventBus = eventBus
	controlPanel.uiState = uiState

	const eventsDisplay = document.querySelector('events-display') as EventsDisplay;
	if (!(eventsDisplay instanceof EventsDisplay)) {
		console.error('events display not found')
	}
	eventsDisplay.eventBus = eventBus
	eventsDisplay.game = game
	eventsDisplay.clientID = clientID

	const playerInfo = document.querySelector('player-info-overlay') as PlayerInfoOverlay
	if (!(playerInfo instanceof PlayerInfoOverlay)) {
		console.error('player info overlay not found')
	}
	playerInfo.eventBus = eventBus
	playerInfo.clientID = clientID
	playerInfo.transform = transformHandler
	playerInfo.game = game


	const layers: Layer[] = [
		new TerrainLayer(game),
		new TerritoryLayer(game, eventBus),
		new StructureLayer(game, eventBus),
		new UnitLayer(game, eventBus),
		new NameLayer(game, game.config().theme(), transformHandler, clientID),
		new UILayer(eventBus, game, clientID, transformHandler),
		eventsDisplay,
		new RadialMenu(eventBus, game, transformHandler, clientID, emojiTable as EmojiTable, buildMenu, uiState),
		leaderboard,
		controlPanel,
		playerInfo
	]

	return new GameRenderer(game, eventBus, canvas, transformHandler, uiState, layers)
}


export class GameRenderer {

	private context: CanvasRenderingContext2D

	constructor(private game: Game, private eventBus: EventBus, private canvas: HTMLCanvasElement, public transformHandler: TransformHandler, public uiState: UIState, private layers: Layer[]) {
		this.context = canvas.getContext("2d")
	}

	initialize() {
		this.layers.forEach(l => l.init(this.game))

		document.body.appendChild(this.canvas);
		window.addEventListener('resize', () => this.resizeCanvas());
		this.resizeCanvas();

		this.transformHandler = new TransformHandler(this.game, this.eventBus, this.canvas)

		requestAnimationFrame(() => this.renderGame());
	}

	resizeCanvas() {
		this.canvas.width = window.innerWidth;
		this.canvas.height = window.innerHeight;
		//this.redraw()
	}

	renderGame() {
		// Set background
		this.context.fillStyle = this.game.config().theme().backgroundColor().toHex();
		this.context.fillRect(0, 0, this.canvas.width, this.canvas.height);

		// Save the current context state
		this.context.save();

		this.transformHandler.handleTransform(this.context)

		this.layers.forEach(l => {
			if (l.shouldTransform()) {
				l.renderLayer(this.context)
			}
		})

		this.context.restore()

		this.layers.forEach(l => {
			if (!l.shouldTransform()) {
				l.renderLayer(this.context)
			}
		})

		requestAnimationFrame(() => this.renderGame());
	}

	tick() {
		this.layers.forEach(l => l.tick())
	}

	resize(width: number, height: number): void {
		this.canvas.width = Math.ceil(width / window.devicePixelRatio);
		this.canvas.height = Math.ceil(height / window.devicePixelRatio);
	}

}