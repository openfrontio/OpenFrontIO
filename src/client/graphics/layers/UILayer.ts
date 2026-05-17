import { Colord } from "colord";
import { Theme } from "src/core/configuration/Theme";
import { Cell } from "src/core/game/Game";
import { EventBus } from "../../../core/EventBus";
import { UnitType } from "../../../core/game/Game";
import { TileRef } from "../../../core/game/GameMap";
import { GameView, UnitView } from "../../../core/game/GameView";
import {
  CloseViewEvent,
  ContextMenuEvent,
  MouseUpEvent,
  SelectAllWarshipsEvent,
  TouchEvent,
  UnitSelectionEvent,
  WarshipSelectionBoxCancelEvent,
  WarshipSelectionBoxCompleteEvent,
  WarshipSelectionBoxUpdateEvent,
} from "../../InputHandler";
import { MoveWarshipIntentEvent } from "../../Transport";
import { TransformHandler } from "../TransformHandler";
import { Layer } from "./Layer";

const WARSHIP_SELECTION_RADIUS = 10;

/**
 * Layer responsible for drawing UI elements that overlay the game.
 * Currently: warship selection boxes + drag-rectangle selection.
 * Health/progress bars are now drawn by the WebGL BarPass.
 */
export class UILayer implements Layer {
  private canvas: HTMLCanvasElement;
  private context: CanvasRenderingContext2D | null;
  private theme: Theme | null = null;
  private selectionAnimTime = 0;
  // Keep track of currently selected unit
  private selectedUnit: UnitView | null = null;

  // Keep track of multi-selected warships (box selection)
  private multiSelectedWarships: UnitView[] = [];

  // Per-unit last selection box position for multi-select cleanup
  private multiSelectionBoxCenters: Map<
    number,
    { x: number; y: number; size: number }
  > = new Map();

  // Visual settings for selection
  private readonly SELECTION_BOX_SIZE = 6; // Size of the selection box (should be larger than the warship)

  // Drag rectangle (shift+drag warship selection box) — a screen-space DOM
  // overlay positioned via inline style. Not part of the canvas2D draw path.
  private dragRectEl: HTMLDivElement | null = null;

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
    // Update the selection animation time (only used by the multi-selection
    // boxes — the single-unit box is now drawn by the WebGL SelectionBoxPass).
    this.selectionAnimTime = (this.selectionAnimTime + 1) % 60;

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
  }

  init() {
    this.eventBus.on(UnitSelectionEvent, (e) => this.onUnitSelection(e));

    this.ensureDragRectEl();
    this.eventBus.on(WarshipSelectionBoxUpdateEvent, (e) => {
      this.updateDragRect(e.startX, e.startY, e.endX, e.endY);
    });
    const clearBox = () => this.hideDragRect();
    this.eventBus.on(WarshipSelectionBoxCompleteEvent, clearBox);
    this.eventBus.on(WarshipSelectionBoxCancelEvent, clearBox);
    this.eventBus.on(CloseViewEvent, clearBox);

    // Warship select/move click flow (previously in the deleted UnitLayer).
    this.eventBus.on(MouseUpEvent, (e) => this.onMouseUp(e));
    this.eventBus.on(TouchEvent, (e) => this.onTouch(e));
    this.eventBus.on(WarshipSelectionBoxCompleteEvent, (e) =>
      this.onSelectionBoxComplete(e),
    );
    this.eventBus.on(SelectAllWarshipsEvent, () => this.onSelectAllWarships());

    this.redraw();
  }

  /**
   * Lazily create the shift+drag rectangle overlay. Screen-space DOM element,
   * pointer-events: none so it doesn't intercept the drag itself. z-index
   * sits above the WebGL/canvas2D map canvases but below HUD modals.
   */
  private ensureDragRectEl(): void {
    if (this.dragRectEl !== null) return;
    const el = document.createElement("div");
    el.id = "warship-drag-rect";
    el.style.position = "fixed";
    el.style.pointerEvents = "none";
    el.style.display = "none";
    el.style.zIndex = "30";
    el.style.borderStyle = "dashed";
    el.style.borderWidth = "1px";
    el.style.boxSizing = "border-box";
    document.body.appendChild(el);
    this.dragRectEl = el;
  }

  private updateDragRect(
    startX: number,
    startY: number,
    endX: number,
    endY: number,
  ): void {
    const el = this.dragRectEl;
    if (el === null) return;
    const x1 = Math.min(startX, endX);
    const y1 = Math.min(startY, endY);
    const w = Math.abs(endX - startX);
    const h = Math.abs(endY - startY);

    // Color from the local player's territory tint (matches the canvas2D look).
    const myPlayer = this.game.myPlayer();
    const base = myPlayer ? myPlayer.territoryColor().lighten(0.2) : null;
    const border = base
      ? base.alpha(0.85).toRgbString()
      : "rgba(100, 200, 255, 0.85)";
    const fill = base
      ? base.alpha(0.06).toRgbString()
      : "rgba(100, 200, 255, 0.06)";

    el.style.left = `${x1}px`;
    el.style.top = `${y1}px`;
    el.style.width = `${w}px`;
    el.style.height = `${h}px`;
    el.style.borderColor = border;
    el.style.backgroundColor = fill;
    el.style.display = "block";
  }

  private hideDragRect(): void {
    if (this.dragRectEl !== null) this.dragRectEl.style.display = "none";
  }

  /**
   * Find player-owned warships near the given cell, sorted by distance.
   */
  private findWarshipsNearCell(clickRef: TileRef): UnitView[] {
    const myPlayer = this.game.myPlayer();
    if (!myPlayer) return [];
    return this.game
      .units(UnitType.Warship)
      .filter(
        (unit) =>
          unit.isActive() &&
          unit.owner() === myPlayer &&
          this.game.manhattanDist(unit.tile(), clickRef) <=
            WARSHIP_SELECTION_RADIUS,
      )
      .sort(
        (a, b) =>
          this.game.manhattanDist(a.tile(), clickRef) -
          this.game.manhattanDist(b.tile(), clickRef),
      );
  }

  /**
   * Resolve a left-click in the world:
   *  - multi-selected warships present + clicked water → move them all
   *  - single selected warship + clicked water → move it, then deselect
   *  - otherwise → if there's a nearby warship, select the closest one
   */
  private onMouseUp(
    event: MouseUpEvent,
    clickRef?: TileRef,
    nearbyWarships?: UnitView[],
  ) {
    if (clickRef === undefined) {
      const cell = this.transformHandler.screenToWorldCoordinates(
        event.x,
        event.y,
      );
      if (!this.game.isValidCoord(cell.x, cell.y)) return;
      clickRef = this.game.ref(cell.x, cell.y);
    }
    if (!this.game.isWater(clickRef)) return;

    if (this.multiSelectedWarships.length > 0) {
      const myPlayer = this.game.myPlayer();
      const activeIds = this.multiSelectedWarships
        .filter((u) => u.isActive() && u.owner() === myPlayer)
        .map((u) => u.id());

      if (activeIds.length > 0) {
        this.eventBus.emit(new MoveWarshipIntentEvent(activeIds, clickRef));
      }
      this.eventBus.emit(new UnitSelectionEvent(null, false));
      return;
    }

    if (this.selectedUnit) {
      this.eventBus.emit(
        new MoveWarshipIntentEvent([this.selectedUnit.id()], clickRef),
      );
      this.eventBus.emit(new UnitSelectionEvent(this.selectedUnit, false));
      return;
    }

    nearbyWarships ??= this.findWarshipsNearCell(clickRef);
    if (nearbyWarships.length > 0) {
      this.eventBus.emit(new UnitSelectionEvent(nearbyWarships[0], true));
    }
  }

  /**
   * Touch handler mirroring mouse-up. On dry land with no selection, falls
   * back to opening the radial menu.
   */
  private onTouch(event: TouchEvent) {
    const cell = this.transformHandler.screenToWorldCoordinates(
      event.x,
      event.y,
    );
    if (!this.game.isValidCoord(cell.x, cell.y)) return;

    const clickRef = this.game.ref(cell.x, cell.y);
    if (this.game.inSpawnPhase()) {
      if (!this.game.isWater(clickRef)) {
        this.eventBus.emit(new MouseUpEvent(event.x, event.y));
      }
      return;
    }
    if (!this.game.isWater(clickRef)) {
      this.eventBus.emit(new ContextMenuEvent(event.x, event.y));
      return;
    }
    if (this.selectedUnit || this.multiSelectedWarships.length > 0) {
      this.onMouseUp(new MouseUpEvent(event.x, event.y), clickRef);
      return;
    }
    const nearbyWarships = this.findWarshipsNearCell(clickRef);
    if (nearbyWarships.length > 0) {
      this.onMouseUp(
        new MouseUpEvent(event.x, event.y),
        clickRef,
        nearbyWarships,
      );
    } else {
      this.eventBus.emit(new ContextMenuEvent(event.x, event.y));
    }
  }

  /**
   * Resolve a shift+drag selection box: gather all player-owned warships
   * whose screen position falls inside the rectangle.
   */
  private onSelectionBoxComplete(event: WarshipSelectionBoxCompleteEvent) {
    const x1 = Math.min(event.startX, event.endX);
    const y1 = Math.min(event.startY, event.endY);
    const x2 = Math.max(event.startX, event.endX);
    const y2 = Math.max(event.startY, event.endY);

    const myPlayer = this.game.myPlayer();
    if (!myPlayer) return;

    const selected = this.game.units(UnitType.Warship).filter((unit) => {
      if (!unit.isActive() || unit.owner() !== myPlayer) return false;
      const screen = this.transformHandler.worldToScreenCoordinates(
        new Cell(this.game.x(unit.tile()), this.game.y(unit.tile())),
      );
      return (
        screen.x >= x1 && screen.x <= x2 && screen.y >= y1 && screen.y <= y2
      );
    });

    // Clear single selection if we got a box selection
    if (selected.length > 0 && this.selectedUnit) {
      this.eventBus.emit(new UnitSelectionEvent(this.selectedUnit, false));
    }
    this.eventBus.emit(new UnitSelectionEvent(null, true, selected));
  }

  private onSelectAllWarships() {
    const myPlayer = this.game.myPlayer();
    if (!myPlayer) return;

    const allWarships = this.game
      .units(UnitType.Warship)
      .filter((u) => u.isActive() && u.owner() === myPlayer);
    if (allWarships.length === 0) return;

    if (this.selectedUnit) {
      this.eventBus.emit(new UnitSelectionEvent(this.selectedUnit, false));
    }
    this.eventBus.emit(new UnitSelectionEvent(null, true, allWarships));
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
   * Handle the unit selection event (single or multi).
   * When event.units.length > 0 it's a multi-selection from box/select-all.
   * When event.unit is set it's a single warship selection.
   * When event.isSelected is false it clears all selection state.
   */
  private onUnitSelection(event: UnitSelectionEvent) {
    // Clear previous multi-selection boxes (the single-unit box is now drawn
    // by the WebGL SelectionBoxPass — see ClientGameRunner.mountWebGLDebugRenderer
    // which forwards this event to view.setSelectedUnit).
    for (const [, center] of this.multiSelectionBoxCenters) {
      this.clearSelectionBox(center.x, center.y, center.size);
    }
    this.multiSelectionBoxCenters.clear();
    this.multiSelectedWarships = [];
    this.selectedUnit = null;

    if (!event.isSelected) return;

    if ((event.units ?? []).length > 0) {
      // Multi-selection — canvas2D draws the per-unit outlines.
      this.multiSelectedWarships = event.units;
      for (const unit of this.multiSelectedWarships) {
        if (unit.isActive()) {
          this.drawSelectionBoxMulti(unit);
        }
      }
    } else {
      // Single selection — state only; WebGL draws the box.
      this.selectedUnit = event.unit;
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
