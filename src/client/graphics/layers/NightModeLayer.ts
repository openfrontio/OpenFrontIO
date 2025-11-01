//import { GameView } from "../../../core/game/GameView";
import { UserSettings } from "../../../core/game/UserSettings";
import { TransformHandler } from "../TransformHandler";
import { Layer } from "./Layer";

export class NightModeLayer implements Layer {
  private darkenColor: [number, number, number] = [0, 0, 0];
  private darkenAlpha: number = 0.8; // separated from darkenColor for more readable code

  //private flashlightRadius: number = 125; // in-game tiles

  private userSettingsInstance = new UserSettings();

  private mouseX: number = 0;
  private mouseY: number = 0;
  private handleMouseMove(event: MouseEvent) {
    this.mouseX = event.clientX;
    this.mouseY = event.clientY;
  }

  init(): void {}
  tick(): void {}
  redraw(): void {}

  constructor(private transformHandler: TransformHandler) {
    if (this.userSettingsInstance.nightMode()) {
      document.documentElement.classList.add("night");
    } else {
      document.documentElement.classList.remove("night");
    }
    document.addEventListener("mousemove", (e) => this.handleMouseMove(e));
  }

  renderLayer(context: CanvasRenderingContext2D): void {
    if (!this.userSettingsInstance.nightMode()) {
      return;
    } // end function early
    //context = html canvas

    context.fillStyle = `rgba(${this.darkenColor[0]}, ${this.darkenColor[1]}, ${this.darkenColor[2]}, ${this.darkenAlpha})`;
    context.fillRect(
      0,
      0,
      this.transformHandler.width(),
      this.transformHandler.boundingRect().height,
    );

    const cellSize = this.transformHandler.scale;

    for (
      let y = 0;
      y < this.transformHandler.boundingRect().height;
      y += cellSize
    ) {
      for (let x = 0; x < this.transformHandler.width(); x += cellSize) {
        const dist = Math.hypot(
          Math.abs(this.mouseX - x) / cellSize,
          Math.abs(this.mouseY - y) / cellSize,
        );

        const final = context.getImageData(x, y, cellSize, cellSize).data;

        const originalPixel = [
          final[0] + (final[0] / (1 - this.darkenAlpha) - final[0]) * dist,
          final[1] + (final[1] / (1 - this.darkenAlpha) - final[1]) * dist,
          final[2] + (final[2] / (1 - this.darkenAlpha) - final[2]) * dist,
        ];

        context.fillStyle = `rgba(${originalPixel[0]}, ${originalPixel[1]}, ${originalPixel[2]}, 1)`;
        context.fillRect(x, y, cellSize, cellSize);
      }
    }
  }
}
