import { Colord } from "colord";
import { EventBus } from "../../../core/EventBus";
import { ClientID } from "../../../core/Schemas";
import { Theme } from "../../../core/configuration/Config";
import { UnitType } from "../../../core/game/Game";
import { GameView, UnitView } from "../../../core/game/GameView";
import { MouseMoveEvent, UnitSelectionEvent } from "../../InputHandler";
import { LastSelectedBuildableEvent } from "../../Transport";
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
  private lastSelectedBuildIcon: HTMLImageElement | null = null;
  private lastSelectedBuildableUnit: UnitType | null = null;
  private lastMousePosition: { x: number; y: number } | null = null;
  private canBuildLastSelectedBuildableUnit: boolean = false;

  // Keep track of previous selection box position for cleanup
  private lastSelectionBoxCenter: {
    x: number;
    y: number;
    size: number;
  } | null = null;

  // Visual settings for selection
  private readonly SELECTION_BOX_SIZE = 6; // Size of the selection box (should be larger than the warship)
  private lastMouseUpdate: number = 0;

  constructor(
    private game: GameView,
    private eventBus: EventBus,
    private clientID: ClientID,
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

    // Clear the canvas for redrawing
    this.context?.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // If there's a selected warship, redraw to update the selection box animation
    if (this.selectedUnit && this.selectedUnit.type() === UnitType.Warship) {
      this.drawSelectionBox(this.selectedUnit);
    }
    // Draw the last selected build icon
    this.drawBuildIcon();
  }

  init() {
    this.eventBus.on(MouseMoveEvent, (e) => {
      this.onMouseEvent(e);
    });
    this.eventBus.on(LastSelectedBuildableEvent, (e) =>
      this.onlastSelectedBuild(e),
    );
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
    if (now - this.lastMouseUpdate < 1000 / 60) {
      return;
    }
    this.setLastMousePosition(event.x, event.y);
    this.lastMouseUpdate = now;
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

    const tile = this.game.ref(
      this.lastMousePosition.x,
      this.lastMousePosition.y,
    );

    this.game
      .myPlayer()
      ?.actions(tile)
      ?.then((actions) => {
        const unit = actions.buildableUnits.find(
          (u) => u.type === this.lastSelectedBuildableUnit,
        );
        if (unit && unit.canBuild !== false) {
          this.canBuildLastSelectedBuildableUnit = true;
        } else {
          this.canBuildLastSelectedBuildableUnit = false;
        }
      });
  }

  /**
   * Handle the last selected buildable event
   */
  private onlastSelectedBuild(event: LastSelectedBuildableEvent) {
    if (event.icon) {
      const icon = new Image();
      icon.src = event.icon;
      icon.onload = () => {
        this.lastSelectedBuildIcon = icon;
        this.lastSelectedBuildableUnit = event.unit;
      };
      icon.onerror = () => {
        console.error("Failed to load build icon:", event.icon);
        this.lastSelectedBuildIcon = null;
      };
    } else {
      this.lastSelectedBuildIcon = null;
      this.lastSelectedBuildableUnit = null;
    }
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
   * Draw the build icon at the last mouse position
   */
  public drawBuildIcon() {
    const icon = this.lastSelectedBuildIcon;
    if (!icon || !this.lastMousePosition || !this.context) {
      return;
    }
    if (!this.canBuildLastSelectedBuildableUnit) {
      // Draw the icon with a red overlay
      this.context.save();
      this.context.drawImage(
        icon,
        this.lastMousePosition.x - 8,
        this.lastMousePosition.y - 8,
        16,
        16,
      );
      this.context.globalCompositeOperation = "source-atop";
      this.context.fillStyle = "rgba(255, 0, 0, 0.5)";
      this.context.fillRect(
        this.lastMousePosition.x - 8,
        this.lastMousePosition.y - 8,
        16,
        16,
      );
      this.context.restore();
    } else {
      // Draw the icon normally
      this.context.drawImage(
        icon,
        this.lastMousePosition.x - 8,
        this.lastMousePosition.y - 8,
        16,
        16,
      );
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
