import { EventBus } from "../../../core/EventBus";
import { GameView } from "../../../core/game/GameView";
import { TransformHandler } from "../TransformHandler";
import { ClassicCanvasTerritoryLayer } from "./ClassicCanvasTerritoryLayer";
import { TerrainLayer } from "./TerrainLayer";
import { TerritoryBackend } from "./TerritoryBackend";

export class ClassicTerritoryBackend implements TerritoryBackend {
  readonly id = "classic";

  private readonly terrainLayer: TerrainLayer;
  private readonly territoryLayer: ClassicCanvasTerritoryLayer;

  constructor(
    game: GameView,
    eventBus: EventBus,
    transformHandler: TransformHandler,
  ) {
    this.terrainLayer = new TerrainLayer(game, transformHandler);
    this.territoryLayer = new ClassicCanvasTerritoryLayer(
      game,
      eventBus,
      transformHandler,
    );
  }

  profileName(): string {
    return "ClassicTerritoryBackend:renderLayer";
  }

  shouldTransform(): boolean {
    return true;
  }

  init() {
    this.terrainLayer.init?.();
    this.territoryLayer.init?.();
  }

  tick() {
    this.terrainLayer.tick?.();
    this.territoryLayer.tick?.();
  }

  redraw() {
    this.terrainLayer.redraw?.();
    this.territoryLayer.redraw?.();
  }

  renderLayer(context: CanvasRenderingContext2D) {
    this.terrainLayer.renderLayer?.(context);
    this.territoryLayer.renderLayer?.(context);
  }

  dispose() {
    // Classic layers own only offscreen canvases and event-bus listeners.
    // The event bus does not currently expose unsubscribe hooks.
  }
}
