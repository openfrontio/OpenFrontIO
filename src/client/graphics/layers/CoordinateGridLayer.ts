import { EventBus } from "../../../core/EventBus";
import { Cell } from "../../../core/game/Game";
import { GameView } from "../../../core/game/GameView";
import {
  AlternateViewEvent,
  ToggleCoordinateGridEvent,
} from "../../InputHandler";
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
  // Initial square-ish estimate
  let cellSize = Math.min(width, height) / BASE_CELL_COUNT;
  let rows = Math.max(1, Math.round(height / cellSize));
  let cols = Math.max(1, Math.round(width / cellSize));

  // Cap columns and adjust rows accordingly
  if (cols > MAX_COLUMNS) {
    const maxRowsForCols = Math.floor((MAX_COLUMNS * height) / width);
    rows = Math.max(MIN_ROWS, Math.min(rows, maxRowsForCols));
    cols = MAX_COLUMNS;
  }

  cellSize = Math.min(width / cols, height / rows);
  const fullCols = Math.max(1, Math.floor(width / cellSize));
  const fullRows = Math.max(1, Math.floor(height / cellSize));

  const remainderX = Math.max(0, width - fullCols * cellSize);
  const remainderY = Math.max(0, height - fullRows * cellSize);

  const hasExtraCol = remainderX > 0.001;
  const hasExtraRow = remainderY > 0.001;

  const totalCols = fullCols + (hasExtraCol ? 1 : 0);
  const totalRows = fullRows + (hasExtraRow ? 1 : 0);

  const lastColWidth = hasExtraCol ? remainderX : cellSize;
  const lastRowHeight = hasExtraRow ? remainderY : cellSize;

  return {
    cellSize,
    rows: totalRows,
    cols: totalCols,
    fullCols,
    fullRows,
    lastColWidth,
    lastRowHeight,
    hasExtraCol,
    hasExtraRow,
    gridWidth: width,
    gridHeight: height,
  };
};

export class CoordinateGridLayer implements Layer {
  private isVisible = false;
  private alternateView = false;

  constructor(
    private game: GameView,
    private eventBus: EventBus,
    private transformHandler: TransformHandler,
  ) {}

  init() {
    this.eventBus.on(ToggleCoordinateGridEvent, (event) => {
      this.isVisible = event.enabled;
    });
    this.eventBus.on(AlternateViewEvent, (event) => {
      this.alternateView = event.alternateView;
    });
  }

  shouldTransform(): boolean {
    return false;
  }

  renderLayer(context: CanvasRenderingContext2D) {
    if (!this.isVisible && !this.alternateView) return;

    const width = this.game.width();
    const height = this.game.height();
    if (width <= 0 || height <= 0) return;

    const {
      cellSize,
      rows,
      cols,
      fullCols,
      fullRows,
      lastColWidth,
      lastRowHeight,
      hasExtraCol,
      hasExtraRow,
      gridWidth,
      gridHeight,
    } = computeGrid(width, height);
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
    const mapLeftScreen = Math.min(mapLeftScreenRaw, mapRightScreenRaw);
    const mapTopWorld = 0;
    const mapLeftWorld = 0;

    context.save();
    context.strokeStyle = "rgba(255, 255, 255, 0.35)";
    context.lineWidth = 1.25;
    context.beginPath();

    for (let col = 0; col <= fullCols; col++) {
      const worldX = col * cellWidth + mapLeftWorld;
      const screenX = this.transformHandler.worldToScreenCoordinates(
        new Cell(worldX, mapTopWorld),
      ).x;
      if (screenX < -1 || screenX > canvasWidth + 1) continue;
      const screenBottom = this.transformHandler.worldToScreenCoordinates(
        new Cell(worldX, gridHeight),
      ).y;
      context.moveTo(screenX, mapTopScreen);
      context.lineTo(screenX, screenBottom);
    }
    // Final vertical line at map right edge only if grid fits perfectly
    if (!hasExtraCol) {
      const mapRightLine = this.transformHandler.worldToScreenCoordinates(
        new Cell(gridWidth, mapTopWorld),
      ).x;
      context.moveTo(mapRightLine, mapTopScreen);
      context.lineTo(
        mapRightLine,
        this.transformHandler.worldToScreenCoordinates(
          new Cell(gridWidth, gridHeight),
        ).y,
      );
    }

    for (let row = 0; row <= fullRows; row++) {
      const worldY = row * cellHeight + mapTopWorld;
      const screenY = this.transformHandler.worldToScreenCoordinates(
        new Cell(mapLeftWorld, worldY),
      ).y;
      if (screenY < -1 || screenY > canvasHeight + 1) continue;
      const screenRight = this.transformHandler.worldToScreenCoordinates(
        new Cell(gridWidth, worldY),
      ).x;
      context.moveTo(mapLeftScreen, screenY);
      context.lineTo(screenRight, screenY);
    }
    // Final horizontal line at map bottom edge only if grid fits perfectly
    if (!hasExtraRow) {
      const mapBottomLine = this.transformHandler.worldToScreenCoordinates(
        new Cell(mapLeftWorld, gridHeight),
      ).y;
      context.moveTo(mapLeftScreen, mapBottomLine);
      context.lineTo(
        this.transformHandler.worldToScreenCoordinates(
          new Cell(gridWidth, gridHeight),
        ).x,
        mapBottomLine,
      );
    }

    context.stroke();

    context.font = "12px monospace";

    const drawLabel = (text: string, x: number, y: number) => {
      context.textAlign = "left";
      context.textBaseline = "top";
      context.fillStyle = "rgba(20, 20, 20, 0.9)";
      context.fillText(text, x, y);
    };

    // Render per-cell labels (like A1, B1, etc.) at cell top-left
    const fontSize = Math.min(
      16,
      Math.max(9, 10 + (this.transformHandler.scale - 1) * 1.2),
    );
    context.font = `${fontSize}px monospace`;
    for (let row = 0; row < rows; row++) {
      const rowLabel = toAlphaLabel(row);
      const startY = row * cellHeight;
      const rowHeight = row < fullRows ? cellHeight : lastRowHeight;
      const centerY = startY + rowHeight / 2;
      const screenY = this.transformHandler.worldToScreenCoordinates(
        new Cell(0, centerY),
      ).y;
      if (screenY < -LABEL_PADDING || screenY > canvasHeight + LABEL_PADDING)
        continue;

      for (let col = 0; col < cols; col++) {
        const startX = col * cellWidth;
        const colWidth = col < fullCols ? cellWidth : lastColWidth;
        const centerX = startX + colWidth / 2;
        const screenX = this.transformHandler.worldToScreenCoordinates(
          new Cell(centerX, centerY),
        ).x;
        if (screenX < -LABEL_PADDING || screenX > canvasWidth + LABEL_PADDING)
          continue;

        // Position at cell top-left in screen space
        const cellTopLeft = this.transformHandler.worldToScreenCoordinates(
          new Cell(startX, startY),
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
