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

    // Scale with zoom level (same pattern as NavalTarget)
    const transformScale = this.transformHandler.scale;
    const scale = transformScale > 10 ? 1 + (transformScale - 10) / 10 : 1;

    const radius = this.startRadius * scale * (1 - t * 0.7); // converge inward
    const chevronSize = this.chevronSize * scale;

    // Get screen coordinates
    const screenPos = this.transformHandler.worldToScreenCoordinates(this.cell);
    const centerX = screenPos.x;
    const centerY = screenPos.y;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = "#ff0000";
    ctx.lineWidth = 2 * scale;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    // pre calculation of offsets
    const tipOffset = chevronSize * 0.4;
    const wingOffset = chevronSize * 0.6;
    const width = chevronSize;

    ctx.beginPath();

    // Top (pointing down)
    ctx.moveTo(centerX - width, centerY - radius - wingOffset);
    ctx.lineTo(centerX, centerY - radius + tipOffset);
    ctx.lineTo(centerX + width, centerY - radius - wingOffset);

    // Bottom (pointing up)
    ctx.moveTo(centerX - width, centerY + radius + wingOffset);
    ctx.lineTo(centerX, centerY + radius - tipOffset);
    ctx.lineTo(centerX + width, centerY + radius + wingOffset);

    // Left (pointing right)
    ctx.moveTo(centerX - radius - wingOffset, centerY - width);
    ctx.lineTo(centerX - radius + tipOffset, centerY);
    ctx.lineTo(centerX - radius - wingOffset, centerY + width);

    // Right (pointing left)
    ctx.moveTo(centerX + radius + wingOffset, centerY - width);
    ctx.lineTo(centerX + radius - tipOffset, centerY);
    ctx.lineTo(centerX + radius + wingOffset, centerY + width);

    ctx.stroke();

    ctx.restore();
    return true;
  }
}
