import { Colord } from "colord";
import { EventBus } from "../../../core/EventBus";
import { Theme } from "../../../core/configuration/Config";
import { UnitType } from "../../../core/game/Game";
import { GameUpdateType } from "../../../core/game/GameUpdates";
import { GameView, UnitView } from "../../../core/game/GameView";
import { UserSettings } from "../../../core/game/UserSettings";
import { TileRef } from "../../../core/game/GameMap";
import { ParabolaPathFinder } from "../../../core/pathfinding/PathFinding";
import { MouseMoveEvent, UnitSelectionEvent } from "../../InputHandler";
import { ProgressBar } from "../ProgressBar";
import { TransformHandler } from "../TransformHandler";
import { UIState } from "../UIState";
import { Layer } from "./Layer";

const COLOR_PROGRESSION = [
  "rgb(232, 25, 25)",
  "rgb(240, 122, 25)",
  "rgb(202, 231, 15)",
  "rgb(44, 239, 18)",
];
const HEALTHBAR_WIDTH = 11; // Width of the health bar
const LOADINGBAR_WIDTH = 14; // Width of the loading bar
const PROGRESSBAR_HEIGHT = 3; // Height of a bar

/**
 * Layer responsible for drawing UI elements that overlay the game
 * such as selection boxes, health bars, etc.
 */
export class UILayer implements Layer {
  private canvas: HTMLCanvasElement;
  private context: CanvasRenderingContext2D | null;
  private theme: Theme | null = null;
  private userSettings: UserSettings = new UserSettings();
  private selectionAnimTime = 0;
  private allProgressBars: Map<
    number,
    { unit: UnitView; progressBar: ProgressBar }
  > = new Map();
  private allHealthBars: Map<number, ProgressBar> = new Map();
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

  // Trajectory preview state
  private mousePos = { x: 0, y: 0 };
  private trajectoryPoints: TileRef[] = [];
  private lastTrajectoryUpdate: number = 0;
  private lastTargetTile: TileRef | null = null;
  private lastGhostStructure: UnitType | null = null;

  constructor(
    private game: GameView,
    private eventBus: EventBus,
    private transformHandler: TransformHandler,
    private uiState: UIState,
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

    this.game
      .updatesSinceLastTick()
      ?.[GameUpdateType.Unit]?.map((unit) => this.game.unit(unit.id))
      ?.forEach((unitView) => {
        if (unitView === undefined) return;
        this.onUnitEvent(unitView);
      });
    this.updateProgressBars();
    this.updateTrajectoryPreview();
  }

  init() {
    this.eventBus.on(UnitSelectionEvent, (e) => this.onUnitSelection(e));
    this.eventBus.on(MouseMoveEvent, (e) => {
      this.mousePos.x = e.x;
      this.mousePos.y = e.y;
    });
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
    this.drawTrajectoryPreview(context);
  }

  redraw() {
    this.canvas = document.createElement("canvas");
    this.context = this.canvas.getContext("2d");

    this.canvas.width = this.game.width();
    this.canvas.height = this.game.height();
  }

  onUnitEvent(unit: UnitView) {
    switch (unit.type()) {
      case UnitType.Construction: {
        const constructionType = unit.constructionType();
        if (constructionType === undefined) {
          // Skip units without construction type
          return;
        }
        this.createLoadingBar(unit);
        break;
      }
      case UnitType.Warship: {
        this.drawHealthBar(unit);
        break;
      }
      case UnitType.City:
      case UnitType.Factory:
      case UnitType.DefensePost:
      case UnitType.Port:
      case UnitType.MissileSilo:
      case UnitType.SAMLauncher:
        if (
          unit.markedForDeletion() !== false ||
          unit.missileReadinesss() < 1
        ) {
          this.createLoadingBar(unit);
        }
        break;
      default:
        return;
    }
  }

  private clearIcon(icon: HTMLImageElement, startX: number, startY: number) {
    if (this.context !== null) {
      this.context.clearRect(startX, startY, icon.width, icon.height);
    }
  }

  private drawIcon(
    icon: HTMLImageElement,
    unit: UnitView,
    startX: number,
    startY: number,
  ) {
    if (this.context === null || this.theme === null) {
      return;
    }
    const color = unit.owner().borderColor();
    this.context.fillStyle = color.toRgbString();
    this.context.fillRect(startX, startY, icon.width, icon.height);
    this.context.drawImage(icon, startX, startY);
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
    const ownerColor = unit.owner().territoryColor();

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
   * Draw health bar for a unit
   */
  public drawHealthBar(unit: UnitView) {
    const maxHealth = this.game.unitInfo(unit.type()).maxHealth;
    if (maxHealth === undefined || this.context === null) {
      return;
    }
    if (
      this.allHealthBars.has(unit.id()) &&
      (unit.health() >= maxHealth || unit.health() <= 0 || !unit.isActive())
    ) {
      // full hp/dead warships dont need a hp bar
      this.allHealthBars.get(unit.id())?.clear();
      this.allHealthBars.delete(unit.id());
    } else if (
      unit.isActive() &&
      unit.health() < maxHealth &&
      unit.health() > 0
    ) {
      this.allHealthBars.get(unit.id())?.clear();
      const healthBar = new ProgressBar(
        COLOR_PROGRESSION,
        this.context,
        this.game.x(unit.tile()) - 4,
        this.game.y(unit.tile()) - 6,
        HEALTHBAR_WIDTH,
        PROGRESSBAR_HEIGHT,
        unit.health() / maxHealth,
      );
      // keep track of units that have health bars for clearing purposes
      this.allHealthBars.set(unit.id(), healthBar);
    }
  }

  private updateProgressBars() {
    this.allProgressBars.forEach((progressBarInfo, unitId) => {
      const progress = this.getProgress(progressBarInfo.unit);
      if (progress >= 1) {
        this.allProgressBars.get(unitId)?.progressBar.clear();
        this.allProgressBars.delete(unitId);
        return;
      } else {
        progressBarInfo.progressBar.setProgress(progress);
      }
    });
  }

  private getProgress(unit: UnitView): number {
    if (!unit.isActive()) {
      return 1;
    }
    switch (unit.type()) {
      case UnitType.Construction: {
        const constructionType = unit.constructionType();
        if (constructionType === undefined) {
          return 1;
        }
        const constDuration =
          this.game.unitInfo(constructionType).constructionDuration;
        if (constDuration === undefined) {
          throw new Error("unit does not have constructionTime");
        }
        return (
          (this.game.ticks() - unit.createdAt()) /
          (constDuration === 0 ? 1 : constDuration)
        );
      }
      case UnitType.MissileSilo:
      case UnitType.SAMLauncher:
        return !unit.markedForDeletion()
          ? unit.missileReadinesss()
          : this.deletionProgress(this.game, unit);
      case UnitType.City:
      case UnitType.Factory:
      case UnitType.Port:
      case UnitType.DefensePost:
        return this.deletionProgress(this.game, unit);
      default:
        return 1;
    }
  }

  private deletionProgress(game: GameView, unit: UnitView): number {
    const deleteAt = unit.markedForDeletion();
    if (deleteAt === false) return 1;
    return Math.max(
      0,
      (deleteAt - game.ticks()) / game.config().deletionMarkDuration(),
    );
  }

  public createLoadingBar(unit: UnitView) {
    if (!this.context) {
      return;
    }
    if (!this.allProgressBars.has(unit.id())) {
      const progressBar = new ProgressBar(
        COLOR_PROGRESSION,
        this.context,
        this.game.x(unit.tile()) - 6,
        this.game.y(unit.tile()) + 6,
        LOADINGBAR_WIDTH,
        PROGRESSBAR_HEIGHT,
        0,
      );
      this.allProgressBars.set(unit.id(), {
        unit,
        progressBar,
      });
    }
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

  /**
   * Update trajectory preview based on current mouse position and ghost structure
   */
  private updateTrajectoryPreview() {
    const ghostStructure = this.uiState.ghostStructure;
    const isNukeType =
      ghostStructure === UnitType.AtomBomb ||
      ghostStructure === UnitType.HydrogenBomb;

    // Clear trajectory if not a nuke type or ghost structure changed
    if (!isNukeType) {
      if (this.lastGhostStructure !== null) {
        this.trajectoryPoints = [];
        this.lastTargetTile = null;
      }
      this.lastGhostStructure = ghostStructure;
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
      this.lastTargetTile = null;
      return;
    }

    const targetTile = this.game.ref(worldCoords.x, worldCoords.y);

    // Only recalculate if target tile changed or ghost structure changed
    if (
      this.lastTargetTile === targetTile &&
      this.lastGhostStructure === ghostStructure
    ) {
      return;
    }

    this.lastTargetTile = targetTile;
    this.lastGhostStructure = ghostStructure;

    // Get buildable units to find spawn tile
    player
      .actions(targetTile)
      .then((actions) => {
        const buildableUnit = actions.buildableUnits.find(
          (bu) => bu.type === ghostStructure,
        );

        if (!buildableUnit || buildableUnit.canBuild === false) {
          this.trajectoryPoints = [];
          return;
        }

        const spawnTile = buildableUnit.canBuild;
        if (!spawnTile) {
          this.trajectoryPoints = [];
          return;
        }

        // Calculate trajectory using ParabolaPathFinder
        const pathFinder = new ParabolaPathFinder(this.game);
        const speed = this.game.config().defaultNukeSpeed();
        const distanceBasedHeight = true; // AtomBomb/HydrogenBomb use distance-based height

        pathFinder.computeControlPoints(
          spawnTile,
          targetTile,
          speed,
          distanceBasedHeight,
        );

        this.trajectoryPoints = pathFinder.allTiles();
      })
      .catch(() => {
        // Handle errors silently
        this.trajectoryPoints = [];
      });
  }

  /**
   * Draw trajectory preview line on the canvas
   */
  private drawTrajectoryPreview(context: CanvasRenderingContext2D) {
    const ghostStructure = this.uiState.ghostStructure;
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
