import { EventBus } from "../../../core/EventBus";
import { GameView } from "../../../core/game/GameView";
import {
  CloseViewEvent,
  WarshipSelectionBoxCancelEvent,
  WarshipSelectionBoxCompleteEvent,
  WarshipSelectionBoxUpdateEvent,
} from "../../InputHandler";
import { TransformHandler } from "../TransformHandler";
import { Layer } from "./Layer";

/**
 * Renders the shift+drag warship selection rectangle in world-space,
 * using the same pixel-dashed style as the warship selection box in UILayer.
 */
export class SelectionBoxLayer implements Layer {
  private active = false;
  private startX = 0;
  private startY = 0;
  private endX = 0;
  private endY = 0;

  // Off-screen canvas for the box pixels (world-space, same size as game)
  private canvas: HTMLCanvasElement = document.createElement("canvas");
  private ctx: CanvasRenderingContext2D | null = null;

  constructor(
    private game: GameView,
    private eventBus: EventBus,
    private transformHandler: TransformHandler,
  ) {}

  shouldTransform(): boolean {
    return true;
  }

  init() {
    this.canvas.width = this.game.width();
    this.canvas.height = this.game.height();
    this.ctx = this.canvas.getContext("2d");

    this.eventBus.on(WarshipSelectionBoxUpdateEvent, (e) => {
      this.active = true;
      this.startX = e.startX;
      this.startY = e.startY;
      this.endX = e.endX;
      this.endY = e.endY;
    });
    this.eventBus.on(WarshipSelectionBoxCompleteEvent, () => {
      this.active = false;
      this.ctx?.clearRect(0, 0, this.canvas.width, this.canvas.height);
    });
    this.eventBus.on(WarshipSelectionBoxCancelEvent, () => {
      this.active = false;
      this.ctx?.clearRect(0, 0, this.canvas.width, this.canvas.height);
    });
    this.eventBus.on(CloseViewEvent, () => {
      this.active = false;
      this.ctx?.clearRect(0, 0, this.canvas.width, this.canvas.height);
    });
  }

  renderLayer(context: CanvasRenderingContext2D) {
    if (!this.active || !this.ctx) return;

    // Convert screen corners to world coordinates
    const topLeft = this.transformHandler.screenToWorldCoordinates(
      Math.min(this.startX, this.endX),
      Math.min(this.startY, this.endY),
    );
    const bottomRight = this.transformHandler.screenToWorldCoordinates(
      Math.max(this.startX, this.endX),
      Math.max(this.startY, this.endY),
    );

    const wx1 = Math.floor(topLeft.x);
    const wy1 = Math.floor(topLeft.y);
    const wx2 = Math.floor(bottomRight.x);
    const wy2 = Math.floor(bottomRight.y);

    // Clamp to canvas bounds to avoid out-of-bounds fillRect
    const cx1 = Math.max(0, wx1);
    const cy1 = Math.max(0, wy1);
    const cx2 = Math.min(this.canvas.width - 1, wx2);
    const cy2 = Math.min(this.canvas.height - 1, wy2);

    if (cx2 <= cx1 || cy2 <= cy1) return;

    // Player color — fall back to a neutral cyan if no player yet
    const myPlayer = this.game.myPlayer();
    const baseColor = myPlayer ? myPlayer.territoryColor().lighten(0.2) : null;
    const colorStr = baseColor
      ? baseColor.alpha(0.85).toRgbString()
      : "rgba(100,200,255,0.85)";

    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // Draw dashed border using 4 line passes (O(n) not O(n²))
    this.ctx.fillStyle = colorStr;
    this.drawDashedLine(this.ctx, cx1, cy1, cx2, cy1); // top
    this.drawDashedLine(this.ctx, cx1, cy2, cx2, cy2); // bottom
    this.drawDashedLine(this.ctx, cx1, cy1, cx1, cy2); // left
    this.drawDashedLine(this.ctx, cx2, cy1, cx2, cy2); // right

    // Subtle fill
    this.ctx.fillStyle = baseColor
      ? baseColor.alpha(0.06).toRgbString()
      : "rgba(100,200,255,0.06)";
    this.ctx.fillRect(cx1 + 1, cy1 + 1, cx2 - cx1 - 1, cy2 - cy1 - 1);

    context.drawImage(
      this.canvas,
      -this.game.width() / 2,
      -this.game.height() / 2,
      this.game.width(),
      this.game.height(),
    );
  }

  /** Draw a dashed 1px line using the (x+y) % 2 pattern to match UILayer style */
  private drawDashedLine(
    ctx: CanvasRenderingContext2D,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
  ) {
    if (x1 === x2) {
      for (let y = y1; y <= y2; y++) {
        if ((x1 + y) % 2 === 0) ctx.fillRect(x1, y, 1, 1);
      }
    } else {
      for (let x = x1; x <= x2; x++) {
        if ((x + y1) % 2 === 0) ctx.fillRect(x, y1, 1, 1);
      }
    }
  }
}
