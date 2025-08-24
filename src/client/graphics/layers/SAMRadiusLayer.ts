import type { GameView, UnitView } from "../../../core/game/GameView";
import type { EventBus } from "../../../core/EventBus";
import { GameUpdateType } from "../../../core/game/GameUpdates";
import { Layer } from "./Layer";
import { TransformHandler } from "../TransformHandler";
import { UnitType } from "../../../core/game/Game";

/**
 * Layer responsible for rendering SAM launcher defense radiuses
 */
export class SAMRadiusLayer implements Layer {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly samLaunchers: Set<number> = new Set(); // Track SAM launcher IDs
  private needsRedraw = true;

  constructor(
    private readonly game: GameView,
    private readonly eventBus: EventBus,
    private readonly transformHandler: TransformHandler,
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

  init() {
    // Listen for game updates to detect SAM launcher changes
    this.redraw();
  }

  shouldTransform(): boolean {
    return true;
  }

  tick() {
    // Check for updates to SAM launchers
    const updates = this.game.updatesSinceLastTick();
    const unitUpdates = updates?.[GameUpdateType.Unit];

    if (unitUpdates) {
      let hasChanges = false;

      for (const update of unitUpdates) {
        const unit = this.game.unit(update.id);
        if (unit && unit.type() === UnitType.SAMLauncher) {
          const wasTracked = this.samLaunchers.has(update.id);
          const shouldTrack = unit.isActive();

          if (wasTracked && !shouldTrack) {
            // SAM was destroyed
            this.samLaunchers.delete(update.id);
            hasChanges = true;
          } else if (!wasTracked && shouldTrack) {
            // New SAM was built
            this.samLaunchers.add(update.id);
            hasChanges = true;
          }
        }
      }

      if (hasChanges) {
        this.needsRedraw = true;
      }
    }

    // Redraw if transform changed or if we need to redraw
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

  redraw() {
    // Clear the canvas
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // Get all active SAM launchers
    const samLaunchers = this.game.units(UnitType.SAMLauncher).filter((unit) => unit.isActive());

    // Update our tracking set
    this.samLaunchers.clear();
    samLaunchers.forEach((sam) => this.samLaunchers.add(sam.id()));

    // Draw radius for each SAM launcher
    for (const sam of samLaunchers) {
      this.drawSAMRadius(sam);
    }
  }

  private drawSAMRadius(sam: UnitView) {
    const samTile = sam.tile();
    const centerX = this.game.x(samTile);
    const centerY = this.game.y(samTile);
    const radius = this.game.config().defaultSamRange(); // 70 pixels

    // Set up the drawing style
    this.context.save();

    // Create a contrasting color that will be visible against any background
    // Use a bright, highly visible color with good opacity
    this.context.strokeStyle = "rgba(255, 255, 0, 0.9)"; // Bright yellow with high opacity
    this.context.fillStyle = "rgba(255, 255, 0, 0.15)"; // Light yellow fill with more visibility
    this.context.lineWidth = 3; // Thicker line for better visibility
    this.context.setLineDash([8, 4]); // Larger dashed line for better visibility

    // Draw the circle
    this.context.beginPath();
    this.context.arc(centerX, centerY, radius, 0, 2 * Math.PI);

    // Fill first (very light), then stroke (more visible)
    this.context.fill();
    this.context.stroke();

    // Also add a secondary inner ring for extra visibility
    this.context.strokeStyle = "rgba(255, 255, 0, 0.6)";
    this.context.lineWidth = 1;
    this.context.setLineDash([4, 4]);

    this.context.beginPath();
    this.context.arc(centerX, centerY, radius - 5, 0, 2 * Math.PI);
    this.context.stroke();

    this.context.restore();
  }
}
