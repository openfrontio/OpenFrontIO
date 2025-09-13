import { Fx } from "./Fx";

export class TargetFx implements Fx {
  private lifeTime = 0;
  private ended = false;
  private endFade = 300;

  constructor(
    private x: number,
    private y: number,
    private duration = 0,
    private radius = 8,
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
    const pulse = 1 + 0.2 * Math.sin(t * Math.PI * 2);

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.lineWidth = 1;
    ctx.strokeStyle = `rgba(255,0,0,${alpha})`;

    // size follows the pulsing radius so crosshair scales with it
    const size = this.radius * pulse;

    ctx.beginPath();
    ctx.arc(this.x, this.y, size, 0, Math.PI * 2);
    ctx.stroke();

    // crosshair (fixed size, does not scale with pulse)
    ctx.beginPath();
    ctx.moveTo(this.x - this.radius * 1.2, this.y);
    ctx.lineTo(this.x + this.radius * 1.2, this.y);
    ctx.moveTo(this.x, this.y - this.radius * 1.2);
    ctx.lineTo(this.x, this.y + this.radius * 1.2);
    ctx.stroke();

    ctx.restore();
    return true;
  }
}
