import { Theme } from "../../../core/configuration/Config";
import { GameView } from "../../../core/game/GameView";
import { TransformHandler } from "../TransformHandler";
import { Layer } from "./Layer";

interface TerrainChunk {
  x: number;
  y: number;
  width: number;
  height: number;
  canvas: HTMLCanvasElement;
}

export class TerrainLayer implements Layer {
  private chunks: TerrainChunk[] = [];
  private chunkSize = 1024;
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
    this.chunks = [];
    this.theme = this.game.config().theme();
    const width = this.game.width();
    const height = this.game.height();
    const chunksX = Math.ceil(width / this.chunkSize);

    const chunkContexts: CanvasRenderingContext2D[] = [];
    const chunkImageData: ImageData[] = [];

    for (let cy = 0; cy < height; cy += this.chunkSize) {
      for (let cx = 0; cx < width; cx += this.chunkSize) {
        const cw = Math.min(this.chunkSize, width - cx);
        const ch = Math.min(this.chunkSize, height - cy);

        const canvas = document.createElement("canvas");
        canvas.width = cw;
        canvas.height = ch;

        const context = canvas.getContext("2d", { alpha: false });
        if (!context) throw new Error("2d context not supported");

        this.chunks.push({
          x: cx,
          y: cy,
          width: cw,
          height: ch,
          canvas,
        });
        chunkContexts.push(context);
        chunkImageData.push(context.createImageData(cw, ch));
      }
    }

    this.game.forEachTile((tile) => {
      const tx = this.game.x(tile);
      const ty = this.game.y(tile);
      const cx = Math.floor(tx / this.chunkSize);
      const cy = Math.floor(ty / this.chunkSize);
      const index = cy * chunksX + cx;
      const chunk = this.chunks[index];
      const imageData = chunkImageData[index];

      const lx = tx - chunk.x;
      const ly = ty - chunk.y;
      const offset = (ly * chunk.width + lx) * 4;

      const terrainColor = this.theme.terrainColor(this.game, tile);
      imageData.data[offset] = terrainColor.rgba.r;
      imageData.data[offset + 1] = terrainColor.rgba.g;
      imageData.data[offset + 2] = terrainColor.rgba.b;
      imageData.data[offset + 3] = 255;
    });

    for (let i = 0; i < this.chunks.length; i++) {
      chunkContexts[i].putImageData(chunkImageData[i], 0, 0);
    }
  }

  renderLayer(context: CanvasRenderingContext2D) {
    if (this.transformHandler.scale < 1) {
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "low";
    } else {
      context.imageSmoothingEnabled = false;
    }

    const [topLeft, bottomRight] = this.transformHandler.screenBoundingRect();
    const vx0 = topLeft.x;
    const vy0 = topLeft.y;
    const vx1 = bottomRight.x;
    const vy1 = bottomRight.y;

    const offsetX = -this.game.width() / 2;
    const offsetY = -this.game.height() / 2;
    const overlap = 1 / this.transformHandler.scale;

    for (const chunk of this.chunks) {
      if (
        chunk.x + chunk.width < vx0 ||
        chunk.x > vx1 ||
        chunk.y + chunk.height < vy0 ||
        chunk.y > vy1
      ) {
        continue;
      }

      context.drawImage(
        chunk.canvas,
        offsetX + chunk.x,
        offsetY + chunk.y,
        chunk.width + overlap,
        chunk.height + overlap,
      );
    }
  }
}
