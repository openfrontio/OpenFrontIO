import type { EventBus } from "../../../core/EventBus";
import { listNukeBreakAlliance } from "../../../core/execution/Util";
import { UnitType } from "../../../core/game/Game";
import { TileRef } from "../../../core/game/GameMap";
import type { GameView } from "../../../core/game/GameView";
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
 * A layer that calculates nuke shared information
 * for other layers to draw from.
 * Does not draw anything itself!
 */
export class NukeRenderUtilLayer implements Layer {
  private mousePos = { x: 0, y: 0 };
  private currentGhostStructure: UnitType | null = null;
  private nukeGhostActive = false;
  private targetTile: TileRef | null = null;
  private spawnTile: TileRef | null = null; // only updated on tick

  // A list of every player that would have their alliance break if nuked.
  // Includes players not currently allied.
  private allianceStressedPlayers = new Set<number>();

  // for trajectory prediction
  private trajectoryPoints: TileRef[] = [];
  private untargetableSegmentBounds: [number, number] = [-1, -1];
  private targetedIndex = -1;
  private lastTrajectoryUpdate: number = 0;
  private lastTargetTile: TileRef | null = null;

  // A list of players currently stressed or intercepting the trajectory.
  private interceptingPlayers = new Set<number>();

  constructor(
    private readonly game: GameView,
    private readonly eventBus: EventBus,
    private readonly uiState: UIState,
    private readonly transformHandler: TransformHandler,
  ) {}

  init() {
    this.eventBus.on(MouseMoveEvent, (e) => {
      this.mousePos.x = e.x;
      this.mousePos.y = e.y;
    });
    this.eventBus.on(GhostStructureChangedEvent, (e) => {
      this.currentGhostStructure = e.ghostStructure;
      this.nukeGhostActive =
        e.ghostStructure === UnitType.AtomBomb ||
        e.ghostStructure === UnitType.HydrogenBomb;
    });
    this.eventBus.on(SwapRocketDirectionEvent, (event) => {
      this.uiState.rocketDirectionUp = event.rocketDirectionUp;
      // Force trajectory recalculation
      this.lastTargetTile = null;
    });
  }

  /**
   * Update trajectory preview - called from tick() to cache spawn tile via expensive player.actions() call
   * This only runs when target tile changes, minimizing worker thread communication
   */
  private trajectoryPreviewTick() {
    // Clear trajectory if not a nuke type
    if (!this.nukeGhostActive) {
      this.spawnTile = null;
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
      this.lastTargetTile = null;
      this.spawnTile = null;
      return;
    }

    if (this.findTargetTile() === null) {
      this.spawnTile = null;
      return;
    }

    // Only recalculate if target tile changed
    if (this.lastTargetTile === this.targetTile) {
      return;
    }

    this.lastTargetTile = this.targetTile;

    // Get buildable units to find spawn tile (expensive call - only on tick when tile changes)
    player
      .actions(this.targetTile as number)
      .then((actions) => {
        // Ignore stale results if target changed
        if (this.lastTargetTile !== this.targetTile) {
          return;
        }
        const buildableUnit = actions.buildableUnits.find(
          (bu) => bu.type === this.currentGhostStructure,
        );
        if (!buildableUnit || buildableUnit.canBuild === false) {
          this.spawnTile = null;
          return;
        }
        const spawnTile = buildableUnit.canBuild;
        if (!spawnTile) {
          this.spawnTile = null;
          return;
        }
        // Cache the spawn tile for use in updateTrajectoryPath()
        this.spawnTile = spawnTile;
      })
      .catch(() => {
        // Handle errors silently
        this.spawnTile = null;
      });
  }

  /**
   * Update trajectory path - called from renderLayer() each frame for smooth visual feedback
   * Uses cached spawn tile to avoid expensive player.actions() calls
   */
  private trajectoryPreviewFrame() {
    // Target is already found for this frame when this is called in renderLayer().
    // Safety check
    if (!this.spawnTile || !this.targetTile) {
      this.clearCurrentTrajectory();
      return;
    }
    // Calculate trajectory using ParabolaUniversalPathFinder with cached spawn tile
    const speed = this.game.config().defaultNukeSpeed();
    const pathFinder = UniversalPathFinding.Parabola(this.game, {
      increment: speed,
      distanceBasedHeight: true, // AtomBomb/HydrogenBomb use distance-based height
      directionUp: this.uiState.rocketDirectionUp,
    });

    this.trajectoryPoints =
      pathFinder.findPath(this.spawnTile, this.targetTile) ?? [];

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
          this.game.euclideanDistSquared(tile, this.spawnTile) >
          targetRangeSquared
        ) {
          if (
            this.game.euclideanDistSquared(tile, this.targetTile) <
            targetRangeSquared
          ) {
            // overlapping spawn & target range
            break;
          } else {
            this.untargetableSegmentBounds[0] = i;
          }
        }
      } else if (
        this.game.euclideanDistSquared(tile, this.targetTile) <
        targetRangeSquared
      ) {
        this.untargetableSegmentBounds[1] = i;
        break;
      }
    }
    this.interceptingPlayers = new Set();
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
          (this.game.myPlayer()?.isFriendly(sam.unit.owner()) &&
            !this.allianceStressedPlayers.has(sam.unit.owner().smallID()) &&
            !this.interceptingPlayers.has(sam.unit.owner().smallID()))
        ) {
          continue;
        }
        if (
          sam.distSquared <=
          this.game.config().samRange(sam.unit.level()) ** 2
        ) {
          this.targetedIndex = i;
          this.interceptingPlayers.add(sam.unit.owner().smallID());
        }
      }
      if (this.targetedIndex !== this.trajectoryPoints.length) break;
      // Jump over untargetable segment
      if (i === this.untargetableSegmentBounds[0])
        i = this.untargetableSegmentBounds[1] - 1;
    }
  }

  // Attempts to find the tile the mouse points to.
  // If valid, sets the targetTile property and returns it.
  private findTargetTile(): TileRef | null {
    this.targetTile = null;
    if (!this.nukeGhostActive) {
      return null;
    }
    // Convert mouse position to world coordinates
    const rect = this.transformHandler.boundingRect();
    if (!rect) {
      return null;
    }
    const localX = this.mousePos.x - rect.left;
    const localY = this.mousePos.y - rect.top;
    const worldCoords = this.transformHandler.screenToWorldCoordinates(
      localX,
      localY,
    );
    if (!this.game.isValidCoord(worldCoords.x, worldCoords.y)) {
      return null;
    }
    this.targetTile = this.game.ref(worldCoords.x, worldCoords.y);
    return this.targetTile;
  }

  // Resets variables relating to trajectory prediction
  private clearCurrentTrajectory() {
    // check trajectory already cleared
    if (this.targetedIndex === -1) {
      return;
    }
    this.trajectoryPoints = [];
    this.interceptingPlayers.clear();
    this.targetedIndex = -1;
    this.untargetableSegmentBounds = [-1, -1];
  }

  tick() {
    this.trajectoryPreviewTick();
  }

  renderLayer(context: CanvasRenderingContext2D) {
    if (this.findTargetTile() === null || !this.spawnTile) {
      this.allianceStressedPlayers.clear();
      this.clearCurrentTrajectory();
      return;
    }
    const player = this.game.myPlayer();
    if (!player) {
      return;
    }

    // Calculate which players are "stressed" by current nuke placement.
    this.allianceStressedPlayers = listNukeBreakAlliance({
      game: this.game,
      targetTile: this.targetTile as number,
      magnitude: this.game
        .config()
        .nukeMagnitudes(this.uiState.ghostStructure as UnitType),
      playerID: player.smallID(),
      allySmallIds: new Set(
        this.game
          .myPlayer()
          ?.allies()
          .map((a) => a.smallID()),
      ),
      threshold: this.game.config().nukeAllianceBreakThreshold(),
    });

    // Calculate possible trajectory
    this.trajectoryPreviewFrame();
  }

  isNukeGhostActive() {
    return this.nukeGhostActive;
  }

  // players who are targeted by nuke are stressed
  getAllianceStressedPlayers() {
    return this.allianceStressedPlayers;
  }

  // players who will shoot the nuke down first are intercepting
  getInterceptingPlayers() {
    return this.interceptingPlayers;
  }

  getTrajectoryInfo() {
    return {
      trajectoryPoints: this.trajectoryPoints,
      untargetableSegmentBounds: this.untargetableSegmentBounds,
      targetedIndex: this.targetedIndex,
    };
  }
}
