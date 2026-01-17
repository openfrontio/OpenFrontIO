import { EventBus } from "../../../core/EventBus";
import { Cell } from "../../../core/game/Game";
import { GameView } from "../../../core/game/GameView";
import { UserSettings } from "../../../core/game/UserSettings";
import { AlternateViewEvent } from "../../InputHandler";
import { TransformHandler } from "../TransformHandler";
import { Layer } from "./Layer";

const BASE_CELL_COUNT = 10;
const MAX_COLUMNS = 50;
const MIN_ROWS = 2;
const LABEL_PADDING = 8;
const LABEL_BG_PADDING = 4;

const toAlphaLabel = (index: number): string => {
  let value = index;
  let label = "";
  do {
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26) - 1;
  } while (value >= 0);
  return label;
};

const computeGrid = (width: number, height: number) => {
  let cellSize = Math.min(width, height) / BASE_CELL_COUNT;
  let rows = Math.max(1, Math.round(height / cellSize));
  let cols = Math.max(1, Math.round(width / cellSize));

  if (cols > MAX_COLUMNS) {
    const maxRowsForCols = Math.floor((MAX_COLUMNS * height) / width);
    rows = Math.max(MIN_ROWS, Math.min(rows, maxRowsForCols));
  }

  cellSize = height / rows;
  cols = Math.max(1, Math.round(width / cellSize));

  return { cellSize, rows, cols };
};

export class CoordinateGridLayer implements Layer {
  private isVisible = false;

  constructor(
    private game: GameView,
    private eventBus: EventBus,
    private transformHandler: TransformHandler,
    private userSettings: UserSettings,
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
    if (!this.isVisible || !this.userSettings.coordinateGridEnabled()) return;

    const width = this.game.width();
    const height = this.game.height();
    if (width <= 0 || height <= 0) return;

    const { cellSize, rows, cols } = computeGrid(width, height);
    const cellWidth = cellSize;
    const cellHeight = cellSize;
    const canvasWidth = context.canvas.width;
    const canvasHeight = context.canvas.height;

    context.save();
    context.strokeStyle = "rgba(255, 255, 255, 0.35)";
    context.lineWidth = 1.25;
    context.beginPath();

    for (let col = 0; col <= cols; col++) {
      const worldX = col * cellWidth;
      if (worldX > width) break;
      const screenX = this.transformHandler.worldToScreenCoordinates(
        new Cell(worldX, 0),
      ).x;
      if (screenX < -1 || screenX > canvasWidth + 1) continue;
      context.moveTo(screenX, 0);
      context.lineTo(screenX, canvasHeight);
    }

    for (let row = 0; row <= rows; row++) {
      const worldY = row * cellHeight;
      if (worldY > height) break;
      const screenY = this.transformHandler.worldToScreenCoordinates(
        new Cell(0, worldY),
      ).y;
      if (screenY < -1 || screenY > canvasHeight + 1) continue;
      context.moveTo(0, screenY);
      context.lineTo(canvasWidth, screenY);
    }

    context.stroke();

    context.font = "12px monospace";

    const drawLabel = (
      text: string,
      x: number,
      y: number,
      align: CanvasTextAlign,
      baseline: CanvasTextBaseline,
    ) => {
      context.textAlign = align;
      context.textBaseline = baseline;
      const metrics = context.measureText(text);
      const textWidth = metrics.width;
      const textHeight =
        (metrics.actualBoundingBoxAscent ?? 8) +
        (metrics.actualBoundingBoxDescent ?? 4);

      let rectX = x;
      let rectY = y;

      if (align === "center") rectX -= textWidth / 2;
      if (align === "right") rectX -= textWidth;
      if (baseline === "middle") rectY -= textHeight / 2;
      if (baseline === "bottom") rectY -= textHeight;

      context.fillStyle = "rgba(0, 0, 0, 0.55)";
      context.fillRect(
        rectX - LABEL_BG_PADDING,
        rectY - LABEL_BG_PADDING,
        textWidth + LABEL_BG_PADDING * 2,
        textHeight + LABEL_BG_PADDING * 2,
      );

      context.fillStyle = "rgba(255, 255, 255, 0.95)";
      context.fillText(text, x, y);
    };

    for (let col = 0; col < cols; col++) {
      const centerX = (col + 0.5) * cellWidth;
      if (centerX > width) break;
      const screenX = this.transformHandler.worldToScreenCoordinates(
        new Cell(centerX, 0),
      ).x;
      if (screenX < 0 || screenX > canvasWidth) continue;
      drawLabel(String(col + 1), screenX, LABEL_PADDING, "center", "top");
    }

    for (let row = 0; row < rows; row++) {
      const centerY = (row + 0.5) * cellHeight;
      if (centerY > height) break;
      const screenY = this.transformHandler.worldToScreenCoordinates(
        new Cell(0, centerY),
      ).y;
      if (screenY < 0 || screenY > canvasHeight) continue;
      drawLabel(toAlphaLabel(row), LABEL_PADDING, screenY, "left", "middle");
    }

    context.restore();
  }
}
