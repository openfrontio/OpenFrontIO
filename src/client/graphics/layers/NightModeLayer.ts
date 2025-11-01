//import { GameView } from "../../../core/game/GameView";
import { UserSettings } from "../../../core/game/UserSettings";
import { TransformHandler } from "../TransformHandler";
import { Layer } from "./Layer";

export class NightModeLayer implements Layer {
  private darkenColor: [number, number, number] = [0, 0, 0];
  private darkenAlpha: number = 0.8; // separated from darkenColor for more readable code

  private flashlightRadius: number = 50; // in-game tiles

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
    if (!this.userSettingsInstance.nightMode()) return;

    const width = this.transformHandler.width();
    const height = this.transformHandler.boundingRect().height;
    const cellSize = this.transformHandler.scale;

    // Fill the entire screen with dark
    context.fillStyle = `rgba(${this.darkenColor[0]}, ${this.darkenColor[1]}, ${this.darkenColor[2]}, ${this.darkenAlpha})`;
    context.fillRect(0, 0, width, height);

    const startX =
      Math.floor(
        Math.max(this.mouseX - this.flashlightRadius * cellSize, 0) / cellSize,
      ) * cellSize;
    const endX =
      Math.ceil(
        Math.min(this.mouseX + this.flashlightRadius * cellSize, width) /
          cellSize,
      ) * cellSize;

    const startY =
      Math.floor(
        Math.max(this.mouseY - this.flashlightRadius * cellSize, 0) / cellSize,
      ) * cellSize;
    const endY =
      Math.ceil(
        Math.min(this.mouseY + this.flashlightRadius * cellSize, height) /
          cellSize,
      ) * cellSize;

    for (let y = startY; y < endY; y += cellSize) {
      for (let x = startX; x < endX; x += cellSize) {
        // distance from mouse in tile units
        const dist = Math.hypot(
          (this.mouseX - (x + cellSize / 2)) / cellSize,
          (this.mouseY - (y + cellSize / 2)) / cellSize,
        );

        // Determine brightness factor (adjust 3 for flashlight size)
        const brightness = Math.max(0, 1 - dist / this.flashlightRadius);

        if (brightness > 0) {
          context.fillStyle = `rgba(200,200,130,${(this.darkenAlpha / 2) * brightness})`;
          context.fillRect(x, y, cellSize, cellSize);
        }
      }
    }
  }
}
