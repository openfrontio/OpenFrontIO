import { NukeMagnitude } from "../../../core/configuration/Config";
import { Fx } from "./Fx";

export class NukeAreaFx implements Fx {
  private lifeTime = 0;
  private ended = false;
  private endAnimationDuration = 300; // in ms
  private startAnimationDuration = 200; // in ms

  private dashSize: number;
  private offset = 0;
  private numDash = 12;
  private rotationSpeed = 15; // px per seconds
  private innerDiameter: number;
  private outerDiameter: number;
  private baseAlpha = 0.9;

  constructor(
    private x: number,
    private y: number,
    magnitude: NukeMagnitude,
  ) {
    this.innerDiameter = magnitude.inner;
    this.outerDiameter = magnitude.outer;
    this.numDash = Math.max(1, Math.floor(this.outerDiameter / 3));
    this.dashSize = (Math.PI / this.numDash) * this.outerDiameter;
  }

  end() {
    this.ended = true;
    this.lifeTime = 0; // reset for fade-out timing
  }

  renderTick(frameTime: number, ctx: CanvasRenderingContext2D): boolean {
    this.lifeTime += frameTime;

    if (this.ended && this.lifeTime >= this.endAnimationDuration) return false;
    let t: number;
    if (this.ended) {
      t = 1 - this.lifeTime / this.endAnimationDuration;
      t = Math.max(t, 0);
    } else {
      t = this.lifeTime / this.startAnimationDuration;
      t = Math.min(t, 1);
    }
    const alpha = Math.max(0, Math.min(1, this.baseAlpha * t));

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.lineWidth = 1;
    ctx.strokeStyle = `rgba(255,0,0,${alpha})`;
    ctx.fillStyle = `rgba(255,0,0,${alpha - 0.6})`;

    // Inner circle
    ctx.beginPath();
    ctx.lineWidth = 1;
    const innerDiameter =
      (this.innerDiameter / 2) * (1 - t) + this.innerDiameter * t;
    ctx.arc(this.x, this.y, innerDiameter, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fill();

    // Outer circle
    this.offset += this.rotationSpeed * (frameTime / 1000);
    ctx.beginPath();
    ctx.strokeStyle = `rgba(255,0,0,${alpha})`;
    ctx.lineWidth = 1;
    ctx.lineDashOffset = this.offset;
    ctx.setLineDash([this.dashSize]);
    const outerDiameter =
      (this.outerDiameter + 20) * (1 - t) + this.outerDiameter * t;
    ctx.arc(this.x, this.y, outerDiameter, 0, Math.PI * 2);
    ctx.stroke();

    ctx.restore();
    return true;
  }
}
