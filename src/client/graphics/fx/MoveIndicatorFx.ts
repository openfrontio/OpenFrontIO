import { Fx } from "./Fx";

/**
 * move indicator fx for warship, similar to moba games.
 */

export class MoveIndicatorFx implements Fx {
  private lifeTime = 0;
  private readonly duration = 600; // ms
  private readonly startRadius = 5; // starting distance from center
  private readonly chevronSize = 2; // size

  constructor(
    private x: number,
    private y: number,
  ) {}

  renderTick(frameTime: number, ctx: CanvasRenderingContext2D): boolean {
    this.lifeTime += frameTime;
    if (this.lifeTime >= this.duration) return false;

    const t = this.lifeTime / this.duration;
    const alpha = 1 - t; // fade out
    const radius = this.startRadius * (1 - t * 0.7); // converge inward

    ctx.save();
    ctx.strokeStyle = `rgba(255, 0, 0, ${alpha})`;
    ctx.fillStyle = `rgba(255, 0, 0, ${alpha})`;
    ctx.lineWidth = 0.7;

    // draw 4 chevrons pointing inward
    this.drawChevron(ctx, this.x, this.y - radius, 0); // top
    this.drawChevron(ctx, this.x, this.y + radius, Math.PI); // bottom
    this.drawChevron(ctx, this.x - radius, this.y, -Math.PI / 2); // left
    this.drawChevron(ctx, this.x + radius, this.y, Math.PI / 2); // right

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
