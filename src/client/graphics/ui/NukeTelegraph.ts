import { Cell } from "src/core/game/Game";
import { GameView, UnitView } from "src/core/game/GameView";
import { TransformHandler } from "../TransformHandler";
import { UIElement } from "./UIElement";

const OUTER_EXPAND = 20;
const FILL_ALPHA_OFFSET = 0.6;

/**
 * Draw an area with two disks
 */
export class CircleArea implements UIElement {
  private offset = 0;
  private readonly dashSize: number;
  private readonly rotationSpeed = 20;
  private readonly baseAlpha = 0.9;
  private readonly cell: Cell;
  private readonly animationDuration = 150;
  protected ended: boolean = false;
  protected lifeTime: number = 0;

  constructor(
    private transformHandler: TransformHandler,
    public x: number,
    public y: number,
    private innerDiameter: number,
    private outerDiameter: number,
  ) {
    this.cell = new Cell(this.x + 0.5, this.y + 0.5);
    // Compute a dash length that produces N dashes around the circle
    const numDash = Math.max(1, Math.floor(this.outerDiameter / 3));
    this.dashSize = (Math.PI / numDash) * this.outerDiameter;
  }
  render(ctx: CanvasRenderingContext2D, delta: number): boolean {
    this.lifeTime += delta;

    if (this.ended && this.lifeTime >= this.animationDuration) return false;
    let t: number;
    if (this.ended) {
      t = Math.max(0, 1 - this.lifeTime / this.animationDuration);
    } else {
      t = Math.min(1, this.lifeTime / this.animationDuration);
    }
    const alpha = Math.max(0, Math.min(1, this.baseAlpha * t));
    const scale = this.transformHandler.scale;

    const innerDiameter =
      (this.innerDiameter / 2) * (1 - t) + this.innerDiameter * t;
    const screenPos = this.transformHandler.worldToScreenCoordinates(this.cell);
    screenPos.x = Math.round(screenPos.x);
    screenPos.y = Math.round(screenPos.y);

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.lineWidth = 2;
    ctx.strokeStyle = `rgba(255,0,0,${alpha})`;
    ctx.fillStyle = `rgba(255,0,0,${Math.max(0, alpha - FILL_ALPHA_OFFSET)})`;

    // Inner circle
    ctx.beginPath();
    ctx.lineWidth = 1;
    ctx.arc(screenPos.x, screenPos.y, innerDiameter * scale, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fill();

    // Outer circle
    this.offset += this.rotationSpeed * (delta / 1000);
    ctx.beginPath();
    ctx.strokeStyle = `rgba(255,0,0,${alpha})`;
    ctx.lineWidth = Math.max(2, 1 * scale);
    ctx.lineDashOffset = this.offset * scale;
    ctx.setLineDash([this.dashSize * scale]);
    const outerDiameter =
      (this.outerDiameter + OUTER_EXPAND) * (1 - t) + this.outerDiameter * t;
    ctx.arc(screenPos.x, screenPos.y, outerDiameter * scale, 0, Math.PI * 2);
    ctx.stroke();

    ctx.restore();
    return true;
  }
}

/**
 * Bind a nuke destination to an area
 */
export class NukeTelegraph extends CircleArea {
  constructor(
    transformHandler: TransformHandler,
    private readonly game: GameView,
    private nuke: UnitView,
  ) {
    const tile = nuke.targetTile();
    if (tile === undefined) {
      throw new Error("NukeArea requires a target tile");
    }
    const magnitude = game.config().nukeMagnitudes(nuke.type());
    super(
      transformHandler,
      game.x(tile),
      game.y(tile),
      magnitude.inner,
      magnitude.outer,
    );
  }

  render(ctx: CanvasRenderingContext2D, delta: number): boolean {
    if (!this.ended && !this.nuke.isActive()) {
      this.ended = true;
      this.lifeTime = 0; // reset lifetime to reuse animation logic
    }
    return super.render(ctx, delta);
  }
}
