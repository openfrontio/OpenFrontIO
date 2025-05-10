import { Colord } from "colord";
import { EventBus } from "../../../core/EventBus";
import { ClientID } from "../../../core/Schemas";
import { Theme } from "../../../core/configuration/Config";
import { showRangeMode, UnitType } from "../../../core/game/Game";
import { TileRef } from "../../../core/game/GameMap";
import { GameView, UnitView } from "../../../core/game/GameView";
import {
  MouseMoveEvent,
  ShowUnitRangeEvent,
  UnitSelectionEvent,
} from "../../InputHandler";
import { TransformHandler } from "../TransformHandler";
import { Layer } from "./Layer";

function euclideanDistWorld(
  coord: { x: number; y: number },
  tileRef: TileRef,
  game: GameView,
): number {
  const x = game.x(tileRef);
  const y = game.y(tileRef);
  const dx = coord.x - x;
  const dy = coord.y - y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Layer responsible for drawing UI elements that overlay the game
 * such as selection boxes, health bars, etc.
 */
export class UILayer implements Layer {
  private canvas: HTMLCanvasElement;
  private context: CanvasRenderingContext2D;

  private theme: Theme = null;
  private selectionAnimTime = 0;
  private warshipRange: number = 0;
  private SAMRange: number = 0;
  private defensePostRange: number = 0;
  private lastMouseUpdate = 0;
  private lastMousePosition: { x: number; y: number } | null = null;
  private rangeMode: showRangeMode = showRangeMode.None;

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
    private clientID: ClientID,
    private transformHandler: TransformHandler,
  ) {
    this.theme = game.config().theme();
    this.warshipRange = this.game.config().warshipTargettingRange();
    this.SAMRange = this.game.config().samSearchRange();
    this.defensePostRange = this.game.config().defensePostRange();
  }

  shouldTransform(): boolean {
    return true;
  }

  tick() {
    // Update the selection animation time
    this.selectionAnimTime = (this.selectionAnimTime + 1) % 60;
    // Clear the canvas
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    // If there's a selected warship, redraw to update the selection box animation
    if (this.selectedUnit && this.selectedUnit.type() === UnitType.Warship) {
      if (this.rangeMode !== showRangeMode.None) {
        this.drawCircle(this.selectedUnit, this.warshipRange);
      }
      this.drawSelectionBox(this.selectedUnit);
    }
    this.drawCircleForAllUnits();
  }

  init() {
    this.eventBus.on(MouseMoveEvent, (e: MouseMoveEvent) =>
      this.onMouseEvent(e),
    );
    this.eventBus.on(ShowUnitRangeEvent, (e) => this.onShowRangeMode(e));
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
   * Handle mouse movement events
   * @param event The mouse move event
   */
  private onMouseEvent(event: MouseMoveEvent) {
    const now = Date.now();
    if (now - this.lastMouseUpdate < 100) {
      return;
    }
    this.lastMouseUpdate = now;
    this.setLastMousePosition(event.x, event.y);
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
   * Handle the event to switch between range display modes (none, mouse-only, or all units)
   */
  private onShowRangeMode(event: ShowUnitRangeEvent) {
    this.rangeMode = event.showRangeMode;
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
   * Draw circles around all units based on the selected range mode
   */
  public drawCircleForAllUnits() {
    let units;
    if (this.rangeMode === showRangeMode.None) {
      return;
    } else if (
      this.rangeMode === showRangeMode.OnlyMouse &&
      this.lastMousePosition
    ) {
      units = this.game
        .units(UnitType.DefensePost, UnitType.SAMLauncher)
        .filter(
          (u) =>
            euclideanDistWorld(this.lastMousePosition, u.tile(), this.game) <
            80,
        );
    } else if (this.rangeMode === showRangeMode.All) {
      units = this.game.units(UnitType.DefensePost, UnitType.SAMLauncher);
    }
    if (units?.length > 0) {
      for (const unit of units) {
        const radius =
          unit.type() === UnitType.DefensePost
            ? this.defensePostRange
            : this.SAMRange;
        this.drawCircle(unit, radius);
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

  /**
   * Set the last mouse position in world coordinates
   * @param x The X coordinate of the mouse
   * @param y The Y coordinate of the mouse
   * This method converts the screen coordinates to world coordinates
   * and updates the lastMousePosition property.
   * It also checks if the coordinates are valid in the game world.
   * If the coordinates are not valid, it does nothing.
   */
  public setLastMousePosition(x: number, y: number) {
    const worldCoord = this.transformHandler.screenToWorldCoordinates(x, y);
    if (!this.game.isValidCoord(worldCoord.x, worldCoord.y)) {
      return;
    }
    this.lastMousePosition = worldCoord;
  }

  /**
   * Draw a circle at the unit's position
   * @param unit The unit to draw the circle around
   */
  private drawCircle(unit: UnitView, radius: number) {
    if (!unit || !unit.isActive()) {
      return;
    }

    // Get unit position
    const center = unit.tile();
    const centerX = this.game.x(center);
    const centerY = this.game.y(center);

    // Create radial gradient
    const gradient = this.context.createRadialGradient(
      centerX,
      centerY,
      0, // inner circle center and radius
      centerX,
      centerY,
      radius, // outer circle center and radius
    );

    // Get the unit's owner color
    const ownerColor = this.theme.territoryColor(unit.owner());
    const color = ownerColor.lighten(0.2);

    // Add gradient color stops
    gradient.addColorStop(0, color.alpha(0.2).toRgbString()); // Center color (opaque)
    gradient.addColorStop(0.7, color.alpha(0.3).toRgbString()); // Middle color (semi-transparent)
    gradient.addColorStop(1, color.alpha(1).toRgbString()); // Edge color (transparent)

    // Draw the circle
    this.context.beginPath();
    this.context.arc(centerX, centerY, radius, 0, Math.PI * 2);
    this.context.fillStyle = gradient;
    this.context.fill();
  }

  paintCell(x: number, y: number, color: Colord, alpha: number) {
    this.clearCell(x, y);
    this.context.fillStyle = color.alpha(alpha / 255).toRgbString();
    this.context.fillRect(x, y, 1, 1);
  }

  clearCell(x: number, y: number) {
    this.context.clearRect(x, y, 1, 1);
  }
}
