import { EventBus } from "../../../core/EventBus";
import { UnitType } from "../../../core/game/Game";
import { TileRef } from "../../../core/game/GameMap";
import { GameView } from "../../../core/game/GameView";
import { ParabolaPathFinder } from "../../../core/pathfinding/PathFinding";
import {
  GhostStructureChangedEvent,
  MouseMoveEvent,
  SwapRocketDirectionEvent,
} from "../../InputHandler";
import { TransformHandler } from "../TransformHandler";
import { UIState } from "../UIState";
import { Layer } from "./Layer";

/**
 * Layer responsible for rendering the nuke trajectory preview line
 * when a nuke type (AtomBomb or HydrogenBomb) is selected and the user hovers over potential targets.
 */
export class NukeTrajectoryPreviewLayer implements Layer {
  // Trajectory preview state
  private mousePos = { x: 0, y: 0 };
  private trajectoryPoints: TileRef[] = [];
  private lastTrajectoryUpdate: number = 0;
  private lastTargetTile: TileRef | null = null;
  private currentGhostStructure: UnitType | null = null;
  private cachedSpawnTile: TileRef | null = null; // Cache spawn tile to avoid expensive player.actions() calls

  constructor(
    private game: GameView,
    private eventBus: EventBus,
    private transformHandler: TransformHandler,
    private uiState: UIState,
  ) {}

  shouldTransform(): boolean {
    return true;
  }

  init() {
    this.eventBus.on(MouseMoveEvent, (e) => {
      this.mousePos.x = e.x;
      this.mousePos.y = e.y;
    });
    this.eventBus.on(GhostStructureChangedEvent, (e) => {
      this.currentGhostStructure = e.ghostStructure;
      // Clear trajectory if ghost structure changed
      if (
        e.ghostStructure !== UnitType.AtomBomb &&
        e.ghostStructure !== UnitType.HydrogenBomb
      ) {
        this.trajectoryPoints = [];
        this.lastTargetTile = null;
        this.cachedSpawnTile = null;
      }
    });
    this.eventBus.on(SwapRocketDirectionEvent, () => {
      // Toggle rocket direction
      this.uiState.rocketDirectionUp = !this.uiState.rocketDirectionUp;
      // Force trajectory recalculation
      this.lastTargetTile = null;
    });
  }

  tick() {
    this.updateTrajectoryPreview();
  }

  renderLayer(context: CanvasRenderingContext2D) {
    // Update trajectory path each frame for smooth responsiveness
    this.updateTrajectoryPath();
    this.drawTrajectoryPreview(context);
  }

  /**
   * Update trajectory preview - called from tick() to cache spawn tile via expensive player.actions() call
   * This only runs when target tile changes, minimizing worker thread communication
   */
  private updateTrajectoryPreview() {
    const ghostStructure = this.currentGhostStructure;
    const isNukeType =
      ghostStructure === UnitType.AtomBomb ||
      ghostStructure === UnitType.HydrogenBomb;

    // Clear trajectory if not a nuke type
    if (!isNukeType) {
      this.cachedSpawnTile = null;
      return;
    }

    // Throttle updates (similar to StructureIconsLayer.renderGhost)
    const now = performance.now();
    if (now - this.lastTrajectoryUpdate < 50) {
      return;
    }
    this.lastTrajectoryUpdate = now;

    const player = this.game.myPlayer();
    if (!player) {
      this.trajectoryPoints = [];
      this.lastTargetTile = null;
      this.cachedSpawnTile = null;
      return;
    }

    // Convert mouse position to world coordinates
    const rect = this.transformHandler.boundingRect();
    if (!rect) {
      this.trajectoryPoints = [];
      this.cachedSpawnTile = null;
      return;
    }

    const localX = this.mousePos.x - rect.left;
    const localY = this.mousePos.y - rect.top;
    const worldCoords = this.transformHandler.screenToWorldCoordinates(
      localX,
      localY,
    );

    if (!this.game.isValidCoord(worldCoords.x, worldCoords.y)) {
      this.trajectoryPoints = [];
      this.lastTargetTile = null;
      this.cachedSpawnTile = null;
      return;
    }

    const targetTile = this.game.ref(worldCoords.x, worldCoords.y);

    // Only recalculate if target tile changed
    if (this.lastTargetTile === targetTile) {
      return;
    }

    this.lastTargetTile = targetTile;

    // Get buildable units to find spawn tile (expensive call - only on tick when tile changes)
    player
      .actions(targetTile)
      .then((actions) => {
        // Ignore stale results if target changed
        if (this.lastTargetTile !== targetTile) {
          return;
        }

        const buildableUnit = actions.buildableUnits.find(
          (bu) => bu.type === ghostStructure,
        );

        if (!buildableUnit || buildableUnit.canBuild === false) {
          this.cachedSpawnTile = null;
          return;
        }

        const spawnTile = buildableUnit.canBuild;
        if (!spawnTile) {
          this.cachedSpawnTile = null;
          return;
        }

        // Cache the spawn tile for use in updateTrajectoryPath()
        this.cachedSpawnTile = spawnTile;
      })
      .catch(() => {
        // Handle errors silently
        this.cachedSpawnTile = null;
      });
  }

  /**
   * Update trajectory path - called from renderLayer() each frame for smooth visual feedback
   * Uses cached spawn tile to avoid expensive player.actions() calls
   */
  private updateTrajectoryPath() {
    const ghostStructure = this.currentGhostStructure;
    const isNukeType =
      ghostStructure === UnitType.AtomBomb ||
      ghostStructure === UnitType.HydrogenBomb;

    // Clear trajectory if not a nuke type or no cached spawn tile
    if (!isNukeType || !this.cachedSpawnTile) {
      this.trajectoryPoints = [];
      return;
    }

    const player = this.game.myPlayer();
    if (!player) {
      this.trajectoryPoints = [];
      return;
    }

    // Convert mouse position to world coordinates
    const rect = this.transformHandler.boundingRect();
    if (!rect) {
      this.trajectoryPoints = [];
      return;
    }

    const localX = this.mousePos.x - rect.left;
    const localY = this.mousePos.y - rect.top;
    const worldCoords = this.transformHandler.screenToWorldCoordinates(
      localX,
      localY,
    );

    if (!this.game.isValidCoord(worldCoords.x, worldCoords.y)) {
      this.trajectoryPoints = [];
      return;
    }

    const targetTile = this.game.ref(worldCoords.x, worldCoords.y);

    // Calculate trajectory using ParabolaPathFinder with cached spawn tile
    const pathFinder = new ParabolaPathFinder(this.game);
    const speed = this.game.config().defaultNukeSpeed();
    const distanceBasedHeight = true; // AtomBomb/HydrogenBomb use distance-based height

    pathFinder.computeControlPoints(
      this.cachedSpawnTile,
      targetTile,
      speed,
      distanceBasedHeight,
      this.uiState.rocketDirectionUp,
    );

    this.trajectoryPoints = pathFinder.allTiles();
  }

  /**
   * Draw trajectory preview line on the canvas
   */
  private drawTrajectoryPreview(context: CanvasRenderingContext2D) {
    const ghostStructure = this.currentGhostStructure;
    const isNukeType =
      ghostStructure === UnitType.AtomBomb ||
      ghostStructure === UnitType.HydrogenBomb;

    if (!isNukeType || this.trajectoryPoints.length === 0) {
      return;
    }

    const player = this.game.myPlayer();
    if (!player) {
      return;
    }

    const territoryColor = player.territoryColor();
    const lineColor = territoryColor.alpha(0.7).toRgbString();

    // Calculate offset to center coordinates (same as canvas drawing)
    const offsetX = -this.game.width() / 2;
    const offsetY = -this.game.height() / 2;

    context.save();
    context.strokeStyle = lineColor;
    context.lineWidth = 1.5;
    context.setLineDash([8, 4]);
    context.beginPath();

    // Draw line connecting trajectory points
    for (let i = 0; i < this.trajectoryPoints.length; i++) {
      const tile = this.trajectoryPoints[i];
      const x = this.game.x(tile) + offsetX;
      const y = this.game.y(tile) + offsetY;

      if (i === 0) {
        context.moveTo(x, y);
      } else {
        context.lineTo(x, y);
      }
    }

    context.stroke();
    context.restore();
  }
}
