import type { EventBus } from "../../../core/EventBus";
import { UnitType } from "../../../core/game/Game";
import type { GameView, UnitView } from "../../../core/game/GameView";
import { MouseMoveEvent, UnitSelectionEvent } from "../../InputHandler";
import { TransformHandler } from "../TransformHandler";
import { UIState } from "../UIState";
import { Layer } from "./Layer";

/**
 * Layer responsible for rendering warship patrol area indicators.
 * Shows:
 * - Current patrol area (solid line square) - centered on warship's patrolTile
 * - Preview patrol area (dashed line square) - follows cursor for placement preview
 */
export class WarshipRadiusLayer implements Layer {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;

  // State tracking
  private selectedWarship: UnitView | null = null;
  private needsRedraw = true;
  private selectedShow = false; // Warship is selected
  private ghostShow = false; // In warship spawn mode

  // Animation for dashed preview squares
  private dashOffset = 0;
  private animationSpeed = 14; // px per second (matches SAMRadiusLayer)
  private lastTickTime = Date.now();

  // Cursor tracking for preview squares
  private mouseWorldPos: { x: number; y: number } | null = null;

  constructor(
    private readonly game: GameView,
    private readonly eventBus: EventBus,
    private readonly transformHandler: TransformHandler,
    private readonly uiState: UIState,
  ) {
    this.canvas = document.createElement("canvas");
    const ctx = this.canvas.getContext("2d");
    if (!ctx) {
      throw new Error("2d context not supported");
    }
    this.context = ctx;
    this.canvas.width = this.game.width();
    this.canvas.height = this.game.height();
  }

  shouldTransform(): boolean {
    return true;
  }

  init() {
    this.eventBus.on(UnitSelectionEvent, (e) => this.handleUnitSelection(e));
    this.eventBus.on(MouseMoveEvent, (e) => this.handleMouseMove(e));
    this.redraw();
  }

  tick() {
    // Update ghost mode state
    const wasGhostShow = this.ghostShow;
    this.ghostShow = this.uiState.ghostStructure === UnitType.Warship;

    // Clear mouse position when ghost mode ends (e.g., after placing warship)
    if (wasGhostShow && !this.ghostShow) {
      this.mouseWorldPos = null;
      this.needsRedraw = true;
    }

    // Check if selected warship was destroyed
    if (this.selectedWarship && !this.selectedWarship.isActive()) {
      this.selectedWarship = null;
      this.selectedShow = false;
      this.needsRedraw = true;
    }

    // Animate dash offset only when preview square is visible
    const now = Date.now();
    const dt = now - this.lastTickTime;
    this.lastTickTime = now;

    const previewVisible =
      (this.selectedShow || this.ghostShow) && this.mouseWorldPos;
    if (previewVisible) {
      this.dashOffset += (this.animationSpeed * dt) / 1000;
      if (this.dashOffset > 1e6) this.dashOffset = this.dashOffset % 1000000;
      this.needsRedraw = true;
    }

    if (this.transformHandler.hasChanged() || this.needsRedraw) {
      this.redraw();
      this.needsRedraw = false;
    }
  }

  renderLayer(context: CanvasRenderingContext2D) {
    context.drawImage(
      this.canvas,
      -this.game.width() / 2,
      -this.game.height() / 2,
      this.game.width(),
      this.game.height(),
    );
  }

  private handleUnitSelection(e: UnitSelectionEvent) {
    if (e.unit?.type() === UnitType.Warship && e.isSelected) {
      this.selectedWarship = e.unit;
      this.selectedShow = true;
    } else if (!e.isSelected && this.selectedWarship === e.unit) {
      this.selectedWarship = null;
      this.selectedShow = false;
    }
    this.needsRedraw = true;
  }

  private handleMouseMove(e: MouseMoveEvent) {
    if (!this.selectedShow && !this.ghostShow) return;

    const rect = this.transformHandler.boundingRect();
    if (!rect) return;

    // Convert screen coordinates to world coordinates
    const worldPos = this.transformHandler.screenToWorldCoordinates(
      e.x - rect.left,
      e.y - rect.top,
    );

    this.mouseWorldPos = worldPos;
    this.needsRedraw = true;
  }

  redraw() {
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // Draw current patrol area (solid) when warship selected
    if (this.selectedWarship && this.selectedShow) {
      const patrolTile = this.selectedWarship.patrolTile();
      if (patrolTile) {
        const x = this.game.x(patrolTile);
        const y = this.game.y(patrolTile);
        this.drawCurrentPatrol(x, y);
      }
    }

    // Draw preview at cursor (dashed) when warship selected OR ghost mode
    if ((this.selectedShow || this.ghostShow) && this.mouseWorldPos) {
      this.drawPreviewPatrol(this.mouseWorldPos.x, this.mouseWorldPos.y);
    }
  }

  /**
   * Draw current patrol area with solid line square
   */
  private drawCurrentPatrol(centerX: number, centerY: number) {
    const ctx = this.context;
    const patrolRange = this.game.config().warshipPatrolRange();
    const halfSize = patrolRange / 2;

    ctx.save();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.2)";

    ctx.beginPath();
    ctx.rect(centerX - halfSize, centerY - halfSize, patrolRange, patrolRange);
    ctx.stroke();

    ctx.restore();
  }

  /**
   * Draw preview patrol area with dashed line square (animated)
   */
  private drawPreviewPatrol(centerX: number, centerY: number) {
    const ctx = this.context;
    const patrolRange = this.game.config().warshipPatrolRange();
    const halfSize = patrolRange / 2;

    ctx.save();
    ctx.lineWidth = 2;
    ctx.setLineDash([12, 6]);
    ctx.lineDashOffset = this.dashOffset;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.2)";

    ctx.beginPath();
    ctx.rect(centerX - halfSize, centerY - halfSize, patrolRange, patrolRange);
    ctx.stroke();

    ctx.restore();
  }
}
