import { EventBus } from "../../../core/EventBus";
import { UnitType } from "../../../core/game/Game";
import { TileRef } from "../../../core/game/GameMap";
import { GameView } from "../../../core/game/GameView";
import { UniversalPathFinding } from "../../../core/pathfinding/PathFinder";
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
  private untargetableSegmentBounds: [number, number] = [-1, -1];
  private targetedIndex = -1;
  private lastTrajectoryUpdate: number = 0;
  private lastTargetTile: TileRef | null = null;
  private currentGhostStructure: UnitType | null = null;
  // Cache spawn tile to avoid expensive player.actions() calls
  private cachedSpawnTile: TileRef | null = null;

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
    this.eventBus.on(SwapRocketDirectionEvent, (event) => {
      this.uiState.rocketDirectionUp = event.rocketDirectionUp;
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

    // Calculate trajectory using ParabolaUniversalPathFinder with cached spawn tile
    const speed = this.game.config().defaultNukeSpeed();
    const pathFinder = UniversalPathFinding.Parabola(this.game, {
      increment: speed,
      distanceBasedHeight: true, // AtomBomb/HydrogenBomb use distance-based height
      directionUp: this.uiState.rocketDirectionUp,
    });

    this.trajectoryPoints =
      pathFinder.findPath(this.cachedSpawnTile, targetTile) ?? [];

    // NOTE: This is a lot to do in the rendering method, naive
    // But trajectory is already calculated here and needed for prediction.
    // From testing, does not seem to have much effect, so I keep it this way.

    // Calculate points when bomb targetability switches
    const targetRangeSquared =
      this.game.config().defaultNukeTargetableRange() ** 2;

    // Find two switch points where bomb transitions:
    // [0]: leaves spawn range, enters untargetable zone
    // [1]: enters target range, becomes targetable again
    this.untargetableSegmentBounds = [-1, -1];
    for (let i = 0; i < this.trajectoryPoints.length; i++) {
      const tile = this.trajectoryPoints[i];
      if (this.untargetableSegmentBounds[0] === -1) {
        if (
          this.game.euclideanDistSquared(tile, this.cachedSpawnTile) >
          targetRangeSquared
        ) {
          if (
            this.game.euclideanDistSquared(tile, targetTile) <
            targetRangeSquared
          ) {
            // overlapping spawn & target range
            break;
          } else {
            this.untargetableSegmentBounds[0] = i;
          }
        }
      } else if (
        this.game.euclideanDistSquared(tile, targetTile) < targetRangeSquared
      ) {
        this.untargetableSegmentBounds[1] = i;
        break;
      }
    }
    // Find the point where SAM can intercept
    this.targetedIndex = this.trajectoryPoints.length;
    // Check trajectory
    for (let i = 0; i < this.trajectoryPoints.length; i++) {
      const tile = this.trajectoryPoints[i];
      for (const sam of this.game.nearbyUnits(
        tile,
        this.game.config().maxSamRange(),
        UnitType.SAMLauncher,
      )) {
        if (
          sam.unit.owner().isMe() ||
          this.game.myPlayer()?.isFriendly(sam.unit.owner())
        ) {
          continue;
        }
        if (
          sam.distSquared <=
          this.game.config().samRange(sam.unit.level()) ** 2
        ) {
          this.targetedIndex = i;
          break;
        }
      }
      if (this.targetedIndex !== this.trajectoryPoints.length) break;
      // Jump over untargetable segment
      if (i === this.untargetableSegmentBounds[0])
        i = this.untargetableSegmentBounds[1] - 1;
    }
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
    for (let i = 0; i < this.trajectoryPoints.length; i++) {
      const tile = this.trajectoryPoints[i];
      const x = this.game.x(tile) + offsetX;
      const y = this.game.y(tile) + offsetY;

      if (i === 0) {
        context.moveTo(x, y);
      } else {
        context.lineTo(x, y);
      }
      if (i === this.untargetableSegmentBounds[0]) {
        outlineAndStroke();
        drawUntargetableCircle(x, y);
        context.beginPath();
        if (i >= this.targetedIndex) {
          currentOutlineColor = targetedOutlineColor;
          currentLineColor = untargetableAndTargetedLineColor;
          currentLineDash = untargetableAndTargetedLineDash;
        } else {
          currentOutlineColor = untargetedOutlineColor;
          currentLineColor = untargetableAndUntargetedLineColor;
          currentLineDash = untargetableAndUntargetedLineDash;
        }
      } else if (i === this.untargetableSegmentBounds[1]) {
        outlineAndStroke();
        drawUntargetableCircle(x, y);
        context.beginPath();
        if (i >= this.targetedIndex) {
          currentOutlineColor = targetedOutlineColor;
          currentLineColor = targetableAndTargetedLineColor;
          currentLineDash = targetableAndTargetedLineDash;
        } else {
          currentOutlineColor = untargetedOutlineColor;
          currentLineColor = targetableAndUntargetedLineColor;
          currentLineDash = targetableAndUntargetedLineDash;
        }
      }
      if (i === this.targetedIndex) {
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
