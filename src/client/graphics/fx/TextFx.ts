import { Fx } from "./Fx";

// Shorten a number by replacing thousands with "k"
export function shortenNumber(num: number): string {
  if (num >= 1_000) {
    return (num / 1_000).toFixed(1).replace(/\.0$/, "") + "k";
  } else {
    return num.toString();
  }
}

export class TextFx implements Fx {
  private lifeTime: number = 0;

  constructor(
    private text: string,
    private x: number,
    private y: number,
    private duration: number,
    private riseDistance: number = 30,
    private color: { r: number; g: number; b: number } = {
      r: 255,
      g: 255,
      b: 255,
    },
    private font: string = "11px sans-serif",
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
