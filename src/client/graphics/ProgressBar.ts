export class ProgressBar {
  constructor(
    private colors: string[] = [],
    private ctx: CanvasRenderingContext2D,
    private x: number,
    private y: number,
    private w: number,
    private h: number,
    private progress: number = 0, // Progress from 0 to 1
  ) {
    this.setProgress(Math.max(0.2, Math.min(1, progress)));
  }

  setProgress(progress: number): void {
    this.clear();
    // Draw the loading bar background
    this.ctx.fillStyle = "rgba(0, 0, 0, 1)";
    this.ctx.fillRect(this.x - 1, this.y - 1, this.w, this.h);

    // Draw the loading progress
    const idx = Math.min(
      this.colors.length - 1,
      Math.floor(progress * this.colors.length),
    );
    const fillColor = this.colors[idx];
    this.ctx.fillStyle = fillColor;
    this.ctx.fillRect(
      this.x,
      this.y,
      Math.floor(progress * (this.w - 2)),
      this.h - 2,
    );
    this.progress = progress;
  }

  clear() {
    this.ctx.clearRect(this.x - 2, this.y - 2, this.w + 2, this.h + 2);
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
