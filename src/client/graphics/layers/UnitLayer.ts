import { colord, Colord } from "colord";
import { EventBus } from "../../../core/EventBus";
import { Theme } from "../../../core/configuration/Config";
import { Cell, UnitType } from "../../../core/game/Game";
import { TileRef } from "../../../core/game/GameMap";
import { GameView, UnitView } from "../../../core/game/GameView";
import { BezenhamLine } from "../../../core/utilities/Line";
import {
  AlternateViewEvent,
  ContextMenuEvent,
  MouseUpEvent,
  TouchEvent,
  UnitSelectionEvent,
} from "../../InputHandler";
import { MoveWarshipIntentEvent } from "../../Transport";
import { TransformHandler } from "../TransformHandler";
import { Layer } from "./Layer";
import { sampleGridSegmentPlan } from "./SegmentMotionSample";
import {
  UnitMotionRenderQueue,
  UnitMotionRenderQueueEntry,
} from "./UnitMotionRenderQueue";
import { pruneInactiveTrails } from "./TrailLifecycle";

import { GameUpdateType } from "../../../core/game/GameUpdates";
import {
  getColoredSprite,
  isSpriteReady,
  loadAllSprites,
} from "../SpriteLoader";

enum Relationship {
  Self,
  Ally,
  Enemy,
}

const UNIT_DRAW_BUDGET_MS = 3;
const UNIT_DRAW_SOFT_OVERRUN_MS = 1;
const OFFSCREEN_REFRESH_EVERY_N_FRAMES = 6;
const MOVER_ONSCREEN_BOOST = 1_000_000_000;
const MOVER_AGE_WEIGHT = 1;
const MOVER_ERROR_WEIGHT = 2;
const MOVER_DEBT_WEIGHT = 8;

type TransportTrailState = {
  xy: number[];
  planId: number;
  lastX: number;
  lastY: number;
  lastOnScreen: boolean;
};

type MoverSpriteRect = {
  x: number;
  y: number;
  w: number;
  h: number;
};

type MoverRenderState = {
  planId: number;
  lastRenderedX: number;
  lastRenderedY: number;
  lastRenderedAtMs: number;
  lastErrorPx: number;
  lastSpriteRect: MoverSpriteRect | null;
  lastOnScreen: boolean;
  queueVersion: number;
  skipDebt: number;
  lastSeenFrame: number;
};

export class UnitLayer implements Layer {
  private canvas: HTMLCanvasElement;
  private context: CanvasRenderingContext2D;
  private dynamicMoverCanvas: HTMLCanvasElement;
  private dynamicMoverContext: CanvasRenderingContext2D;
  private trailCanvas: HTMLCanvasElement;
  private trailContext: CanvasRenderingContext2D;

  // Pixel trails (currently only used for nukes).
  private unitToTrail = new Map<number, TileRef[]>();

  private gridMoverUnitIds = new Set<number>();

  private transportShipTrails = new Map<number, TransportTrailState>();
  private trailDirty = false;

  private moverState = new Map<number, MoverRenderState>();
  private motionQueue = new UnitMotionRenderQueue();
  private renderFrame = 0;
  private lastPerfCounters: Record<string, number> = {
    moversSampled: 0,
    moversDrawn: 0,
    moversSkipped: 0,
    queueSize: 0,
    budgetUsedMs: 0,
    avgDebt: 0,
  };

  private theme: Theme;

  private alternateView = false;

  private oldShellTile = new Map<UnitView, TileRef>();

  private transformHandler: TransformHandler;

  // Selected unit property as suggested in the review comment
  private selectedUnit: UnitView | null = null;

  // Configuration for unit selection
  private readonly WARSHIP_SELECTION_RADIUS = 10; // Radius in game cells for warship selection hit zone

  constructor(
    private game: GameView,
    private eventBus: EventBus,
    transformHandler: TransformHandler,
  ) {
    this.theme = game.config().theme();
    this.transformHandler = transformHandler;
  }

  shouldTransform(): boolean {
    return true;
  }

  tick() {
    const trailPrune = pruneInactiveTrails(
      this.unitToTrail,
      this.transportShipTrails,
      (unitId) => {
        const current = this.game.unit(unitId);
        return !!current && current.isActive();
      },
    );
    if (trailPrune.removedNukes > 0 || trailPrune.removedTransport > 0) {
      this.trailDirty = true;
    }

    const gridMoverUnitIds = new Set<number>();
    for (const id of this.game.motionPlans().keys()) {
      gridMoverUnitIds.add(id);
    }

    const moverSetChanged = !this.setsEqual(
      gridMoverUnitIds,
      this.gridMoverUnitIds,
    );
    if (moverSetChanged) {
      this.gridMoverUnitIds = gridMoverUnitIds;
      this.pruneMoverStates(gridMoverUnitIds);
      this.redrawStaticSprites();
    }

    const updatedUnitIds =
      this.game
        .updatesSinceLastTick()
        ?.[GameUpdateType.Unit]?.map((unit) => unit.id) ?? [];

    const motionPlanUnitIds = this.game.motionPlannedUnitIds();

    const unitIds = new Set<number>();
    for (const id of updatedUnitIds) {
      if (!gridMoverUnitIds.has(id)) {
        unitIds.add(id);
      }
    }
    for (const id of motionPlanUnitIds) {
      // Train plans still rely on discrete tick updates; grid movers are rendered smoothly in renderLayer().
      if (!gridMoverUnitIds.has(id)) {
        unitIds.add(id);
      }
    }

    if (unitIds.size > 0) {
      this.updateUnitsSprites(Array.from(unitIds));
    }

  }

  init() {
    this.eventBus.on(AlternateViewEvent, (e) => this.onAlternativeViewEvent(e));
    this.eventBus.on(MouseUpEvent, (e) => this.onMouseUp(e));
    this.eventBus.on(TouchEvent, (e) => this.onTouch(e));
    this.eventBus.on(UnitSelectionEvent, (e) => this.onUnitSelectionChange(e));
    this.redraw();

    loadAllSprites();
  }

  /**
   * Find player-owned warships near the given cell within a configurable radius
   * @param clickRef The tile to check
   * @returns Array of player's warships in range, sorted by distance (closest first)
   */
  private findWarshipsNearCell(clickRef: TileRef): UnitView[] {
    // Only select warships owned by the player
    return this.game
      .units(UnitType.Warship)
      .filter(
        (unit) =>
          unit.isActive() &&
          unit.owner() === this.game.myPlayer() && // Only allow selecting own warships
          this.game.manhattanDist(unit.tile(), clickRef) <=
            this.WARSHIP_SELECTION_RADIUS,
      )
      .sort((a, b) => {
        // Sort by distance (closest first)
        const distA = this.game.manhattanDist(a.tile(), clickRef);
        const distB = this.game.manhattanDist(b.tile(), clickRef);
        return distA - distB;
      });
  }

  private onMouseUp(
    event: MouseUpEvent,
    clickRef?: TileRef,
    nearbyWarships?: UnitView[],
  ) {
    if (clickRef === undefined) {
      // Convert screen coordinates to world coordinates
      const cell = this.transformHandler.screenToWorldCoordinates(
        event.x,
        event.y,
      );
      if (!this.game.isValidCoord(cell.x, cell.y)) return;

      clickRef = this.game.ref(cell.x, cell.y);
    }
    if (!this.game.isOcean(clickRef)) return;

    if (this.selectedUnit) {
      this.eventBus.emit(
        new MoveWarshipIntentEvent(this.selectedUnit.id(), clickRef),
      );
      // Deselect
      this.eventBus.emit(new UnitSelectionEvent(this.selectedUnit, false));
      return;
    }

    // Find warships near this tile, sorted by distance
    nearbyWarships ??= this.findWarshipsNearCell(clickRef);
    if (nearbyWarships.length > 0) {
      // Toggle selection of the closest warship
      this.eventBus.emit(new UnitSelectionEvent(nearbyWarships[0], true));
    }
  }

  private onTouch(event: TouchEvent) {
    const cell = this.transformHandler.screenToWorldCoordinates(
      event.x,
      event.y,
    );

    if (!this.game.isValidCoord(cell.x, cell.y)) {
      return;
    }

    const clickRef = this.game.ref(cell.x, cell.y);
    if (!this.game.isOcean(clickRef)) {
      // No isValidCoord/Ref check yet, that is done for ContextMenuEvent later
      // No warship to find because no Ocean tile, open Radial Menu
      this.eventBus.emit(new ContextMenuEvent(event.x, event.y));
      return;
    }

    if (!this.game.isValidRef(clickRef)) {
      return;
    }

    if (this.selectedUnit) {
      // Reuse the mouse logic, send clickRef to avoid fetching it again
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
      // No warships selected or nearby, open Radial Menu
      this.eventBus.emit(new ContextMenuEvent(event.x, event.y));
    }
  }

  /**
   * Handle unit selection changes
   */
  private onUnitSelectionChange(event: UnitSelectionEvent) {
    if (event.isSelected) {
      this.selectedUnit = event.unit;
    } else if (this.selectedUnit === event.unit) {
      this.selectedUnit = null;
    }
  }

  /**
   * Handle unit deactivation or destruction
   * If the selected unit is removed from the game, deselect it
   */
  private handleUnitDeactivation(unit: UnitView) {
    if (this.selectedUnit === unit && !unit.isActive()) {
      this.eventBus.emit(new UnitSelectionEvent(unit, false));
    }
  }

  renderLayer(context: CanvasRenderingContext2D) {
    this.renderFrame++;
    const tickAlpha = this.computeTickAlpha();
    const tickFloat = this.game.ticks() + tickAlpha;
    const nowMs = performance.now();
    const activeMoverIds = new Set<number>();

    for (const [unitId, plan] of this.game.motionPlans()) {
      const unit = this.game.unit(unitId);
      if (!unit || !unit.isActive()) {
        this.clearMoverState(unitId);
        if (this.transportShipTrails.delete(unitId)) this.trailDirty = true;
        continue;
      }
      activeMoverIds.add(unitId);

      const onScreenHint = this.transformHandler.isOnScreen(
        new Cell(this.game.x(unit.tile()), this.game.y(unit.tile())),
      );
      const state = this.ensureMoverState(unitId, plan.planId, nowMs);
      state.lastSeenFrame = this.renderFrame;

      if (!onScreenHint && state.lastOnScreen && state.lastSpriteRect) {
        this.clearMoverRect(state.lastSpriteRect);
        state.lastOnScreen = false;
      }

      if (
        !onScreenHint &&
        ((this.renderFrame + unitId) % OFFSCREEN_REFRESH_EVERY_N_FRAMES !== 0) &&
        state.skipDebt < 2
      ) {
        continue;
      }

      const entry: UnitMotionRenderQueueEntry = {
        unitId,
        version: (state.queueVersion = (state.queueVersion + 1) >>> 0),
        priority: this.computeMoverPriority(state, onScreenHint, nowMs),
        onScreenHint,
      };
      this.motionQueue.enqueue(entry);
    }

    this.pruneMoverStates(activeMoverIds);

    const moverPerf = this.drawQueuedMovers(tickFloat, activeMoverIds);

    this.rebuildTrailCanvasIfDirty();

    context.drawImage(
      this.trailCanvas,
      -this.game.width() / 2,
      -this.game.height() / 2,
      this.game.width(),
      this.game.height(),
    );
    context.drawImage(
      this.canvas,
      -this.game.width() / 2,
      -this.game.height() / 2,
      this.game.width(),
      this.game.height(),
    );
    context.drawImage(
      this.dynamicMoverCanvas,
      -this.game.width() / 2,
      -this.game.height() / 2,
      this.game.width(),
      this.game.height(),
    );

    let totalDebt = 0;
    let debtCount = 0;
    for (const unitId of activeMoverIds) {
      const state = this.moverState.get(unitId);
      if (!state) continue;
      totalDebt += state.skipDebt;
      debtCount++;
    }

    this.lastPerfCounters = {
      moversSampled: moverPerf.sampled,
      moversDrawn: moverPerf.drawn,
      moversSkipped: moverPerf.skipped,
      queueSize: this.motionQueue.size(),
      budgetUsedMs: moverPerf.budgetUsedMs,
      avgDebt: debtCount > 0 ? totalDebt / debtCount : 0,
    };
  }

  private drawQueuedMovers(
    tickFloat: number,
    activeMoverIds: Set<number>,
  ): {
    sampled: number;
    drawn: number;
    skipped: number;
    budgetUsedMs: number;
  } {
    const frameStartMs = performance.now();
    const drawnIds = new Set<number>();

    let sampled = 0;
    let drawn = 0;
    let skipped = 0;

    for (;;) {
      const entry = this.motionQueue.pollValid((candidate) =>
        this.isValidQueueEntry(candidate, activeMoverIds),
      );
      if (!entry) {
        break;
      }

      const elapsedMs = performance.now() - frameStartMs;
      const canDrawWithinTarget = elapsedMs < UNIT_DRAW_BUDGET_MS;
      const canDrawOnScreenOverrun =
        entry.onScreenHint &&
        elapsedMs < UNIT_DRAW_BUDGET_MS + UNIT_DRAW_SOFT_OVERRUN_MS;
      if (!canDrawWithinTarget && !canDrawOnScreenOverrun) {
        skipped++;
        break;
      }

      const unit = this.game.unit(entry.unitId);
      const plan = this.game.motionPlans().get(entry.unitId);
      const state = this.moverState.get(entry.unitId);
      if (!unit || !unit.isActive() || !plan || !state) {
        this.clearMoverState(entry.unitId);
        skipped++;
        continue;
      }

      sampled++;
      const sampledPos = sampleGridSegmentPlan(this.game, plan, tickFloat);
      if (!sampledPos) {
        skipped++;
        continue;
      }

      const onScreen = this.transformHandler.isOnScreen(
        new Cell(Math.floor(sampledPos.x), Math.floor(sampledPos.y)),
      );

      if (!onScreen) {
        if (state.lastOnScreen && state.lastSpriteRect) {
          this.clearMoverRect(state.lastSpriteRect);
          state.lastSpriteRect = null;
          state.lastOnScreen = false;
        }
        if (unit.type() === UnitType.TransportShip) {
          this.updateTransportShipTrail(
            entry.unitId,
            plan.planId,
            sampledPos.x,
            sampledPos.y,
            false,
          );
        }
        skipped++;
        continue;
      }

      if (state.lastSpriteRect) {
        this.clearMoverRect(state.lastSpriteRect);
      }
      const rect = this.drawSpriteAt(
        unit,
        sampledPos.x,
        sampledPos.y,
        this.dynamicMoverContext,
        false,
      );
      if (!rect) {
        skipped++;
        continue;
      }

      const errorPx = Math.hypot(
        sampledPos.x - state.lastRenderedX,
        sampledPos.y - state.lastRenderedY,
      );
      state.lastErrorPx = errorPx;
      state.lastRenderedX = sampledPos.x;
      state.lastRenderedY = sampledPos.y;
      state.lastRenderedAtMs = performance.now();
      state.lastSpriteRect = rect;
      state.lastOnScreen = true;
      state.skipDebt = 0;
      drawnIds.add(entry.unitId);
      drawn++;

      if (unit.type() === UnitType.TransportShip) {
        this.updateTransportShipTrail(
          entry.unitId,
          plan.planId,
          sampledPos.x,
          sampledPos.y,
          true,
        );
      }
    }

    for (const unitId of activeMoverIds) {
      if (drawnIds.has(unitId)) {
        continue;
      }
      const state = this.moverState.get(unitId);
      if (state) {
        state.skipDebt = (state.skipDebt + 1) >>> 0;
      }
    }

    return {
      sampled,
      drawn,
      skipped,
      budgetUsedMs: performance.now() - frameStartMs,
    };
  }

  onAlternativeViewEvent(event: AlternateViewEvent) {
    this.alternateView = event.alternateView;
    this.redraw();
  }

  redraw() {
    this.canvas = document.createElement("canvas");
    const context = this.canvas.getContext("2d");
    if (context === null) throw new Error("2d context not supported");
    this.context = context;

    this.dynamicMoverCanvas = document.createElement("canvas");
    const dynamicMoverContext = this.dynamicMoverCanvas.getContext("2d");
    if (dynamicMoverContext === null)
      throw new Error("2d context not supported");
    this.dynamicMoverContext = dynamicMoverContext;

    this.trailCanvas = document.createElement("canvas");
    const trailContext = this.trailCanvas.getContext("2d");
    if (trailContext === null) throw new Error("2d context not supported");
    this.trailContext = trailContext;

    this.canvas.width = this.game.width();
    this.canvas.height = this.game.height();
    this.dynamicMoverCanvas.width = this.game.width();
    this.dynamicMoverCanvas.height = this.game.height();
    this.trailCanvas.width = this.game.width();
    this.trailCanvas.height = this.game.height();

    this.gridMoverUnitIds = new Set<number>(this.game.motionPlans().keys());
    this.moverState.clear();
    this.motionQueue.clear();
    this.trailDirty = true;

    this.redrawStaticSprites();
  }

  private setsEqual(a: Set<number>, b: Set<number>): boolean {
    if (a.size !== b.size) {
      return false;
    }
    for (const v of a) {
      if (!b.has(v)) {
        return false;
      }
    }
    return true;
  }

  private redrawStaticSprites(): void {
    this.context.clearRect(0, 0, this.game.width(), this.game.height());
    const units = this.game
      .units()
      .filter((u) => !this.gridMoverUnitIds.has(u.id()));
    this.drawUnitsCells(units);
  }

  private computeTickAlpha(): number {
    if (this.game.isCatchingUp()) {
      return 1;
    }
    const dt = Math.max(1, this.game.tickDtEmaMs());
    const alpha = (performance.now() - this.game.lastUpdateAtMs()) / dt;
    return Math.max(0, Math.min(1, alpha));
  }

  getPerfCounters(): Record<string, number> {
    return this.lastPerfCounters;
  }

  private ensureMoverState(
    unitId: number,
    planId: number,
    nowMs: number,
  ): MoverRenderState {
    const existing = this.moverState.get(unitId);
    if (!existing) {
      const state: MoverRenderState = {
        planId,
        lastRenderedX: 0,
        lastRenderedY: 0,
        lastRenderedAtMs: nowMs,
        lastErrorPx: 0,
        lastSpriteRect: null,
        lastOnScreen: false,
        queueVersion: 0,
        skipDebt: 0,
        lastSeenFrame: this.renderFrame,
      };
      this.moverState.set(unitId, state);
      return state;
    }

    if (existing.planId !== planId) {
      if (existing.lastSpriteRect) {
        this.clearMoverRect(existing.lastSpriteRect);
      }
      existing.planId = planId;
      existing.lastErrorPx = 0;
      existing.lastOnScreen = false;
      existing.lastSpriteRect = null;
      existing.skipDebt = 0;
    }

    return existing;
  }

  private computeMoverPriority(
    state: MoverRenderState,
    onScreenHint: boolean,
    nowMs: number,
  ): number {
    const ageMs = Math.max(0, nowMs - state.lastRenderedAtMs);
    return (
      (onScreenHint ? MOVER_ONSCREEN_BOOST : 0) +
      ageMs * MOVER_AGE_WEIGHT +
      state.lastErrorPx * MOVER_ERROR_WEIGHT +
      state.skipDebt * MOVER_DEBT_WEIGHT
    );
  }

  private isValidQueueEntry(
    entry: UnitMotionRenderQueueEntry,
    activeMoverIds: Set<number>,
  ): boolean {
    if (!activeMoverIds.has(entry.unitId)) {
      return false;
    }
    const state = this.moverState.get(entry.unitId);
    return state !== undefined && state.queueVersion === entry.version;
  }

  private pruneMoverStates(activeMoverIds: Set<number>): void {
    for (const [unitId, state] of this.moverState) {
      if (activeMoverIds.has(unitId)) {
        continue;
      }
      if (state.lastSpriteRect) {
        this.clearMoverRect(state.lastSpriteRect);
      }
      this.moverState.delete(unitId);
    }
  }

  private clearMoverState(unitId: number): void {
    const state = this.moverState.get(unitId);
    if (state?.lastSpriteRect) {
      this.clearMoverRect(state.lastSpriteRect);
    }
    this.moverState.delete(unitId);
  }

  private clearMoverRect(rect: MoverSpriteRect): void {
    this.dynamicMoverContext.clearRect(rect.x, rect.y, rect.w, rect.h);
  }

  private updateTransportShipTrail(
    unitId: number,
    planId: number,
    x: number,
    y: number,
    onScreen: boolean,
  ): void {
    const existing = this.transportShipTrails.get(unitId);
    if (!existing || existing.planId !== planId) {
      const xy: number[] = onScreen ? [x, y] : [];
      this.transportShipTrails.set(unitId, {
        xy,
        planId,
        lastX: x,
        lastY: y,
        lastOnScreen: onScreen,
      });
      if (onScreen) {
        this.trailDirty = true;
      }
      return;
    }

    if (onScreen && (existing.lastX !== x || existing.lastY !== y)) {
      if (!existing.lastOnScreen && existing.xy.length > 0) {
        existing.xy.push(Number.NaN, Number.NaN);
      }
      existing.xy.push(x, y);
      this.trailDirty = true;
    } else if (onScreen && existing.xy.length === 0) {
      existing.xy.push(x, y);
      this.trailDirty = true;
    }

    existing.lastX = x;
    existing.lastY = y;
    existing.lastOnScreen = onScreen;
  }

  private rebuildTrailCanvasIfDirty(): void {
    if (!this.trailDirty) {
      return;
    }
    this.trailDirty = false;

    const ctx = this.trailContext;
    ctx.clearRect(0, 0, this.game.width(), this.game.height());

    for (const [unitId, trail] of this.unitToTrail) {
      const unit = this.game.unit(unitId);
      if (!unit || !unit.isActive()) {
        continue;
      }
      const rel = this.relationship(unit);
      for (const tile of trail) {
        this.paintCell(
          this.game.x(tile),
          this.game.y(tile),
          rel,
          unit.owner().territoryColor(),
          150,
          ctx,
        );
      }
    }

    for (const [unitId, trail] of this.transportShipTrails) {
      const unit = this.game.unit(unitId);
      if (!unit || !unit.isActive()) {
        continue;
      }

      if (trail.xy.length < 4) {
        continue;
      }

      ctx.save();
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = 1.0;
      ctx.strokeStyle = this.motionTrailColor(unit);

      ctx.beginPath();
      let needMove = true;
      for (let i = 0; i < trail.xy.length; i += 2) {
        const x = trail.xy[i];
        const y = trail.xy[i + 1];
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
          needMove = true;
          continue;
        }
        if (needMove) {
          ctx.moveTo(x, y);
          needMove = false;
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
      ctx.restore();
    }
  }

  private relationshipForAlternateView(unit: UnitView): Relationship {
    let rel = this.relationship(unit);
    const dstPortId = unit.targetUnitId();
    if (unit.type() === UnitType.TradeShip && dstPortId !== undefined) {
      const target = this.game.unit(dstPortId)?.owner();
      const myPlayer = this.game.myPlayer();
      if (myPlayer !== null && target !== undefined) {
        if (myPlayer === target) {
          rel = Relationship.Self;
        } else if (myPlayer.isFriendly(target)) {
          rel = Relationship.Ally;
        }
      }
    }
    return rel;
  }

  private motionTrailColor(unit: UnitView): string {
    if (this.alternateView) {
      const rel = this.relationshipForAlternateView(unit);
      switch (rel) {
        case Relationship.Self:
          return this.theme.selfColor().alpha(0.65).toRgbString();
        case Relationship.Ally:
          return this.theme.allyColor().alpha(0.65).toRgbString();
        case Relationship.Enemy:
          return this.theme.enemyColor().alpha(0.65).toRgbString();
      }
    }
    return unit.owner().territoryColor().alpha(0.55).toRgbString();
  }

  private updateUnitsSprites(unitIds: number[]) {
    const unitsToUpdate = unitIds
      ?.map((id) => this.game.unit(id))
      .filter((unit) => unit !== undefined);

    if (unitsToUpdate) {
      // the clearing and drawing of unit sprites need to be done in 2 passes
      // otherwise the sprite of a unit can be drawn on top of another unit
      this.clearUnitsCells(unitsToUpdate);
      this.drawUnitsCells(unitsToUpdate);
    }
  }

  private clearUnitsCells(unitViews: UnitView[]) {
    unitViews
      .filter((unitView) => isSpriteReady(unitView))
      .forEach((unitView) => {
        const sprite = getColoredSprite(unitView, this.theme);
        const clearsize = sprite.width + 1;
        const lastX = this.game.x(unitView.lastTile());
        const lastY = this.game.y(unitView.lastTile());
        this.context.clearRect(
          lastX - clearsize / 2,
          lastY - clearsize / 2,
          clearsize,
          clearsize,
        );
      });
  }

  private drawUnitsCells(unitViews: UnitView[]) {
    unitViews.forEach((unitView) => this.onUnitEvent(unitView));
  }

  private relationship(unit: UnitView): Relationship {
    const myPlayer = this.game.myPlayer();
    if (myPlayer === null) {
      return Relationship.Enemy;
    }
    if (myPlayer === unit.owner()) {
      return Relationship.Self;
    }
    if (myPlayer.isFriendly(unit.owner())) {
      return Relationship.Ally;
    }
    return Relationship.Enemy;
  }

  onUnitEvent(unit: UnitView) {
    // Check if unit was deactivated
    if (!unit.isActive()) {
      this.handleUnitDeactivation(unit);
    }

    switch (unit.type()) {
      case UnitType.TransportShip:
        this.handleBoatEvent(unit);
        break;
      case UnitType.Warship:
        this.handleWarShipEvent(unit);
        break;
      case UnitType.Shell:
        this.handleShellEvent(unit);
        break;
      case UnitType.SAMMissile:
        this.handleMissileEvent(unit);
        break;
      case UnitType.TradeShip:
        this.handleTradeShipEvent(unit);
        break;
      case UnitType.Train:
        this.handleTrainEvent(unit);
        break;
      case UnitType.MIRVWarhead:
        this.handleMIRVWarhead(unit);
        break;
      case UnitType.AtomBomb:
      case UnitType.HydrogenBomb:
      case UnitType.MIRV:
        this.handleNuke(unit);
        break;
    }
  }

  private handleWarShipEvent(unit: UnitView) {
    if (unit.targetUnitId()) {
      this.drawSprite(unit, colord("rgb(200,0,0)"));
    } else {
      this.drawSprite(unit);
    }
  }

  private handleShellEvent(unit: UnitView) {
    const rel = this.relationship(unit);

    // Clear current and previous positions
    this.clearCell(this.game.x(unit.lastTile()), this.game.y(unit.lastTile()));
    const oldTile = this.oldShellTile.get(unit);
    if (oldTile !== undefined) {
      this.clearCell(this.game.x(oldTile), this.game.y(oldTile));
    }

    this.oldShellTile.set(unit, unit.lastTile());
    if (!unit.isActive()) {
      return;
    }

    // Paint current and previous positions
    this.paintCell(
      this.game.x(unit.tile()),
      this.game.y(unit.tile()),
      rel,
      unit.owner().borderColor(),
      255,
    );
    this.paintCell(
      this.game.x(unit.lastTile()),
      this.game.y(unit.lastTile()),
      rel,
      unit.owner().borderColor(),
      255,
    );
  }

  // interception missile from SAM
  private handleMissileEvent(unit: UnitView) {
    this.drawSprite(unit);
  }

  private clearTrail(unitId: number) {
    if (this.unitToTrail.delete(unitId)) {
      this.trailDirty = true;
    }
  }

  private handleNuke(unit: UnitView) {
    const unitId = unit.id();

    if (!this.unitToTrail.has(unitId)) {
      this.unitToTrail.set(unitId, []);
    }

    const trail = this.unitToTrail.get(unitId) ?? [];
    // It can move faster than 1 pixel, draw a line for the trail or else it will be dotted
    if (trail.length >= 1) {
      const cur = {
        x: this.game.x(unit.lastTile()),
        y: this.game.y(unit.lastTile()),
      };
      const prev = {
        x: this.game.x(trail[trail.length - 1]),
        y: this.game.y(trail[trail.length - 1]),
      };
      const line = new BezenhamLine(prev, cur);
      let point = line.increment();
      while (point !== true) {
        trail.push(this.game.ref(point.x, point.y));
        point = line.increment();
      }
    } else {
      trail.push(unit.lastTile());
    }

    this.trailDirty = true;
    this.drawSprite(unit);
    if (!unit.isActive()) {
      this.clearTrail(unitId);
    }
  }

  private handleMIRVWarhead(unit: UnitView) {
    const rel = this.relationship(unit);

    this.clearCell(this.game.x(unit.lastTile()), this.game.y(unit.lastTile()));

    if (unit.isActive()) {
      // Paint area
      this.paintCell(
        this.game.x(unit.tile()),
        this.game.y(unit.tile()),
        rel,
        unit.owner().borderColor(),
        255,
      );
    }
  }

  private handleTradeShipEvent(unit: UnitView) {
    this.drawSprite(unit);
  }

  private handleTrainEvent(unit: UnitView) {
    this.drawSprite(unit);
  }

  private handleBoatEvent(unit: UnitView) {
    this.drawSprite(unit);
  }

  paintCell(
    x: number,
    y: number,
    relationship: Relationship,
    color: Colord,
    alpha: number,
    context: CanvasRenderingContext2D = this.context,
  ) {
    this.clearCell(x, y, context);
    if (this.alternateView) {
      switch (relationship) {
        case Relationship.Self:
          context.fillStyle = this.theme.selfColor().toRgbString();
          break;
        case Relationship.Ally:
          context.fillStyle = this.theme.allyColor().toRgbString();
          break;
        case Relationship.Enemy:
          context.fillStyle = this.theme.enemyColor().toRgbString();
          break;
      }
    } else {
      context.fillStyle = color.alpha(alpha / 255).toRgbString();
    }
    context.fillRect(x, y, 1, 1);
  }

  clearCell(
    x: number,
    y: number,
    context: CanvasRenderingContext2D = this.context,
  ) {
    context.clearRect(x, y, 1, 1);
  }

  private drawSpriteAt(
    unit: UnitView,
    x: number,
    y: number,
    ctx: CanvasRenderingContext2D = this.context,
    roundCoords: boolean = true,
    customTerritoryColor?: Colord,
  ): MoverSpriteRect | null {
    let alternateViewColor: Colord | null = null;

    if (this.alternateView) {
      const rel = this.relationshipForAlternateView(unit);
      switch (rel) {
        case Relationship.Self:
          alternateViewColor = this.theme.selfColor();
          break;
        case Relationship.Ally:
          alternateViewColor = this.theme.allyColor();
          break;
        case Relationship.Enemy:
          alternateViewColor = this.theme.enemyColor();
          break;
      }
    }

    const sprite = getColoredSprite(
      unit,
      this.theme,
      alternateViewColor ?? customTerritoryColor,
      alternateViewColor ?? undefined,
    );

    if (!unit.isActive()) {
      return null;
    }

    const targetable = unit.targetable();
    ctx.save();
    if (!targetable) {
      ctx.globalAlpha = 0.5;
    }

    const drawX = x - sprite.width / 2;
    const drawY = y - sprite.height / 2;
    const outX = roundCoords ? Math.round(drawX) : drawX;
    const outY = roundCoords ? Math.round(drawY) : drawY;
    ctx.drawImage(
      sprite,
      outX,
      outY,
      sprite.width,
      sprite.width,
    );

    ctx.restore();

    const pad = 1;
    return {
      x: outX - pad,
      y: outY - pad,
      w: sprite.width + pad * 2,
      h: sprite.width + pad * 2,
    };
  }

  private drawSprite(unit: UnitView, customTerritoryColor?: Colord) {
    this.drawSpriteAt(
      unit,
      this.game.x(unit.tile()),
      this.game.y(unit.tile()),
      this.context,
      true,
      customTerritoryColor,
    );
  }
}
