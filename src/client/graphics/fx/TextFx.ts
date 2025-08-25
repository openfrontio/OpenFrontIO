import { Fx } from "./Fx";

export class TextFx implements Fx {
  private lifeTime = 0;

  constructor(
    private readonly text: string,
    private readonly x: number,
    private readonly y: number,
    private readonly duration: number,
    private readonly riseDistance = 30,
    private readonly font = "11px sans-serif",
    private readonly color: { r: number; g: number; b: number } = {
      b: 255,
      g: 255,
      r: 255,
    },
  ) {}

  renderTick(frameTime: number, ctx: CanvasRenderingContext2D): boolean {
    this.lifeTime += frameTime;
    if (this.lifeTime >= this.duration) {
      return false;
    }

    const t = this.lifeTime / this.duration;
    const currentY = this.y - t * this.riseDistance;
    const alpha = 1 - t;

    ctx.save();
    ctx.font = this.font;
    ctx.fillStyle = `rgba(${this.color.r}, ${this.color.g}, ${this.color.b}, ${alpha})`;
    ctx.textAlign = "center";
    ctx.fillText(this.text, this.x, currentY);
    ctx.restore();

    return true;
  }
}
