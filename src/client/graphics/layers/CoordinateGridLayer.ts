import { EventBus } from "../../../core/EventBus";
import { Cell } from "../../../core/game/Game";
import { GameView } from "../../../core/game/GameView";
import { AlternateViewEvent } from "../../InputHandler";
import { TransformHandler } from "../TransformHandler";
import { Layer } from "./Layer";

const GRID_COLUMNS = 10;
const GRID_ROWS = 10;
const GRID_LABELS = "ABCDEFGHIJ";
const LABEL_PADDING = 8;

export class CoordinateGridLayer implements Layer {
  private isVisible = false;

  constructor(
    private game: GameView,
    private eventBus: EventBus,
    private transformHandler: TransformHandler,
  ) {}

  init() {
    this.eventBus.on(AlternateViewEvent, (event) => {
      this.isVisible = event.alternateView;
    });
  }

  shouldTransform(): boolean {
    return false;
  }

  renderLayer(context: CanvasRenderingContext2D) {
    if (!this.isVisible) return;

    const width = this.game.width();
    const height = this.game.height();
    if (width <= 0 || height <= 0) return;

    const cellWidth = width / GRID_COLUMNS;
    const cellHeight = height / GRID_ROWS;
    const canvasWidth = context.canvas.width;
    const canvasHeight = context.canvas.height;

    context.save();
    context.strokeStyle = "rgba(255, 255, 255, 0.18)";
    context.lineWidth = 1;
    context.beginPath();

    for (let col = 0; col <= GRID_COLUMNS; col++) {
      const worldX = col * cellWidth;
      const screenX = this.transformHandler.worldToScreenCoordinates(
        new Cell(worldX, 0),
      ).x;
      if (screenX < -1 || screenX > canvasWidth + 1) continue;
      context.moveTo(screenX, 0);
      context.lineTo(screenX, canvasHeight);
    }

    for (let row = 0; row <= GRID_ROWS; row++) {
      const worldY = row * cellHeight;
      const screenY = this.transformHandler.worldToScreenCoordinates(
        new Cell(0, worldY),
      ).y;
      if (screenY < -1 || screenY > canvasHeight + 1) continue;
      context.moveTo(0, screenY);
      context.lineTo(canvasWidth, screenY);
    }

    context.stroke();

    context.fillStyle = "rgba(255, 255, 255, 0.9)";
    context.font = "12px monospace";
    context.textAlign = "center";
    context.textBaseline = "top";

    for (let col = 0; col < GRID_COLUMNS; col++) {
      const centerX = (col + 0.5) * cellWidth;
      const screenX = this.transformHandler.worldToScreenCoordinates(
        new Cell(centerX, 0),
      ).x;
      if (screenX < 0 || screenX > canvasWidth) continue;
      context.fillText(String(col + 1), screenX, LABEL_PADDING);
    }

    context.textAlign = "left";
    context.textBaseline = "middle";

    for (let row = 0; row < GRID_ROWS; row++) {
      const centerY = (row + 0.5) * cellHeight;
      const screenY = this.transformHandler.worldToScreenCoordinates(
        new Cell(0, centerY),
      ).y;
      if (screenY < 0 || screenY > canvasHeight) continue;
      context.fillText(GRID_LABELS[row], LABEL_PADDING, screenY);
    }

    context.restore();
  }
}
