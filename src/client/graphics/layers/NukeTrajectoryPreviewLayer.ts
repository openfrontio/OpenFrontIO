import { GameView } from "../../../core/game/GameView";
import { Layer } from "./Layer";
import { NukeRenderUtilLayer } from "./NukeRenderUtilLayer";

/**
 * Layer responsible for rendering the nuke trajectory preview line
 * when a nuke type (AtomBomb or HydrogenBomb) is selected and the user hovers over potential targets.
 */
export class NukeTrajectoryPreviewLayer implements Layer {
  constructor(
    private readonly game: GameView,
    private readonly nukeRenderUtilLayer: NukeRenderUtilLayer,
  ) {}

  shouldTransform(): boolean {
    return true;
  }

  init() {}

  tick() {}

  renderLayer(context: CanvasRenderingContext2D) {
    this.drawTrajectoryPreview(context);
  }

  /**
   * Draw trajectory preview line on the canvas
   */
  private drawTrajectoryPreview(context: CanvasRenderingContext2D) {
    if (!this.nukeRenderUtilLayer.isNukeGhostActive()) {
      return;
    }

    const { trajectoryPoints, untargetableSegmentBounds, targetedIndex } =
      this.nukeRenderUtilLayer.getTrajectoryInfo();
    if (trajectoryPoints.length === 0) {
      return;
    }

    const player = this.game.myPlayer();
    if (!player) {
      return;
    }

    // Set of line colors, targeted is after SAM intercept is detected.
    const untargetedOutlineColor = "rgba(140, 140, 140, 1)";
    const targetedOutlineColor = "rgba(150, 90, 90, 1)";
    const symbolOutlineColor = "rgba(0, 0, 0, 1)";
    const targetedLocationColor = "rgba(255, 0, 0, 1)";
    const untargetableAndUntargetedLineColor = "rgba(255, 255, 255, 1)";
    const targetableAndUntargetedLineColor = "rgba(255, 255, 255, 1)";
    const untargetableAndTargetedLineColor = "rgba(255, 80, 80, 1)";
    const targetableAndTargetedLineColor = "rgba(255, 80, 80, 1)";

    // Set of line widths
    const outlineExtraWidth = 1.5; // adds onto below
    const lineWidth = 1.25;
    const XLineWidth = 2;
    const XSize = 6;

    // Set of line dashes
    // Outline dashes calculated automatically
    const untargetableAndUntargetedLineDash = [2, 6];
    const targetableAndUntargetedLineDash = [8, 4];
    const untargetableAndTargetedLineDash = [2, 6];
    const targetableAndTargetedLineDash = [8, 4];

    const outlineDash = (dash: number[], extra: number) => {
      return [dash[0] + extra, Math.max(dash[1] - extra, 0)];
    };

    // Tracks the change of color and dash length throughout
    let currentOutlineColor = untargetedOutlineColor;
    let currentLineColor = targetableAndUntargetedLineColor;
    let currentLineDash = targetableAndUntargetedLineDash;
    let currentLineWidth = lineWidth;

    // Take in set of "current" parameters and draw both outline and line.
    const outlineAndStroke = () => {
      context.lineWidth = currentLineWidth + outlineExtraWidth;
      context.setLineDash(outlineDash(currentLineDash, outlineExtraWidth));
      context.lineDashOffset = outlineExtraWidth / 2;
      context.strokeStyle = currentOutlineColor;
      context.stroke();
      context.lineWidth = currentLineWidth;
      context.setLineDash(currentLineDash);
      context.lineDashOffset = 0;
      context.strokeStyle = currentLineColor;
      context.stroke();
    };
    const drawUntargetableCircle = (x: number, y: number) => {
      context.beginPath();
      context.arc(x, y, 4, 0, 2 * Math.PI, false);
      currentOutlineColor = untargetedOutlineColor;
      currentLineColor = targetableAndUntargetedLineColor;
      currentLineDash = [1, 0];
      outlineAndStroke();
    };
    const drawTargetedX = (x: number, y: number) => {
      context.beginPath();
      context.moveTo(x - XSize, y - XSize);
      context.lineTo(x + XSize, y + XSize);
      context.moveTo(x - XSize, y + XSize);
      context.lineTo(x + XSize, y - XSize);
      currentOutlineColor = symbolOutlineColor;
      currentLineColor = targetedLocationColor;
      currentLineDash = [1, 0];
      currentLineWidth = XLineWidth;
      outlineAndStroke();
    };

    // Calculate offset to center coordinates (same as canvas drawing)
    const offsetX = -this.game.width() / 2;
    const offsetY = -this.game.height() / 2;

    context.save();
    context.beginPath();

    // Draw line connecting trajectory points
    for (let i = 0; i < trajectoryPoints.length; i++) {
      const tile = trajectoryPoints[i];
      const x = this.game.x(tile) + offsetX;
      const y = this.game.y(tile) + offsetY;

      if (i === 0) {
        context.moveTo(x, y);
      } else {
        context.lineTo(x, y);
      }
      if (i === untargetableSegmentBounds[0]) {
        outlineAndStroke();
        drawUntargetableCircle(x, y);
        context.beginPath();
        if (i >= targetedIndex) {
          currentOutlineColor = targetedOutlineColor;
          currentLineColor = untargetableAndTargetedLineColor;
          currentLineDash = untargetableAndTargetedLineDash;
        } else {
          currentOutlineColor = untargetedOutlineColor;
          currentLineColor = untargetableAndUntargetedLineColor;
          currentLineDash = untargetableAndUntargetedLineDash;
        }
      } else if (i === untargetableSegmentBounds[1]) {
        outlineAndStroke();
        drawUntargetableCircle(x, y);
        context.beginPath();
        if (i >= targetedIndex) {
          currentOutlineColor = targetedOutlineColor;
          currentLineColor = targetableAndTargetedLineColor;
          currentLineDash = targetableAndTargetedLineDash;
        } else {
          currentOutlineColor = untargetedOutlineColor;
          currentLineColor = targetableAndUntargetedLineColor;
          currentLineDash = targetableAndUntargetedLineDash;
        }
      }
      if (i === targetedIndex) {
        outlineAndStroke();
        drawTargetedX(x, y);
        context.beginPath();
        // Always in the targetable zone by definition.
        currentOutlineColor = targetedOutlineColor;
        currentLineColor = targetableAndTargetedLineColor;
        currentLineDash = targetableAndTargetedLineDash;
        currentLineWidth = lineWidth;
      }
    }

    outlineAndStroke();
    context.restore();
  }
}
