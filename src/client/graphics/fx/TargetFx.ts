import { Fx } from "./Fx";

export class TargetFx implements Fx {
  private lifeTime = 0;
  private ended = false;
  private endFade = 300;
  private offset = 0;
  private rotationSpeed = 14; // px per seconds
  private radius = 4;

  constructor(
    private x: number,
    private y: number,
    private duration = 0,
    private persistent = false,
  ) {}

  end() {
    if (this.persistent) {
      this.ended = true;
      this.lifeTime = 0; // reuse for fade-out timing
    }
  }

  renderTick(frameTime: number, ctx: CanvasRenderingContext2D): boolean {
    this.lifeTime += frameTime;

    if (!this.persistent) {
      if (this.lifeTime >= this.duration) return false;
    } else if (this.ended) {
      if (this.lifeTime >= this.endFade) return false;
    }

    const t = this.persistent
      ? (this.lifeTime % 1000) / 1000 // looping for pulse
      : this.lifeTime / this.duration;
    const baseAlpha = this.persistent ? 0.9 : 1 - t;
    const fadeAlpha =
      this.persistent && this.ended ? 1 - this.lifeTime / this.endFade : 1;
    const alpha = Math.max(0, Math.min(1, baseAlpha * fadeAlpha));

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.lineWidth = 1;
    ctx.strokeStyle = `rgba(255,0,0,${alpha})`;
    this.offset += this.rotationSpeed * (frameTime / 1000);

    ctx.beginPath();
    ctx.lineWidth = 1;
    ctx.lineDashOffset = this.offset;
    ctx.setLineDash([3, 3]);
    ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.strokeStyle = `rgba(255,0,0,${alpha})`;
    ctx.lineWidth = 2;
    ctx.lineDashOffset = -this.offset / 2;
    ctx.setLineDash([19, 3]);
    ctx.arc(this.x, this.y, 7, 0, Math.PI * 2);
    ctx.stroke();

    ctx.restore();
    return true;
  }
}
