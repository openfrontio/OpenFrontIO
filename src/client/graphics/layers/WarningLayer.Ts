import { Warning, WarningManager } from "../../../core/WarningManager";
import { Layer } from "./Layer";

export class WarningLayer implements Layer {
  private warningManager: WarningManager;
  private needsRedraw: boolean = true;

  private readonly PADDING = 15;
  private readonly WARNING_HEIGHT = 50;
  private readonly WARNING_GAP = 10;
  private readonly MAX_WIDTH = 400;
  private readonly FONT = "16px Arial";
  private readonly BACKGROUND_COLOR = "rgba(220, 53, 69, 0.9)"; // Bootstrap-like red
  private readonly TEXT_COLOR = "#ffffff";
  private readonly BORDER_RADIUS = 5;

  constructor() {
    this.warningManager = WarningManager.getInstance();
  }

  init() {}

  tick() {
    if (this.warningManager.getWarnings().length > 0) {
      this.needsRedraw = true;
    }
  }

  renderLayer(context: CanvasRenderingContext2D) {
    const warnings = this.warningManager.getWarnings();
    if (warnings.length === 0) {
      return;
    }

    context.save();

    const canvasWidth = context.canvas.width;
    const warningWidth = Math.min(
      this.MAX_WIDTH,
      canvasWidth - this.PADDING * 2,
    );

    context.font = this.FONT;
    context.textBaseline = "middle";

    warnings.forEach((warning, index) => {
      this.renderWarningBox(context, warning, index, canvasWidth, warningWidth);
    });

    context.restore();
    this.needsRedraw = false;
  }

  private renderWarningBox(
    context: CanvasRenderingContext2D,
    warning: Warning,
    index: number,
    canvasWidth: number,
    warningWidth: number,
  ) {
    const now = Date.now();
    const elapsed = now - warning.createdAt;

    let opacity = 1.0;

    // Fade in
    if (elapsed < 300) {
      opacity = elapsed / 300;
    }

    if (elapsed > warning.duration - 1000) {
      opacity = (warning.duration - elapsed) / 1000;
    }

    if (opacity <= 0) {
      return;
    }

    const y =
      context.canvas.height -
      this.PADDING -
      (index + 1) * (this.WARNING_HEIGHT + this.WARNING_GAP);
    const x = (canvasWidth - warningWidth) / 2;

    context.fillStyle = this.BACKGROUND_COLOR.replace(
      "0.9",
      `${0.9 * opacity}`,
    );
    this.roundRect(
      context,
      x,
      y,
      warningWidth,
      this.WARNING_HEIGHT,
      this.BORDER_RADIUS,
    );

    context.fillStyle = `rgba(255, 255, 255, ${opacity})`;
    context.textAlign = "center";
    context.fillText(
      warning.message,
      x + warningWidth / 2,
      y + this.WARNING_HEIGHT / 2,
      warningWidth - this.PADDING * 2,
    );
  }

  private roundRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
  ) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
    ctx.fill();
  }

  shouldTransform(): boolean {
    return false;
  }

  redraw(): void {
    this.needsRedraw = true;
  }
}
