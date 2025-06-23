import { EventBus } from "../../../core/EventBus";
import { TileRef } from "../../../core/game/GameMap";
import { GameView, PlayerView } from "../../../core/game/GameView";
import { CtrlKeyStateEvent, MouseOverEvent } from "../../InputHandler";
import { TransformHandler } from "../TransformHandler";
import { Layer } from "./Layer";
import { TerritoryLayer } from "./TerritoryLayer";

const DARKEN_COLOR = "rgba(64, 64, 64, 1)";
const LAYER_ALPHA = 0.75;

export class TerritoryInfoLayer implements Layer {
  private finalMaskCanvas: HTMLCanvasElement;
  private finalMaskContext: CanvasRenderingContext2D;
  private isVisible: boolean = false;
  private highlightedTerritory: PlayerView | null | undefined = undefined;
  private hightlightedTiles: Set<TileRef> = new Set();
  private lastMousePosition: { x: number; y: number } | null = null;
  private layerMaskPending: boolean = false;

  constructor(
    private game: GameView,
    private eventBus: EventBus,
    private transformHandler: TransformHandler,
    private territoryLayer: TerritoryLayer,
  ) {}

  shouldTransform(): boolean {
    return true;
  }

  init() {
    this.eventBus.on(CtrlKeyStateEvent, (e) => this.onCtrlKeyStateChange(e));
    this.eventBus.on(MouseOverEvent, (e) => this.onMouseOver(e));
    this.initializeCanvas();
  }

  dispose() {
    this.eventBus.off(CtrlKeyStateEvent, (e) => this.onCtrlKeyStateChange(e));
    this.eventBus.off(MouseOverEvent, (e) => this.onMouseOver(e));
  }

  private initializeCanvas() {
    // Main canvas for final effect - copy from TerritoryLayer and darken
    this.finalMaskCanvas = document.createElement("canvas");
    const finalMaskContext = this.finalMaskCanvas.getContext("2d", {
      alpha: true,
    });
    if (finalMaskContext === null) throw new Error("2d context not supported");
    this.finalMaskContext = finalMaskContext;
    this.finalMaskCanvas.width = this.game.width();
    this.finalMaskCanvas.height = this.game.height();
  }

  onCtrlKeyStateChange(event: CtrlKeyStateEvent) {
    this.isVisible = event.isPressed;

    if (event.isPressed) {
      requestAnimationFrame(() => {
        this.updateMask();

        // Check current mouse position and update highlighted territory
        if (this.lastMousePosition) {
          this.updateHighlightedTerritory();
        }
      });
    } else {
      // If Ctrl is released, clear everything
      this.highlightedTerritory = undefined;
      this.updateMask();
    }
  }

  onMouseOver(event: MouseOverEvent) {
    this.lastMousePosition = { x: event.x, y: event.y };
    this.updateHighlightedTerritory();
  }

  private updateHighlightedTerritory() {
    if (!this.isVisible) {
      return;
    }

    if (!this.lastMousePosition) {
      return;
    }

    const cell = this.transformHandler.screenToWorldCoordinates(
      this.lastMousePosition.x,
      this.lastMousePosition.y,
    );
    if (!this.game.isValidCoord(cell.x, cell.y)) {
      return;
    }

    const previousTerritory = this.highlightedTerritory;
    const territory = this.findTerritoryAtCell(cell);

    if (territory) {
      this.highlightedTerritory = territory;
    } else {
      this.highlightedTerritory = null;
    }

    if (previousTerritory?.id() !== this.highlightedTerritory?.id()) {
      this.updateMask();
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

  private updateMask() {
    if (!this.isVisible) {
      this.finalMaskContext.clearRect(
        0,
        0,
        this.game.width(),
        this.game.height(),
      );
      return;
    }

    if (this.layerMaskPending) return;
    this.layerMaskPending = true;

    // Get the TerritoryLayer's canvas and copy it
    const territoryCanvas = this.territoryLayer.getCanvas();

    if (!territoryCanvas) {
      console.error("Territory canvas not available");
      return;
    }

    // Clear the canvas first
    this.finalMaskContext.clearRect(
      0,
      0,
      this.game.width(),
      this.game.height(),
    );

    // Draw the territory canvas with a darken filter
    this.finalMaskContext.globalCompositeOperation = "source-over";
    this.finalMaskContext.fillStyle = DARKEN_COLOR;
    this.finalMaskContext.fillRect(0, 0, this.game.width(), this.game.height());

    // Use destination-in to only keep the non-transparent areas from territory
    this.finalMaskContext.globalCompositeOperation = "destination-in";
    this.finalMaskContext.drawImage(territoryCanvas, 0, 0);

    // If a territory is highlighted, remove it from the darken mask
    if (this.highlightedTerritory) {
      // Use destination-out to remove the highlighted territory from the darken mask
      this.finalMaskContext.globalCompositeOperation = "destination-out";
      this.finalMaskContext.fillStyle = "rgba(255, 255, 255, 1)";

      this.game.forEachTile((tile) => {
        if (this.game.hasOwner(tile)) {
          const owner = this.game.owner(tile) as PlayerView;
          if (owner === this.highlightedTerritory) {
            this.finalMaskContext.fillRect(
              this.game.x(tile),
              this.game.y(tile),
              1,
              1,
            );
          }
        }
      });

      this.finalMaskContext.globalCompositeOperation = "source-over";
    }
    this.layerMaskPending = false;
  }

  renderLayer(context: CanvasRenderingContext2D) {
    if (this.isVisible) {
      const currentAlpha = context.globalAlpha;
      context.globalAlpha = LAYER_ALPHA;

      // Cache the transform values to avoid repeated calculations
      const offsetX = -this.game.width() / 2;
      const offsetY = -this.game.height() / 2;

      context.drawImage(
        this.finalMaskCanvas,
        offsetX,
        offsetY,
        this.game.width(),
        this.game.height(),
      );

      context.globalAlpha = currentAlpha;
    }
  }

  tick() {
    if (this.isVisible) {
      // Check if any tiles have been updated
      const recentlyUpdatedTiles = this.game.recentlyUpdatedTiles();
      if (recentlyUpdatedTiles.length > 0) {
        this.updateMask();

        // Check if the highlighted needs to be updated
        if (this.highlightedTerritory) {
          const hasTerritoryUpdates = recentlyUpdatedTiles.some(
            (tile) =>
              this.game.hasOwner(tile) &&
              this.game.owner(tile)?.id() === this.highlightedTerritory?.id(),
          );

          const hasIncomingAttacks =
            this.highlightedTerritory.incomingAttacks().length > 0;

          if (hasTerritoryUpdates || hasIncomingAttacks) {
            this.updateHighlightedTerritory();
          }
        }
      }
    }
  }
}
