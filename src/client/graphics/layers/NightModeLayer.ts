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

    const maxDist = Math.sqrt(
      Math.max(this.mouseX, this.transformHandler.width() - this.mouseX) ** 2 +
        Math.max(
          this.mouseY,
          this.transformHandler.boundingRect().height - this.mouseY,
        ) **
          2,
    );

    for (
      let y = 0;
      y < this.transformHandler.boundingRect().height;
      y += cellSize
    ) {
      for (let x = 0; x < this.transformHandler.width(); x += cellSize) {
        const dx = x + cellSize / 2 - this.mouseX;
        const dy = y + cellSize / 2 - this.mouseY;
        const dist = Math.sqrt(dx * dx + dy * dy);

        const blend =
          1 - this.darkenAlpha + (1 - dist / maxDist) * this.darkenAlpha;

        const color = [
          Math.round(this.darkenColor[0] + blend * (255 - this.darkenColor[0])),
          Math.round(this.darkenColor[1] + blend * (255 - this.darkenColor[1])),
          Math.round(this.darkenColor[2] + blend * (255 - this.darkenColor[2])),
        ];

        context.fillStyle = `rgba(${color[0]}, ${color[1]}, ${color[2]}, 1)`;
        context.fillRect(x, y, cellSize, cellSize);
      }
    }
  }
}
