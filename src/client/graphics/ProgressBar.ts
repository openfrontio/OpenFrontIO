export class ProgressBar {
  private static readonly CLEAR_PADDING = 2;
  constructor(
    private colors: string[] = [],
    private ctx: CanvasRenderingContext2D,
    private x: number,
    private y: number,
    private w: number,
    private h: number,
    private progress = 0, // Progress from 0 to 1
  ) {
    this.setProgress(progress);
  }

  setProgress(progress: number): void {
    progress = Math.max(0, Math.min(1, progress));
    this.clear();
    // Draw the loading bar background
    this.ctx.fillStyle = "rgba(0, 0, 0, 1)";
    this.ctx.fillRect(this.x - 1, this.y - 1, this.w, this.h);

    // Draw the loading progress
    if (this.colors.length === 0) {
      this.ctx.fillStyle = "#808080"; // default gray
    } else {
      const idx = Math.min(
        this.colors.length - 1,
        Math.floor(progress * this.colors.length),
      );
      this.ctx.fillStyle = this.colors[idx];
    }
    this.ctx.fillRect(
      this.x,
      this.y,
      Math.max(1, Math.floor(progress * (this.w - 2))),
      this.h - 2,
    );
    this.progress = progress;
  }

  clear() {
    this.ctx.clearRect(
      this.x - ProgressBar.CLEAR_PADDING,
      this.y - ProgressBar.CLEAR_PADDING,
      this.w + ProgressBar.CLEAR_PADDING,
      this.h + ProgressBar.CLEAR_PADDING,
    );
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
