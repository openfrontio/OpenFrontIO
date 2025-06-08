export class ProgressBar {
  constructor(
    private color: string[] = [],
    private ctx: CanvasRenderingContext2D,
    private x: number,
    private y: number,
    private w: number,
    private h: number,
    private progress: number = 0, // Progress from 0 to 1
  ) {
    ctx.clearRect(x - 2, y - 2, w + 2, h + 2);
    // Draw the loading bar background
    ctx.fillStyle = "rgba(0, 0, 0, 1)";
    ctx.fillRect(x - 1, y - 1, w, h);
    this.setProgress(Math.max(0.2, Math.min(1, progress)));
  }

  setProgress(progress: number): void {
    // Draw the loading progress
    const idx = Math.min(
      this.color.length - 1,
      Math.floor(progress * this.color.length),
    );
    const fillColor = this.color[idx];
    this.ctx.fillStyle = fillColor;
    this.ctx.fillRect(
      this.x,
      this.y,
      Math.floor(progress * (this.w - 2)),
      this.h - 2,
    );
    this.progress = progress;
  }

  getX(): number {
    return this.x;
  }

  getY(): number {
    return this.y;
  }

  getProgress(): number {
    return this.progress;
  }
}
