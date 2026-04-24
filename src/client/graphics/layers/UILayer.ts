import { Colord } from "colord";
import { EventBus } from "../../../core/EventBus";
import { Theme } from "../../../core/configuration/Config";
import { UnitType } from "../../../core/game/Game";
import { GameUpdateType } from "../../../core/game/GameUpdates";
import { GameView, UnitView } from "../../../core/game/GameView";
import {
  CloseViewEvent,
  UnitSelectionEvent,
  WarshipSelectionBoxCancelEvent,
  WarshipSelectionBoxCompleteEvent,
  WarshipSelectionBoxUpdateEvent,
} from "../../InputHandler";
import { ProgressBar } from "../ProgressBar";
import { TransformHandler } from "../TransformHandler";
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
  private selectionAnimTime = 0;
  private allProgressBars: Map<
    number,
    { unit: UnitView; progressBar: ProgressBar }
  > = new Map();
  private allHealthBars: Map<number, ProgressBar> = new Map();
  // Keep track of currently selected unit
  private selectedUnit: UnitView | null = null;

  // Keep track of multi-selected warships (box selection)
  private multiSelectedWarships: UnitView[] = [];

  // Per-unit last selection box position for multi-select cleanup
  private multiSelectionBoxCenters: Map<
    number,
    { x: number; y: number; size: number }
  > = new Map();

  // Keep track of previous selection box position for cleanup
  private lastSelectionBoxCenter: {
    x: number;
    y: number;
    size: number;
  } | null = null;

  // Visual settings for selection
  private readonly SELECTION_BOX_SIZE = 6; // Size of the selection box (should be larger than the warship)

  // Selection box (drag rectangle) state
  private selectionBoxActive = false;
  private selectionBoxStartX = 0;
  private selectionBoxStartY = 0;
  private selectionBoxEndX = 0;
  private selectionBoxEndY = 0;
  private selectionBoxCanvas: HTMLCanvasElement =
    document.createElement("canvas");
  private selectionBoxCtx: CanvasRenderingContext2D | null = null;

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

    // Animate multi-selected warships
    for (const unit of this.multiSelectedWarships) {
      if (unit.isActive()) {
        this.drawSelectionBoxMulti(unit);
      } else {
        // Unit was destroyed — clean up its box
        const prev = this.multiSelectionBoxCenters.get(unit.id());
        if (prev) {
          this.clearSelectionBox(prev.x, prev.y, prev.size);
          this.multiSelectionBoxCenters.delete(unit.id());
        }
      }
    }
    // Remove destroyed units from the list
    this.multiSelectedWarships = this.multiSelectedWarships.filter((u) =>
      u.isActive(),
    );

    this.game
      .updatesSinceLastTick()
      ?.[GameUpdateType.Unit]?.map((unit) => this.game.unit(unit.id))
      ?.forEach((unitView) => {
        if (unitView === undefined) return;
        this.onUnitEvent(unitView);
      });
    this.updateProgressBars();
  }

  init() {
    this.eventBus.on(UnitSelectionEvent, (e) => this.onUnitSelection(e));
    this.eventBus.on(WarshipSelectionBoxUpdateEvent, (e) => {
      this.selectionBoxActive = true;
      this.selectionBoxStartX = e.startX;
      this.selectionBoxStartY = e.startY;
      this.selectionBoxEndX = e.endX;
      this.selectionBoxEndY = e.endY;
    });
    const clearBox = () => {
      this.selectionBoxActive = false;
      this.selectionBoxCtx?.clearRect(
        0,
        0,
        this.selectionBoxCanvas.width,
        this.selectionBoxCanvas.height,
      );
    };
    this.eventBus.on(WarshipSelectionBoxCompleteEvent, clearBox);
    this.eventBus.on(WarshipSelectionBoxCancelEvent, clearBox);
    this.eventBus.on(CloseViewEvent, clearBox);
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
    if (this.selectionBoxActive) {
      this.renderSelectionBox(context);
    }
  }

  private renderSelectionBox(context: CanvasRenderingContext2D) {
    if (!this.selectionBoxCtx) return;

    const topLeft = this.transformHandler.screenToWorldCoordinates(
      Math.min(this.selectionBoxStartX, this.selectionBoxEndX),
      Math.min(this.selectionBoxStartY, this.selectionBoxEndY),
    );
    const bottomRight = this.transformHandler.screenToWorldCoordinates(
      Math.max(this.selectionBoxStartX, this.selectionBoxEndX),
      Math.max(this.selectionBoxStartY, this.selectionBoxEndY),
    );

    const cx1 = Math.max(0, Math.floor(topLeft.x));
    const cy1 = Math.max(0, Math.floor(topLeft.y));
    const cx2 = Math.min(
      this.selectionBoxCanvas.width - 1,
      Math.floor(bottomRight.x),
    );
    const cy2 = Math.min(
      this.selectionBoxCanvas.height - 1,
      Math.floor(bottomRight.y),
    );

    if (cx2 <= cx1 || cy2 <= cy1) return;

    const myPlayer = this.game.myPlayer();
    const baseColor = myPlayer ? myPlayer.territoryColor().lighten(0.2) : null;
    const colorStr = baseColor
      ? baseColor.alpha(0.85).toRgbString()
      : "rgba(100,200,255,0.85)";

    this.selectionBoxCtx.clearRect(
      0,
      0,
      this.selectionBoxCanvas.width,
      this.selectionBoxCanvas.height,
    );
    this.selectionBoxCtx.fillStyle = colorStr;
    this.drawDashedLine(this.selectionBoxCtx, cx1, cy1, cx2, cy1);
    this.drawDashedLine(this.selectionBoxCtx, cx1, cy2, cx2, cy2);
    this.drawDashedLine(this.selectionBoxCtx, cx1, cy1, cx1, cy2);
    this.drawDashedLine(this.selectionBoxCtx, cx2, cy1, cx2, cy2);

    this.selectionBoxCtx.fillStyle = baseColor
      ? baseColor.alpha(0.06).toRgbString()
      : "rgba(100,200,255,0.06)";
    this.selectionBoxCtx.fillRect(
      cx1 + 1,
      cy1 + 1,
      cx2 - cx1 - 1,
      cy2 - cy1 - 1,
    );

    context.drawImage(
      this.selectionBoxCanvas,
      -this.game.width() / 2,
      -this.game.height() / 2,
      this.game.width(),
      this.game.height(),
    );
  }

  private drawDashedLine(
    ctx: CanvasRenderingContext2D,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
  ) {
    if (x1 === x2) {
      for (let y = y1; y <= y2; y++) {
        if ((x1 + y) % 2 === 0) ctx.fillRect(x1, y, 1, 1);
      }
    } else {
      for (let x = x1; x <= x2; x++) {
        if ((x + y1) % 2 === 0) ctx.fillRect(x, y1, 1, 1);
      }
    }
  }

  redraw() {
    this.canvas = document.createElement("canvas");
    this.context = this.canvas.getContext("2d");
    this.canvas.width = this.game.width();
    this.canvas.height = this.game.height();

    this.selectionBoxCanvas = document.createElement("canvas");
    this.selectionBoxCanvas.width = this.game.width();
    this.selectionBoxCanvas.height = this.game.height();
    this.selectionBoxCtx = this.selectionBoxCanvas.getContext("2d");
  }

  onUnitEvent(unit: UnitView) {
    const underConst = unit.isUnderConstruction();
    if (underConst) {
      this.createLoadingBar(unit);
      return;
    }
    switch (unit.type()) {
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
   * Handle the unit selection event (single or multi).
   * When event.units.length > 0 it's a multi-selection from box/select-all.
   * When event.unit is set it's a single warship selection.
   * When event.isSelected is false it clears all selection state.
   */
  private onUnitSelection(event: UnitSelectionEvent) {
    if (event.isSelected) {
      // Always clear single-selection outline first
      if (this.lastSelectionBoxCenter) {
        const { x, y, size } = this.lastSelectionBoxCenter;
        this.clearSelectionBox(x, y, size);
        this.lastSelectionBoxCenter = null;
      }
      // selectedUnit is always reset regardless of lastSelectionBoxCenter
      this.selectedUnit = null;
      // Always clear previous multi-selection boxes
      for (const [, center] of this.multiSelectionBoxCenters) {
        this.clearSelectionBox(center.x, center.y, center.size);
      }
      this.multiSelectionBoxCenters.clear();
      this.multiSelectedWarships = [];

      if ((event.units ?? []).length > 0) {
        // Multi-selection
        this.multiSelectedWarships = event.units;
        for (const unit of this.multiSelectedWarships) {
          if (unit.isActive()) {
            this.drawSelectionBoxMulti(unit);
          }
        }
      } else {
        // Single selection
        this.selectedUnit = event.unit;
        if (event.unit && event.unit.type() === UnitType.Warship) {
          this.drawSelectionBox(event.unit);
        }
      }
    } else {
      // Deselect everything
      if (this.lastSelectionBoxCenter) {
        const { x, y, size } = this.lastSelectionBoxCenter;
        this.clearSelectionBox(x, y, size);
        this.lastSelectionBoxCenter = null;
      }
      this.selectedUnit = null;
      for (const [, center] of this.multiSelectionBoxCenters) {
        this.clearSelectionBox(center.x, center.y, center.size);
      }
      this.multiSelectionBoxCenters.clear();
      this.multiSelectedWarships = [];
    }
  }

  /**
   * Draw selection box for a multi-selected warship, tracking position per unit id.
   */
  private drawSelectionBoxMulti(unit: UnitView) {
    if (!unit || !unit.isActive()) return;

    if (this.theme === null) throw new Error("missing theme");
    const selectionColor = unit.owner().territoryColor().lighten(0.2);
    const centerX = this.game.x(unit.tile());
    const centerY = this.game.y(unit.tile());

    const prev = this.multiSelectionBoxCenters.get(unit.id());
    if (prev && (prev.x !== centerX || prev.y !== centerY)) {
      this.clearSelectionBox(prev.x, prev.y, prev.size);
    }

    this.paintSelectionBoxAt(centerX, centerY, selectionColor);

    this.multiSelectionBoxCenters.set(unit.id(), {
      x: centerX,
      y: centerY,
      size: this.SELECTION_BOX_SIZE,
    });
  }

  /**
   * Shared helper: paint the dashed pulsing border pixels for a selection box.
   */
  private paintSelectionBoxAt(
    centerX: number,
    centerY: number,
    selectionColor: Colord,
  ) {
    const size = this.SELECTION_BOX_SIZE;
    const opacity = 200 + Math.sin(this.selectionAnimTime * 0.1) * 55;

    for (let x = centerX - size; x <= centerX + size; x++) {
      for (let y = centerY - size; y <= centerY + size; y++) {
        if (
          x === centerX - size ||
          x === centerX + size ||
          y === centerY - size ||
          y === centerY + size
        ) {
          if ((x + y) % 2 === 0) {
            this.paintCell(x, y, selectionColor, opacity);
          }
        }
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

    if (this.theme === null) throw new Error("missing theme");
    const selectionColor = unit.owner().territoryColor().lighten(0.2);
    const centerX = this.game.x(unit.tile());
    const centerY = this.game.y(unit.tile());

    // Clear previous box if unit moved
    if (
      this.lastSelectionBoxCenter &&
      (this.lastSelectionBoxCenter.x !== centerX ||
        this.lastSelectionBoxCenter.y !== centerY)
    ) {
      this.clearSelectionBox(
        this.lastSelectionBoxCenter.x,
        this.lastSelectionBoxCenter.y,
        this.lastSelectionBoxCenter.size,
      );
    }

    this.paintSelectionBoxAt(centerX, centerY, selectionColor);

    this.lastSelectionBoxCenter = {
      x: centerX,
      y: centerY,
      size: this.SELECTION_BOX_SIZE,
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
    const underConst = unit.isUnderConstruction();
    if (underConst) {
      const constDuration = this.game.unitInfo(
        unit.type(),
      ).constructionDuration;
      if (constDuration === undefined) {
        throw new Error("unit does not have constructionTime");
      }
      return (
        (this.game.ticks() - unit.createdAt()) /
        (constDuration === 0 ? 1 : constDuration)
      );
    }
    switch (unit.type()) {
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
}
