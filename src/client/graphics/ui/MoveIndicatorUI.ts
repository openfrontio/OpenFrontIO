import { Cell } from "src/core/game/Game";
import { TransformHandler } from "../TransformHandler";
import { UIElement } from "./UIElement";

/**
 * move indicator fx for warship, similar to moba games.
 */
export class MoveIndicatorUI implements UIElement {
  private lifeTime = 0;
  private readonly duration = 800; // ms
  private readonly startRadius = 13; // starting distance from center (screen pixels)
  private readonly chevronSize = 5; // size in screen pixels
  private readonly cell: Cell;

  constructor(
    private transformHandler: TransformHandler,
    public x: number,
    public y: number,
  ) {
    this.cell = new Cell(this.x + 0.5, this.y + 0.5);
  }

  render(ctx: CanvasRenderingContext2D, delta: number): boolean {
    this.lifeTime += delta;
    if (this.lifeTime >= this.duration) return false;

    const t = this.lifeTime / this.duration;
    const alpha = 1 - t; // fade out
    const radius = this.startRadius * (1 - t * 0.7); // converge inward

    // Get screen coordinates
    const screenPos = this.transformHandler.worldToScreenCoordinates(this.cell);
    const centerX = screenPos.x;
    const centerY = screenPos.y;

    ctx.save();
    ctx.strokeStyle = `rgba(255, 0, 0, ${alpha})`;
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    // draw 4 chevrons pointing inward
    this.drawChevron(ctx, centerX, centerY - radius, 0); // top
    this.drawChevron(ctx, centerX, centerY + radius, Math.PI); // bottom
    this.drawChevron(ctx, centerX - radius, centerY, -Math.PI / 2); // left
    this.drawChevron(ctx, centerX + radius, centerY, Math.PI / 2); // right

    ctx.restore();
    return true;
  }

  private drawChevron(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    rotation: number,
  ) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rotation);
    ctx.beginPath();
    ctx.moveTo(-this.chevronSize, -this.chevronSize * 0.6);
    ctx.lineTo(0, this.chevronSize * 0.4);
    ctx.lineTo(this.chevronSize, -this.chevronSize * 0.6);
    ctx.stroke();
    ctx.restore();
  }
}
