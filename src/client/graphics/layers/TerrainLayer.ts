import { Theme } from "../../../core/configuration/Config";
import { GameView } from "../../../core/game/GameView";
import { TransformHandler } from "../TransformHandler";
import { Layer } from "./Layer";

export class TerrainLayer implements Layer {
  private canvas: HTMLCanvasElement | undefined;
  private context: CanvasRenderingContext2D | undefined;
  private imageData: ImageData | undefined;
  private theme: Theme | undefined;

  constructor(
    private readonly game: GameView,
    private readonly transformHandler: TransformHandler,
  ) {}
  shouldTransform(): boolean {
    return true;
  }
  tick() {
    if (this.game.config().theme() !== this.theme) {
      this.redraw();
    }
  }

  init() {
    console.log("redrew terrain layer");
    this.redraw();
  }

  redraw(): void {
    this.canvas = document.createElement("canvas");
    const context = this.canvas.getContext("2d");
    if (context === null) throw new Error("2d context not supported");
    this.context = context;

    this.imageData = this.context.getImageData(
      0,
      0,
      this.game.width(),
      this.game.height(),
    );
    this.initImageData();
    this.canvas.width = this.game.width();
    this.canvas.height = this.game.height();
    this.context.putImageData(this.imageData, 0, 0);
  }

  initImageData() {
    this.theme = this.game.config().theme();
    this.game.forEachTile((tile) => {
      const terrainColor = this.theme?.terrainColor(this.game, tile);
      if (terrainColor === undefined || this.imageData === undefined) return;
      // TODO: isn'te tileref and index the same?
      const index = this.game.y(tile) * this.game.width() + this.game.x(tile);
      const offset = index * 4;
      this.imageData.data[offset] = terrainColor.rgba.r;
      this.imageData.data[offset + 1] = terrainColor.rgba.g;
      this.imageData.data[offset + 2] = terrainColor.rgba.b;
      this.imageData.data[offset + 3] = (terrainColor.rgba.a * 255) | 0;
    });
  }

  renderLayer(context: CanvasRenderingContext2D) {
    if (this.transformHandler.scale < 1) {
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "low";
    } else {
      context.imageSmoothingEnabled = false;
    }
    if (this.canvas === undefined) throw new Error("Not initialized");
    context.drawImage(
      this.canvas,
      -this.game.width() / 2,
      -this.game.height() / 2,
      this.game.width(),
      this.game.height(),
    );
  }
}
