import { Cell } from "src/core/game/Game";
import { TransformHandler } from "../TransformHandler";
import { UIElement } from "./UIElement";

const MIN_TEXT_ZOOM = 1.1;

export class TextIndicator implements UIElement {
  private fontSize: number = 8;
  private font: string = "Overpass, sans-serif";
  private cell: Cell;
  private lifeTime: number = 0;

  constructor(
    private transformHandler: TransformHandler,
    private text: string,
    public x: number,
    public y: number,
    private duration: number,
    private riseDistance: number = 15,
    private color: { r: number; g: number; b: number } = {
      r: 255,
      g: 255,
      b: 255,
    },
    private icon?: CanvasImageSource,
  ) {
    this.cell = new Cell(this.x + 0.5, this.y + 0.5);
  }
  render(ctx: CanvasRenderingContext2D, delta: number): boolean {
    this.lifeTime += delta;
    if (this.lifeTime >= this.duration) {
      return false;
    }

    const transformScale = this.transformHandler.scale;
    if (transformScale < MIN_TEXT_ZOOM) {
      // Reduce visual noise when dezoomed enough
      return true;
    }

    const screenPos = this.transformHandler.worldToCanvasCoordinates(this.cell);
    screenPos.x = Math.round(screenPos.x);
    screenPos.y = Math.round(screenPos.y);

    const size = Math.round(this.fontSize * transformScale);
    const t = this.lifeTime / this.duration;
    const currentY = screenPos.y - t * this.riseDistance * transformScale;
    const alpha = Math.max(0, 1 - t);

    ctx.save();
    ctx.font = `${size}px ${this.font}`;
    ctx.fillStyle = `rgba(${this.color.r}, ${this.color.g}, ${this.color.b}, ${alpha})`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";

    const textWidth = ctx.measureText(this.text).width;
    const iconSize = this.icon ? Math.round(size * 1.1) : 0;
    const iconGap = this.icon ? Math.max(2, Math.round(size * 0.2)) : 0;
    const totalWidth = iconSize + iconGap + textWidth;
    let drawX = screenPos.x - totalWidth / 2;

    if (this.icon) {
      ctx.globalAlpha = alpha;
      ctx.drawImage(
        this.icon,
        drawX,
        currentY - iconSize / 2,
        iconSize,
        iconSize,
      );
      ctx.globalAlpha = 1;
      drawX += iconSize + iconGap;
    }

    ctx.fillText(this.text, drawX, currentY);
    ctx.restore();

    return true;
  }
}
