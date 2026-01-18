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

    const mapTopScreenRaw = this.transformHandler.worldToScreenCoordinates(
      new Cell(0, 0),
    ).y;
    const mapBottomScreenRaw = this.transformHandler.worldToScreenCoordinates(
      new Cell(0, height),
    ).y;
    const mapLeftScreenRaw = this.transformHandler.worldToScreenCoordinates(
      new Cell(0, 0),
    ).x;
    const mapRightScreenRaw = this.transformHandler.worldToScreenCoordinates(
      new Cell(width, 0),
    ).x;

    const mapTopScreen = Math.min(mapTopScreenRaw, mapBottomScreenRaw);
    const mapBottomScreen = Math.max(mapTopScreenRaw, mapBottomScreenRaw);
    const mapLeftScreen = Math.min(mapLeftScreenRaw, mapRightScreenRaw);
    const mapRightScreen = Math.max(mapLeftScreenRaw, mapRightScreenRaw);

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
      context.moveTo(screenX, mapTopScreen);
      context.lineTo(screenX, mapBottomScreen);
    }

    for (let row = 0; row <= rows; row++) {
      const worldY = row * cellHeight;
      if (worldY > height) break;
      const screenY = this.transformHandler.worldToScreenCoordinates(
        new Cell(0, worldY),
      ).y;
      if (screenY < -1 || screenY > canvasHeight + 1) continue;
      context.moveTo(mapLeftScreen, screenY);
      context.lineTo(mapRightScreen, screenY);
    }

    context.stroke();

    context.font = "12px monospace";

    const drawLabel = (text: string, x: number, y: number) => {
      context.textAlign = "left";
      context.textBaseline = "top";
      context.fillStyle = "rgba(20, 20, 20, 0.9)";
      context.fillText(text, x, y);
    };

    // Render per-cell labels (e.g., A1) at cell top-left
    const fontSize = Math.min(
      16,
      Math.max(9, 10 + (this.transformHandler.scale - 1) * 1.2),
    );
    context.font = `${fontSize}px monospace`;
    for (let row = 0; row < rows; row++) {
      const rowLabel = toAlphaLabel(row);
      const centerY = (row + 0.5) * cellHeight;
      if (centerY > height) break;
      const screenY = this.transformHandler.worldToScreenCoordinates(
        new Cell(0, centerY),
      ).y;
      if (screenY < -LABEL_PADDING || screenY > canvasHeight + LABEL_PADDING)
        continue;

      for (let col = 0; col < cols; col++) {
        const centerX = (col + 0.5) * cellWidth;
        if (centerX > width) break;
        const screenX = this.transformHandler.worldToScreenCoordinates(
          new Cell(centerX, centerY),
        ).x;
        if (screenX < -LABEL_PADDING || screenX > canvasWidth + LABEL_PADDING)
          continue;

        // Position at cell top-left in screen space
        const cellTopLeft = this.transformHandler.worldToScreenCoordinates(
          new Cell(centerX - cellWidth / 2, centerY - cellHeight / 2),
        );
        drawLabel(
          `${rowLabel}${col + 1}`,
          cellTopLeft.x + LABEL_PADDING,
          cellTopLeft.y + LABEL_PADDING,
        );
      }
    }

    context.restore();
  }
}
