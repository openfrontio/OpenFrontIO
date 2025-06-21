import { EventBus } from "../../../core/EventBus";
import { GameView, PlayerView } from "../../../core/game/GameView";
import { CtrlKeyStateEvent, MouseOverEvent } from "../../InputHandler";
import { TransformHandler } from "../TransformHandler";
import { Layer } from "./Layer";

export class TerritoryInfoLayer implements Layer {
  private darkenCanvas: HTMLCanvasElement;
  private darkenContext: CanvasRenderingContext2D;
  private baseDarkenCanvas: HTMLCanvasElement;
  private baseDarkenContext: CanvasRenderingContext2D;
  private borderCanvas: HTMLCanvasElement;
  private borderContext: CanvasRenderingContext2D;

  private isVisible: boolean = false;
  private highlightedTerritory: PlayerView | null = null;
  private lastMousePosition: { x: number; y: number } | null = null;
  private baseDarkenDrawn: boolean = false;
  private maskUpdatePending: boolean = false;
  private borderUpdatePending: boolean = false;

  constructor(
    private game: GameView,
    private eventBus: EventBus,
    private transformHandler: TransformHandler,
  ) {}

  shouldTransform(): boolean {
    return true;
  }

  init() {
    this.eventBus.on(CtrlKeyStateEvent, (e) => this.onCtrlKeyStateChange(e));
    this.eventBus.on(MouseOverEvent, (e) => this.onMouseOver(e));
    this.initializeCanvas();
  }

  private initializeCanvas() {
    // Main canvas for final effect
    this.darkenCanvas = document.createElement("canvas");
    const darkenContext = this.darkenCanvas.getContext("2d", {
      alpha: true,
    });
    if (darkenContext === null) throw new Error("2d context not supported");
    this.darkenContext = darkenContext;
    this.darkenCanvas.width = this.game.width();
    this.darkenCanvas.height = this.game.height();

    // Base canvas for caching darkened territories
    this.baseDarkenCanvas = document.createElement("canvas");
    const baseDarkenContext = this.baseDarkenCanvas.getContext("2d", {
      alpha: true,
    });
    if (baseDarkenContext === null) throw new Error("2d context not supported");
    this.baseDarkenContext = baseDarkenContext;
    this.baseDarkenCanvas.width = this.game.width();
    this.baseDarkenCanvas.height = this.game.height();

    // Border canvas for drawing territory borders
    this.borderCanvas = document.createElement("canvas");
    const borderContext = this.borderCanvas.getContext("2d", {
      alpha: true,
    });
    if (borderContext === null) throw new Error("2d context not supported");
    this.borderContext = borderContext;
    this.borderCanvas.width = this.game.width();
    this.borderCanvas.height = this.game.height();
  }

  onCtrlKeyStateChange(event: CtrlKeyStateEvent) {
    this.isVisible = event.isPressed;

    if (event.isPressed) {
      // Immediate calculation of complete mask
      this.drawBaseDarkenMask();

      // Check current mouse position and update highlighted territory
      if (this.lastMousePosition) {
        this.checkTerritoryAtPosition(
          this.lastMousePosition.x,
          this.lastMousePosition.y,
        );
      }
    } else {
      // If Ctrl is released, clear everything
      this.highlightedTerritory = null;
      this.baseDarkenDrawn = false;
      this.scheduleMaskUpdate(null);
      // Clear border canvas immediately
      this.borderContext.clearRect(0, 0, this.game.width(), this.game.height());
    }
  }

  onMouseOver(event: MouseOverEvent) {
    this.lastMousePosition = { x: event.x, y: event.y };
    this.checkTerritoryAtPosition(event.x, event.y);
  }

  private checkTerritoryAtPosition(x: number, y: number) {
    // Early return if Ctrl is not pressed to avoid unnecessary calculations
    if (!this.isVisible) {
      if (this.highlightedTerritory !== null) {
        this.highlightedTerritory = null;
        this.scheduleMaskUpdate(null);
      }
      return;
    }

    const cell = this.transformHandler.screenToWorldCoordinates(x, y);
    if (!this.game.isValidCoord(cell.x, cell.y)) {
      return;
    }

    const previousTerritory = this.highlightedTerritory;
    const territory = this.findTerritoryAtCell(cell);

    // Only highlight territory if Ctrl key is pressed
    if (territory && this.isVisible) {
      this.highlightedTerritory = territory;
    } else {
      this.highlightedTerritory = null;
    }

    // Only update if the territory actually changed
    if (this.highlightedTerritory !== previousTerritory) {
      this.scheduleMaskUpdate(this.highlightedTerritory);
    }
  }

  private findTerritoryAtCell(cell: { x: number; y: number }) {
    const tile = this.game.ref(cell.x, cell.y);
    if (!tile) {
      return null;
    }
    // If the tile has no owner, it is either a fallout tile or a terra nullius tile.
    if (!this.game.hasOwner(tile)) {
      return null;
    }
    return this.game.owner(tile) as PlayerView;
  }

  private drawBaseDarkenMask() {
    if (this.baseDarkenDrawn) return; // Only draw once

    // Clear the canvas first
    /*this.baseDarkenContext.clearRect(
      0,
      0,
      this.game.width(),
      this.game.height(),
    );*/

    // Use a darker gray for better contrast with multiply
    this.baseDarkenContext.fillStyle = "rgba(64, 64, 64, 1)";

    // Draw darkened pixels for owned territories
    this.game.forEachTile((tile) => {
      if (this.game.hasOwner(tile)) {
        const x = this.game.x(tile);
        const y = this.game.y(tile);
        this.baseDarkenContext.fillRect(x, y, 1, 1);
      }
    });

    this.baseDarkenDrawn = true;
  }

  private updateDarkenMask(newTerritory: PlayerView | null) {
    if (!this.isVisible) {
      this.darkenContext.clearRect(0, 0, this.game.width(), this.game.height());
      return;
    }

    // Ensure base mask is drawn
    this.drawBaseDarkenMask();

    // Copy base mask to working canvas
    this.darkenContext.drawImage(this.baseDarkenCanvas, 0, 0);

    // If a territory is highlighted, remove it from the darken mask
    if (newTerritory) {
      // Cache the composite operation to avoid unnecessary state changes
      const originalComposite = this.darkenContext.globalCompositeOperation;
      this.darkenContext.globalCompositeOperation = "destination-out";
      this.darkenContext.fillStyle = "rgba(64, 64, 64, 1)";

      // Batch the fill operations for better performance
      const tilesToHighlight: { x: number; y: number }[] = [];

      this.game.forEachTile((tile) => {
        if (this.game.hasOwner(tile)) {
          const owner = this.game.owner(tile) as PlayerView;
          if (owner === newTerritory) {
            tilesToHighlight.push({
              x: this.game.x(tile),
              y: this.game.y(tile),
            });
          }
        }
      });

      // Batch fill all tiles at once
      for (const tile of tilesToHighlight) {
        this.darkenContext.fillRect(tile.x, tile.y, 1, 1);
      }

      this.darkenContext.globalCompositeOperation = originalComposite;
    }
  }

  private scheduleMaskUpdate(newTerritory: PlayerView | null) {
    if (this.maskUpdatePending) return;

    this.maskUpdatePending = true;
    requestAnimationFrame(() => {
      this.updateDarkenMask(newTerritory);
      this.scheduleBorderUpdate(newTerritory);
      this.maskUpdatePending = false;
    });
  }

  private scheduleBorderUpdate(newTerritory: PlayerView | null) {
    if (this.borderUpdatePending) return;

    this.borderUpdatePending = true;
    requestAnimationFrame(async () => {
      await this.updateBorderHighlight(newTerritory);
      this.borderUpdatePending = false;
    });
  }

  private async updateBorderHighlight(newTerritory: PlayerView | null) {
    // Clear the border canvas
    this.borderContext.clearRect(0, 0, this.game.width(), this.game.height());

    if (!this.isVisible || !newTerritory) {
      return;
    }

    // Draw white border around the highlighted territory
    try {
      const borderTiles = await newTerritory.borderTiles();
      this.borderContext.fillStyle = "rgba(255, 255, 255, 255)"; // White border

      borderTiles.borderTiles.forEach((tile: any) => {
        const x = this.game.x(tile);
        const y = this.game.y(tile);
        this.borderContext.fillRect(x, y, 1, 1);
      });
    } catch (error) {
      console.warn("Failed to draw territory border:", error);
    }
  }

  renderLayer(context: CanvasRenderingContext2D) {
    if (this.isVisible) {
      const currentAlpha = context.globalAlpha;
      context.globalAlpha = 0.5;

      // Cache the transform values to avoid repeated calculations
      const offsetX = -this.game.width() / 2;
      const offsetY = -this.game.height() / 2;

      context.drawImage(
        this.darkenCanvas,
        offsetX,
        offsetY,
        this.game.width(),
        this.game.height(),
      );

      context.globalAlpha = currentAlpha;

      // Draw the white border on top
      if (this.highlightedTerritory) {
        context.drawImage(
          this.borderCanvas,
          offsetX,
          offsetY,
          this.game.width(),
          this.game.height(),
        );
      }
    }
  }

  tick() {
    // Check for territory changes and invalidate base canvas if needed
    if (this.isVisible && this.baseDarkenDrawn) {
      const recentlyUpdatedTiles = this.game.recentlyUpdatedTiles();
      if (recentlyUpdatedTiles.length > 0) {
        // Only redraw the specific tiles that changed, not the entire canvas
        this.updateChangedTiles(recentlyUpdatedTiles);
        // Only update the mask if we have a highlighted territory
        if (this.highlightedTerritory) {
          this.scheduleMaskUpdate(this.highlightedTerritory);
        }
      }
    }
  }

  private updateChangedTiles(changedTiles: any[]) {
    // Update only the tiles that changed in the base darken mask
    for (const tile of changedTiles) {
      const x = this.game.x(tile);
      const y = this.game.y(tile);

      if (this.game.hasOwner(tile)) {
        // Set darkened pixel
        this.baseDarkenContext.fillStyle = "rgba(64, 64, 64, 1)";
        this.baseDarkenContext.fillRect(x, y, 1, 1);
      } else {
        // Clear pixel by drawing transparent
        this.baseDarkenContext.clearRect(x, y, 1, 1);
      }
    }
  }
}
