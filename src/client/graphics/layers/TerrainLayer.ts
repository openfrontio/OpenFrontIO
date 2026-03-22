import { Theme } from "../../../core/configuration/Config";
import { GameView } from "../../../core/game/GameView";
import { TransformHandler } from "../TransformHandler";
import { Layer } from "./Layer";

export class TerrainLayer implements Layer {
  private canvas: HTMLCanvasElement;
  private context: CanvasRenderingContext2D;
  private imageData: ImageData;
  private theme: Theme;

  constructor(
    private game: GameView,
    private transformHandler: TransformHandler,
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
    this.canvas.width = this.game.width();
    this.canvas.height = this.game.height();

    const context = this.canvas.getContext("2d", { alpha: false });
    if (context === null) throw new Error("2d context not supported");
    this.context = context;

    this.imageData = this.context.createImageData(
      this.canvas.width,
      this.canvas.height,
    );

    this.initImageData();
    this.context.putImageData(this.imageData, 0, 0);
  }

  initImageData() {
    this.theme = this.game.config().theme();
    this.game.forEachTile((tile) => {
      const terrainColor = this.theme.terrainColor(this.game, tile);
      // TODO: isn't tileref and index the same?
      const index = this.game.y(tile) * this.game.width() + this.game.x(tile);
      const offset = index * 4;
      this.imageData.data[offset] = terrainColor.rgba.r;
      this.imageData.data[offset + 1] = terrainColor.rgba.g;
      this.imageData.data[offset + 2] = terrainColor.rgba.b;
      this.imageData.data[offset + 3] = 255;
    });
  }

  renderLayer(context: CanvasRenderingContext2D) {
    if (this.transformHandler.scale < 1) {
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "low";
    } else {
      context.imageSmoothingEnabled = false;
    }

    const [topLeft, bottomRight] = this.transformHandler.screenBoundingRect();
    const vx0 = Math.max(0, Math.floor(topLeft.x));
    const vy0 = Math.max(0, Math.floor(topLeft.y));
    const vx1 = Math.min(this.game.width(), Math.ceil(bottomRight.x));
    const vy1 = Math.min(this.game.height(), Math.ceil(bottomRight.y));

    const w = vx1 - vx0;
    const h = vy1 - vy0;

    if (w > 0 && h > 0) {
      context.drawImage(
        this.canvas,
        vx0,
        vy0,
        w,
        h,
        -this.game.width() / 2 + vx0,
        -this.game.height() / 2 + vy0,
        w,
        h,
      );
    }
  }
}
