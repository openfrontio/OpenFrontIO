import { EventBus } from "../../core/EventBus";
import { Cell } from "../../core/game/Game";
import { GameView } from "../../core/game/GameView";
import { DragEvent, ZoomEvent } from "../InputHandler";
import { GoToPlayerEvent } from "./layers/Leaderboard";

export class TransformHandler {
  public scale: number = 1.8;
  private offsetX: number = -350;
  private offsetY: number = -200;

  private target: Cell;
  private intervalID = null;
  private changed = false;

  constructor(
    private game: GameView,
    private eventBus: EventBus,
    private canvas: HTMLCanvasElement,
  ) {
    this.eventBus.on(ZoomEvent, (e) => this.onZoom(e));
    this.eventBus.on(DragEvent, (e) => this.onMove(e));
    this.eventBus.on(GoToPlayerEvent, (e) => this.onGoToPlayer(e));
  }

  boundingRect(): DOMRect {
    return this.canvas.getBoundingClientRect();
  }

  width(): number {
    return this.boundingRect().width;
  }
  hasChanged(): boolean {
    return this.changed;
  }

  handleTransform(context: CanvasRenderingContext2D) {
    // Disable image smoothing for pixelated effect
    context.imageSmoothingEnabled = false;

    // Apply zoom and pan
    context.setTransform(
      this.scale,
      0,
      0,
      this.scale,
      this.game.width() / 2 - this.offsetX * this.scale,
      this.game.height() / 2 - this.offsetY * this.scale,
    );
    this.changed = false;
  }

  worldToScreenCoordinates(cell: Cell): { x: number; y: number } {
    // Step 1: Convert from Cell coordinates to game coordinates
    // (reverse of Math.floor operation - we'll use the exact values)
    const gameX = cell.x;
    const gameY = cell.y;

    // Step 2: Reverse the game center offset calculation
    // Original: gameX = centerX + this.game.width() / 2
    // Therefore: centerX = gameX - this.game.width() / 2
    const centerX = gameX - this.game.width() / 2;
    const centerY = gameY - this.game.height() / 2;

    // Step 3: Reverse the world point calculation
    // Original: centerX = (canvasX - this.game.width() / 2) / this.scale + this.offsetX
    // Therefore: canvasX = (centerX - this.offsetX) * this.scale + this.game.width() / 2
    const canvasX =
      (centerX - this.offsetX) * this.scale + this.game.width() / 2;
    const canvasY =
      (centerY - this.offsetY) * this.scale + this.game.height() / 2;

    // Step 4: Convert canvas coordinates back to screen coordinates
    const canvasRect = this.boundingRect();
    const screenX = canvasX + canvasRect.left;
    const screenY = canvasY + canvasRect.top;
    return { x: screenX, y: screenY };
  }

  screenToWorldCoordinates(screenX: number, screenY: number): Cell {
    const canvasRect = this.boundingRect();
    const canvasX = screenX - canvasRect.left;
    const canvasY = screenY - canvasRect.top;

    // Calculate the world point we want to zoom towards
    const centerX =
      (canvasX - this.game.width() / 2) / this.scale + this.offsetX;
    const centerY =
      (canvasY - this.game.height() / 2) / this.scale + this.offsetY;

    const gameX = centerX + this.game.width() / 2;
    const gameY = centerY + this.game.height() / 2;

    return new Cell(Math.floor(gameX), Math.floor(gameY));
  }

  screenBoundingRect(): [Cell, Cell] {
    const LeftX = -this.game.width() / 2 / this.scale + this.offsetX;
    const TopY = -this.game.height() / 2 / this.scale + this.offsetY;

    const gameLeftX = LeftX + this.game.width() / 2;
    const gameTopY = TopY + this.game.height() / 2;

    const rightX =
      (screen.width - this.game.width() / 2) / this.scale + this.offsetX;
    const rightY =
      (screen.height - this.game.height() / 2) / this.scale + this.offsetY;

    const gameRightX = rightX + this.game.width() / 2;
    const gameBottomY = rightY + this.game.height() / 2;

    return [
      new Cell(Math.floor(gameLeftX), Math.floor(gameTopY)),
      new Cell(Math.floor(gameRightX), Math.floor(gameBottomY)),
    ];
  }

  isOnScreen(cell: Cell): boolean {
    const [topLeft, bottomRight] = this.screenBoundingRect();
    return (
      cell.x > topLeft.x &&
      cell.x < bottomRight.x &&
      cell.y > topLeft.y &&
      cell.y < bottomRight.y
    );
  }

  screenCenter(): { screenX: number; screenY: number } {
    const [upperLeft, bottomRight] = this.screenBoundingRect();
    return {
      screenX: upperLeft.x + Math.floor((bottomRight.x - upperLeft.x) / 2),
      screenY: upperLeft.y + Math.floor((bottomRight.y - upperLeft.y) / 2),
    };
  }

  onGoToPlayer(event: GoToPlayerEvent) {
    this.clearTarget();
    this.target = new Cell(
      event.player.nameLocation().x,
      event.player.nameLocation().y,
    );
    this.intervalID = setInterval(() => this.goTo(), 1);
  }

  private goTo() {
    const { screenX, screenY } = this.screenCenter();
    const screenMapCenter = new Cell(screenX, screenY);

    if (
      this.game.manhattanDist(
        this.game.ref(screenX, screenY),
        this.game.ref(this.target.x, this.target.y),
      ) < 2
    ) {
      this.clearTarget();
      return;
    }

    const dX = Math.abs(screenMapCenter.x - this.target.x);
    if (dX > 2) {
      const offsetDx = Math.max(1, Math.floor(dX / 25));
      if (screenMapCenter.x > this.target.x) {
        this.offsetX -= offsetDx;
      } else {
        this.offsetX += offsetDx;
      }
    }
    const dY = Math.abs(screenMapCenter.y - this.target.y);
    if (dY > 2) {
      const offsetDy = Math.max(1, Math.floor(dY / 25));
      if (screenMapCenter.y > this.target.y) {
        this.offsetY -= offsetDy;
      } else {
        this.offsetY += offsetDy;
      }
    }
    this.changed = true;
  }

  onZoom(event: ZoomEvent) {
    this.clearTarget();
    const oldScale = this.scale;
    const zoomFactor = 1 + event.delta / 600;
    this.scale /= zoomFactor;

    // Clamp the scale to prevent extreme zooming
    this.scale = Math.max(0.2, Math.min(20, this.scale));

    const canvasRect = this.boundingRect();
    const canvasX = event.x - canvasRect.left;
    const canvasY = event.y - canvasRect.top;

    // Calculate the world point we want to zoom towards
    const zoomPointX =
      (canvasX - this.game.width() / 2) / oldScale + this.offsetX;
    const zoomPointY =
      (canvasY - this.game.height() / 2) / oldScale + this.offsetY;

    // Adjust the offset
    this.offsetX = zoomPointX - (canvasX - this.game.width() / 2) / this.scale;
    this.offsetY = zoomPointY - (canvasY - this.game.height() / 2) / this.scale;
    this.changed = true;
  }

  onMove(event: DragEvent) {
    this.clearTarget();
    this.offsetX -= event.deltaX / this.scale;
    this.offsetY -= event.deltaY / this.scale;
    this.changed = true;
  }

  private clearTarget() {
    if (this.intervalID != null) {
      clearInterval(this.intervalID);
      this.intervalID = null;
    }
    this.target = null;
  }
}
