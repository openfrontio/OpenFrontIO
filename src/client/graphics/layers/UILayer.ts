import { Colord } from "colord";
import { EventBus } from "../../../core/EventBus";
import { Theme } from "../../../core/configuration/Config";
import { UnitType } from "../../../core/game/Game";
import { GameView, UnitView } from "../../../core/game/GameView";
import { UnitSelectionEvent } from "../../InputHandler";
import { TransformHandler } from "../TransformHandler";
import { Layer } from "./Layer";

/**
 * Layer responsible for drawing UI elements that overlay the game
 * such as selection boxes, health bars, etc.
 */
export class UILayer implements Layer {
  private canvas: HTMLCanvasElement;
  private context: CanvasRenderingContext2D | null;

  private theme: Theme | null = null;
  private selectionAnimTime = 0;

  // Keep track of currently selected unit
  private selectedUnit: UnitView | null = null;

  // Keep track of previous selection box position for cleanup
  private lastSelectionBoxCenter: {
    x: number;
    y: number;
    size: number;
  } | null = null;

  // Visual settings for selection
  private readonly SELECTION_BOX_SIZE = 6; // Size of the selection box (should be larger than the warship)

  constructor(
    private game: GameView,
    private eventBus: EventBus,
    private transformHandler: TransformHandler,
  ) {
    this.theme = game.config().theme();
  }

  shouldTransform(): boolean {
    return true;
  }

  tick() {
    // Update the selection animation time
    this.selectionAnimTime = (this.selectionAnimTime + 1) % 60;

    // If there's a selected warship, redraw to update the selection box animation
    if (this.selectedUnit && this.selectedUnit.type() === UnitType.Warship) {
      this.drawSelectionBox(this.selectedUnit);
    }
  }

  init() {
    this.eventBus.on(UnitSelectionEvent, (e) => this.onUnitSelection(e));
    this.redraw();
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

  redraw() {
    this.canvas = document.createElement("canvas");
    this.context = this.canvas.getContext("2d");

    this.canvas.width = this.game.width();
    this.canvas.height = this.game.height();
  }

  /**
   * Handle the unit selection event
   */
  private onUnitSelection(event: UnitSelectionEvent) {
    if (event.isSelected) {
      this.selectedUnit = event.unit;
      if (event.unit && event.unit.type() === UnitType.Warship) {
        this.drawSelectionBox(event.unit);
      }
    } else {
      if (this.selectedUnit === event.unit) {
        // Clear the selection box
        if (this.lastSelectionBoxCenter) {
          const { x, y, size } = this.lastSelectionBoxCenter;
          this.clearSelectionBox(x, y, size);
          this.lastSelectionBoxCenter = null;
        }
        this.selectedUnit = null;
      }
    }
  }

  /**
   * Clear the selection box at a specific position
   */
  private clearSelectionBox(x: number, y: number, size: number) {
    for (let px = x - size; px <= x + size; px++) {
      for (let py = y - size; py <= y + size; py++) {
        if (
          px === x - size ||
          px === x + size ||
          py === y - size ||
          py === y + size
        ) {
          this.clearCell(px, py);
        }
      }
    }
  }

  /**
   * Draw a selection box around the given unit
   */
  public drawSelectionBox(unit: UnitView) {
    if (!unit || !unit.isActive()) {
      return;
    }

    // Use the configured selection box size
    const selectionSize = this.SELECTION_BOX_SIZE;

    // Calculate pulsating effect based on animation time (25% variation in opacity)
    const baseOpacity = 200;
    const pulseAmount = 55;
    const opacity =
      baseOpacity + Math.sin(this.selectionAnimTime * 0.1) * pulseAmount;

    // Get the unit's owner color for the box
    if (this.theme === null) throw new Error("missing theme");
    const ownerColor = this.theme.territoryColor(unit.owner());

    // Create a brighter version of the owner color for the selection
    const selectionColor = ownerColor.lighten(0.2);

    // Get current center position
    const center = unit.tile();
    const centerX = this.game.x(center);
    const centerY = this.game.y(center);

    // Clear previous selection box if it exists and is different from current position
    if (
      this.lastSelectionBoxCenter &&
      (this.lastSelectionBoxCenter.x !== centerX ||
        this.lastSelectionBoxCenter.y !== centerY)
    ) {
      const lastSize = this.lastSelectionBoxCenter.size;
      const lastX = this.lastSelectionBoxCenter.x;
      const lastY = this.lastSelectionBoxCenter.y;

      // Clear the previous selection box
      this.clearSelectionBox(lastX, lastY, lastSize);
    }

    // Draw the selection box
    for (let x = centerX - selectionSize; x <= centerX + selectionSize; x++) {
      for (let y = centerY - selectionSize; y <= centerY + selectionSize; y++) {
        // Only draw if it's on the border (not inside or outside the box)
        if (
          x === centerX - selectionSize ||
          x === centerX + selectionSize ||
          y === centerY - selectionSize ||
          y === centerY + selectionSize
        ) {
          // Create a dashed effect by only drawing some pixels
          const dashPattern = (x + y) % 2 === 0;
          if (dashPattern) {
            this.paintCell(x, y, selectionColor, opacity);
          }
        }
      }
    }

    // Store current selection box position for next cleanup
    this.lastSelectionBoxCenter = {
      x: centerX,
      y: centerY,
      size: selectionSize,
    };
  }

  /**
   * Draw health bar for a unit (placeholder for future implementation)
   */
  public drawHealthBar(unit: UnitView) {
    // This is a placeholder for future health bar implementation
    // It would draw a health bar above units that have health
  }

  paintCell(x: number, y: number, color: Colord, alpha: number) {
    if (this.context === null) throw new Error("null context");
    this.clearCell(x, y);
    this.context.fillStyle = color.alpha(alpha / 255).toRgbString();
    this.context.fillRect(x, y, 1, 1);
  }

  clearCell(x: number, y: number) {
    if (this.context === null) throw new Error("null context");
    this.context.clearRect(x, y, 1, 1);
  }
}
