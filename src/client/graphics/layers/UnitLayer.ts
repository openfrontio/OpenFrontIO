import { colord, Colord } from "colord";
import { EventBus } from "../../../core/EventBus";
import { Theme } from "../../../core/configuration/Config";
import { UnitType } from "../../../core/game/Game";
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

const UNIT_DRAW_BUDGET_MS = 2;
const UNIT_DRAW_SOFT_OVERRUN_MS = 1;
const OFFSCREEN_REFRESH_EVERY_N_FRAMES = 60;
const ONSCREEN_HYSTERESIS_FRAMES = 2;
const OFFSCREEN_VERIFY_MAX_PER_FRAME = 12;
const VIEW_PADDING_PX = 12;
const MOVER_SPATIAL_HASH_CELL_PX = 24;
const DYNAMIC_MOVER_CANVAS_SCALE = 5;
const DYNAMIC_MOVER_SUBPIXEL_SNAP = false;
const SMALL_SHIP_MASK_SIZE = 5;
const TRANSPORT_SHIP_MASK = [
  "..B..",
  ".BTB.",
  "BTTTB",
  ".BTB.",
  "..B..",
] as const;
const TRADE_SHIP_MASK = [
  "..T..",
  ".TBT.",
  "TBBBT",
  ".TBT.",
  "..T..",
] as const;

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

type MoverRenderSample = {
  unitId: number;
  unit: UnitView;
  planId: number;
  x: number;
  y: number;
  renderX: number;
  renderY: number;
  rect: MoverSpriteRect;
};

type MoverSpatialIndex = {
  cells: Map<string, Set<number>>;
  unitToCells: Map<number, string[]>;
};

type MoverRenderState = {
  planId: number;
  lastSpriteRect: MoverSpriteRect | null;
  lastOnScreen: boolean;
  bucket: "on" | "off";
  bucketIndex: number;
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
  private onScreenMoverIds: number[] = [];
  private offScreenMoverIds: number[] = [];
  private onScreenCursor = 0;
  private offScreenCursor = 0;
  private renderFrame = 0;
  private lastPerfCounters: Record<string, number> = {
    moversTrackedTotal: 0,
    moversSampled: 0,
    moversDrawn: 0,
    moversSkipped: 0,
    drawTimeMs: 0,
    budgetTargetMs: UNIT_DRAW_BUDGET_MS,
    budgetSoftOverrunMs: UNIT_DRAW_SOFT_OVERRUN_MS,
    avgOnScreenDebt: 0,
    maxOnScreenDebt: 0,
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
    const viewBounds = this.currentViewBounds();
    const activeMoverIds = new Set<number>();

    for (const [unitId, plan] of this.game.motionPlans()) {
      const unit = this.game.unit(unitId);
      if (!unit || !unit.isActive()) {
        this.clearMoverState(unitId);
        if (this.transportShipTrails.delete(unitId)) this.trailDirty = true;
        continue;
      }
      activeMoverIds.add(unitId);

      const state = this.ensureMoverState(unitId, plan.planId);
      const maybeOnScreen = this.isPotentiallyOnScreen(
        plan,
        state,
        tickFloat,
        viewBounds,
      );
      this.moveMoverToBucket(unitId, state, maybeOnScreen ? "on" : "off");

      if (
        !maybeOnScreen &&
        state.lastOnScreen &&
        state.lastSpriteRect &&
        this.renderFrame - state.lastSeenFrame > ONSCREEN_HYSTERESIS_FRAMES
      ) {
        this.clearMoverRect(state.lastSpriteRect);
        state.lastSpriteRect = null;
        state.lastOnScreen = false;
      }
    }

    this.pruneMoverStates(activeMoverIds);

    const moverPerf = this.drawBucketedMovers(
      tickFloat,
      activeMoverIds,
      viewBounds,
    );

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
    context.save();
    context.imageSmoothingEnabled = true;
    context.drawImage(
      this.dynamicMoverCanvas,
      -this.game.width() / 2,
      -this.game.height() / 2,
      this.game.width(),
      this.game.height(),
    );
    context.restore();

    let totalOnScreenDebt = 0;
    let onScreenDebtCount = 0;
    let maxOnScreenDebt = 0;
    for (const unitId of this.onScreenMoverIds) {
      const state = this.moverState.get(unitId);
      if (!state) continue;
      totalOnScreenDebt += state.skipDebt;
      onScreenDebtCount++;
      if (state.skipDebt > maxOnScreenDebt) {
        maxOnScreenDebt = state.skipDebt;
      }
    }

    this.lastPerfCounters = {
      moversTrackedTotal:
        this.onScreenMoverIds.length + this.offScreenMoverIds.length,
      moversSampled: moverPerf.sampled,
      moversDrawn: moverPerf.drawn,
      moversSkipped: moverPerf.skipped,
      drawTimeMs: moverPerf.budgetUsedMs,
      budgetTargetMs: UNIT_DRAW_BUDGET_MS,
      budgetSoftOverrunMs: UNIT_DRAW_SOFT_OVERRUN_MS,
      avgOnScreenDebt:
        onScreenDebtCount > 0 ? totalOnScreenDebt / onScreenDebtCount : 0,
      maxOnScreenDebt,
    };
  }

  private drawBucketedMovers(
    tickFloat: number,
    activeMoverIds: Set<number>,
    viewBounds: { left: number; top: number; right: number; bottom: number },
  ): {
    sampled: number;
    drawn: number;
    skipped: number;
    budgetUsedMs: number;
  } {
    const frameStartMs = performance.now();
    const drawnIds = new Set<number>();
    const sampledCache = new Map<number, MoverRenderSample | null>();
    const spatial = this.buildMoverSpatialHash();

    let sampled = 0;
    let drawn = 0;
    let skipped = 0;

    const onScreenPass = this.drawBucketPass(
      "on",
      tickFloat,
      activeMoverIds,
      drawnIds,
      frameStartMs,
      viewBounds,
      Number.MAX_SAFE_INTEGER,
      sampledCache,
      spatial,
    );
    sampled += onScreenPass.sampled;
    drawn += onScreenPass.drawn;
    skipped += onScreenPass.skipped;

    const budgetExceeded = !onScreenPass.budgetRemaining;
    const shouldVerifyOffscreen =
      !budgetExceeded &&
      this.offScreenMoverIds.length > 0 &&
      this.renderFrame % OFFSCREEN_REFRESH_EVERY_N_FRAMES === 0;

    if (shouldVerifyOffscreen) {
      const offscreenPass = this.drawBucketPass(
        "off",
        tickFloat,
        activeMoverIds,
        drawnIds,
        frameStartMs,
        viewBounds,
        OFFSCREEN_VERIFY_MAX_PER_FRAME,
        sampledCache,
        spatial,
      );
      sampled += offscreenPass.sampled;
      drawn += offscreenPass.drawn;
      skipped += offscreenPass.skipped;
    }

    for (const unitId of activeMoverIds) {
      if (drawnIds.has(unitId)) {
        continue;
      }
      const state = this.moverState.get(unitId);
      if (state && state.bucket === "on") {
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

  private drawBucketPass(
    bucket: "on" | "off",
    tickFloat: number,
    activeMoverIds: Set<number>,
    drawnIds: Set<number>,
    frameStartMs: number,
    viewBounds: { left: number; top: number; right: number; bottom: number },
    maxItems: number,
    sampledCache: Map<number, MoverRenderSample | null>,
    spatial: MoverSpatialIndex,
  ): {
    sampled: number;
    drawn: number;
    skipped: number;
    budgetRemaining: boolean;
  } {
    const bucketIds =
      bucket === "on" ? this.onScreenMoverIds : this.offScreenMoverIds;
    if (bucketIds.length === 0 || maxItems <= 0) {
      return { sampled: 0, drawn: 0, skipped: 0, budgetRemaining: true };
    }

    const startCursor =
      bucket === "on" ? this.onScreenCursor : this.offScreenCursor;
    const cap = Math.min(bucketIds.length, maxItems);

    let sampled = 0;
    let drawn = 0;
    let skipped = 0;
    let budgetRemaining = true;
    const processed = new Set<number>();
    let scanned = 0;

    for (let offset = 0; offset < cap; offset++) {
      if (bucketIds.length === 0) {
        break;
      }
      scanned++;
      const idx = (startCursor + offset) % bucketIds.length;
      const unitId = bucketIds[idx];
      if (processed.has(unitId)) {
        continue;
      }

      const elapsedMs = performance.now() - frameStartMs;
      const canDrawWithinTarget = elapsedMs < UNIT_DRAW_BUDGET_MS;
      const canDrawOnScreenOverrun =
        bucket === "on" &&
        elapsedMs < UNIT_DRAW_BUDGET_MS + UNIT_DRAW_SOFT_OVERRUN_MS;
      if (!canDrawWithinTarget && !canDrawOnScreenOverrun) {
        budgetRemaining = false;
        skipped++;
        break;
      }

      if (!activeMoverIds.has(unitId)) {
        continue;
      }

      const unit = this.game.unit(unitId);
      const plan = this.game.motionPlans().get(unitId);
      const state = this.moverState.get(unitId);
      if (!unit || !unit.isActive() || !plan || !state) {
        this.clearMoverState(unitId);
        skipped++;
        continue;
      }

      const sampledCurrent = this.getMoverSample(
        unitId,
        unit,
        plan.planId,
        tickFloat,
        sampledCache,
      );
      sampled++;
      if (!sampledCurrent) {
        skipped++;
        continue;
      }

      const onScreen = this.pointInView(
        sampledCurrent.x,
        sampledCurrent.y,
        viewBounds,
        VIEW_PADDING_PX,
      );

      if (!onScreen) {
        if (state.lastOnScreen && state.lastSpriteRect) {
          this.spatialRemove(spatial, unitId, state.lastSpriteRect);
          this.clearMoverRect(state.lastSpriteRect);
          state.lastSpriteRect = null;
          state.lastOnScreen = false;
        }
        this.moveMoverToBucket(unitId, state, "off");
        if (unit.type() === UnitType.TransportShip) {
          this.updateTransportShipTrail(
            unitId,
            plan.planId,
            sampledCurrent.x,
            sampledCurrent.y,
            false,
          );
        }
        skipped++;
        processed.add(unitId);
        continue;
      }

      this.moveMoverToBucket(unitId, state, "on");
      let trailHandledInGroup = false;
      const conflictIds = this.detectMoverConflicts(
        unitId,
        state.lastSpriteRect,
        sampledCurrent.rect,
        spatial,
      );
      if (conflictIds.size > 1) {
        const groupResult = this.redrawConflictGroup(
          conflictIds,
          tickFloat,
          viewBounds,
          sampledCache,
          spatial,
          drawnIds,
          processed,
        );
        sampled += Math.max(0, groupResult.sampled - 1);
        drawn += groupResult.drawn;
        skipped += groupResult.skipped;
        trailHandledInGroup = true;
      } else {
        if (state.lastSpriteRect) {
          this.spatialRemove(spatial, unitId, state.lastSpriteRect);
          this.clearMoverRect(state.lastSpriteRect);
        }

        const rect = this.drawSpriteAt(
          unit,
          sampledCurrent.renderX,
          sampledCurrent.renderY,
          this.dynamicMoverContext,
          false,
        );
        if (!rect) {
          skipped++;
          processed.add(unitId);
          continue;
        }

        state.lastSpriteRect = rect;
        state.lastOnScreen = true;
        state.lastSeenFrame = this.renderFrame;
        state.skipDebt = 0;
        drawnIds.add(unitId);
        drawn++;
        processed.add(unitId);
        this.spatialAdd(spatial, unitId, rect);
      }

      if (!trailHandledInGroup && unit.type() === UnitType.TransportShip) {
        this.updateTransportShipTrail(
          unitId,
          plan.planId,
          sampledCurrent.x,
          sampledCurrent.y,
          true,
        );
      }
    }

    if (bucket === "on") {
      this.onScreenCursor =
        bucketIds.length > 0
          ? (startCursor + Math.max(1, scanned)) % bucketIds.length
          : 0;
    } else {
      this.offScreenCursor =
        bucketIds.length > 0
          ? (startCursor + Math.max(1, scanned)) % bucketIds.length
          : 0;
    }

    return { sampled, drawn, skipped, budgetRemaining };
  }

  private buildMoverSpatialHash(): MoverSpatialIndex {
    const spatial: MoverSpatialIndex = {
      cells: new Map<string, Set<number>>(),
      unitToCells: new Map<number, string[]>(),
    };

    for (const [unitId, state] of this.moverState) {
      if (!state.lastSpriteRect) {
        continue;
      }
      this.spatialAdd(spatial, unitId, state.lastSpriteRect);
    }

    return spatial;
  }

  private getMoverSample(
    unitId: number,
    unit: UnitView,
    planId: number,
    tickFloat: number,
    sampledCache: Map<number, MoverRenderSample | null>,
  ): MoverRenderSample | null {
    if (sampledCache.has(unitId)) {
      return sampledCache.get(unitId) ?? null;
    }

    const plan = this.game.motionPlans().get(unitId);
    if (!plan || plan.planId !== planId) {
      sampledCache.set(unitId, null);
      return null;
    }

    const sampled = sampleGridSegmentPlan(this.game, plan, tickFloat);
    if (!sampled) {
      sampledCache.set(unitId, null);
      return null;
    }

    const renderX = this.snapDynamicMoverCoord(sampled.x);
    const renderY = this.snapDynamicMoverCoord(sampled.y);
    const rect = this.computeSpriteRect(unit, renderX, renderY, false);
    const result: MoverRenderSample = {
      unitId,
      unit,
      planId,
      x: sampled.x,
      y: sampled.y,
      renderX,
      renderY,
      rect,
    };
    sampledCache.set(unitId, result);
    return result;
  }

  private detectMoverConflicts(
    unitId: number,
    oldRect: MoverSpriteRect | null,
    newRect: MoverSpriteRect,
    spatial: MoverSpatialIndex,
  ): Set<number> {
    const conflictIds = new Set<number>();
    conflictIds.add(unitId);

    const candidateIds = new Set<number>();
    this.collectSpatialCandidates(candidateIds, spatial, newRect);
    if (oldRect) {
      this.collectSpatialCandidates(candidateIds, spatial, oldRect);
    }

    for (const candidateId of candidateIds) {
      if (candidateId === unitId) {
        continue;
      }
      const candidateState = this.moverState.get(candidateId);
      const candidateRect = candidateState?.lastSpriteRect;
      if (!candidateRect) {
        continue;
      }
      if (
        this.rectsOverlap(candidateRect, newRect) ||
        (oldRect !== null && this.rectsOverlap(candidateRect, oldRect))
      ) {
        conflictIds.add(candidateId);
      }
    }

    return conflictIds;
  }

  private redrawConflictGroup(
    conflictIds: Set<number>,
    tickFloat: number,
    viewBounds: { left: number; top: number; right: number; bottom: number },
    sampledCache: Map<number, MoverRenderSample | null>,
    spatial: MoverSpatialIndex,
    drawnIds: Set<number>,
    processed: Set<number>,
  ): { sampled: number; drawn: number; skipped: number } {
    const sampledGroup: MoverRenderSample[] = [];
    let sampled = 0;
    let skipped = 0;

    for (const id of conflictIds) {
      const unit = this.game.unit(id);
      const plan = this.game.motionPlans().get(id);
      const state = this.moverState.get(id);
      if (!unit || !unit.isActive() || !plan || !state) {
        this.clearMoverState(id);
        processed.add(id);
        skipped++;
        continue;
      }

      const current = this.getMoverSample(
        id,
        unit,
        plan.planId,
        tickFloat,
        sampledCache,
      );
      sampled++;
      if (!current) {
        processed.add(id);
        skipped++;
        continue;
      }

      const onScreen = this.pointInView(
        current.x,
        current.y,
        viewBounds,
        VIEW_PADDING_PX,
      );
      if (!onScreen) {
        if (state.lastOnScreen && state.lastSpriteRect) {
          this.spatialRemove(spatial, id, state.lastSpriteRect);
          this.clearMoverRect(state.lastSpriteRect);
          state.lastSpriteRect = null;
          state.lastOnScreen = false;
        }
        this.moveMoverToBucket(id, state, "off");
        if (unit.type() === UnitType.TransportShip) {
          this.updateTransportShipTrail(
            id,
            plan.planId,
            current.x,
            current.y,
            false,
          );
        }
        processed.add(id);
        skipped++;
        continue;
      }

      this.moveMoverToBucket(id, state, "on");
      sampledGroup.push(current);
    }

    if (sampledGroup.length === 0) {
      return { sampled, drawn: 0, skipped };
    }

    sampledGroup.sort((a, b) => a.unitId - b.unitId);

    let clearUnion: MoverSpriteRect | null = null;
    for (const sampledCurrent of sampledGroup) {
      const state = this.moverState.get(sampledCurrent.unitId);
      if (!state) {
        continue;
      }
      const oldRect = state.lastSpriteRect;
      if (oldRect) {
        this.spatialRemove(spatial, sampledCurrent.unitId, oldRect);
        clearUnion = this.unionRects(clearUnion, oldRect);
      }
      clearUnion = this.unionRects(clearUnion, sampledCurrent.rect);
    }

    if (clearUnion) {
      this.clearMoverRect(clearUnion);
    }

    let drawn = 0;
    for (const sampledCurrent of sampledGroup) {
      const state = this.moverState.get(sampledCurrent.unitId);
      const plan = this.game.motionPlans().get(sampledCurrent.unitId);
      if (!state || !plan) {
        skipped++;
        continue;
      }

      const rect = this.drawSpriteAt(
        sampledCurrent.unit,
        sampledCurrent.renderX,
        sampledCurrent.renderY,
        this.dynamicMoverContext,
        false,
      );
      if (!rect) {
        skipped++;
        processed.add(sampledCurrent.unitId);
        continue;
      }

      state.lastSpriteRect = rect;
      state.lastOnScreen = true;
      state.lastSeenFrame = this.renderFrame;
      state.skipDebt = 0;
      this.spatialAdd(spatial, sampledCurrent.unitId, rect);

      if (sampledCurrent.unit.type() === UnitType.TransportShip) {
        this.updateTransportShipTrail(
          sampledCurrent.unitId,
          plan.planId,
          sampledCurrent.x,
          sampledCurrent.y,
          true,
        );
      }

      drawnIds.add(sampledCurrent.unitId);
      processed.add(sampledCurrent.unitId);
      drawn++;
    }

    return { sampled, drawn, skipped };
  }

  private snapDynamicMoverCoord(value: number): number {
    if (!DYNAMIC_MOVER_SUBPIXEL_SNAP || DYNAMIC_MOVER_CANVAS_SCALE <= 0) {
      return value;
    }
    return (
      Math.round(value * DYNAMIC_MOVER_CANVAS_SCALE) /
      DYNAMIC_MOVER_CANVAS_SCALE
    );
  }

  private spatialAdd(
    spatial: MoverSpatialIndex,
    unitId: number,
    rect: MoverSpriteRect,
  ): void {
    const keys = this.rectSpatialKeys(rect);
    if (keys.length === 0) {
      spatial.unitToCells.delete(unitId);
      return;
    }

    spatial.unitToCells.set(unitId, keys);
    for (const key of keys) {
      let cell = spatial.cells.get(key);
      if (!cell) {
        cell = new Set<number>();
        spatial.cells.set(key, cell);
      }
      cell.add(unitId);
    }
  }

  private spatialRemove(
    spatial: MoverSpatialIndex,
    unitId: number,
    rect?: MoverSpriteRect | null,
  ): void {
    let keys = spatial.unitToCells.get(unitId);
    if (!keys && rect) {
      keys = this.rectSpatialKeys(rect);
    }
    if (!keys) {
      return;
    }

    for (const key of keys) {
      const cell = spatial.cells.get(key);
      if (!cell) {
        continue;
      }
      cell.delete(unitId);
      if (cell.size === 0) {
        spatial.cells.delete(key);
      }
    }
    spatial.unitToCells.delete(unitId);
  }

  private collectSpatialCandidates(
    candidateIds: Set<number>,
    spatial: MoverSpatialIndex,
    rect: MoverSpriteRect,
  ): void {
    const keys = this.rectSpatialKeys(rect);
    for (const key of keys) {
      const cell = spatial.cells.get(key);
      if (!cell) {
        continue;
      }
      for (const id of cell) {
        candidateIds.add(id);
      }
    }
  }

  private rectSpatialKeys(rect: MoverSpriteRect): string[] {
    const minCellX = Math.floor(rect.x / MOVER_SPATIAL_HASH_CELL_PX);
    const maxCellX = Math.floor(
      (rect.x + Math.max(1, rect.w) - 1) / MOVER_SPATIAL_HASH_CELL_PX,
    );
    const minCellY = Math.floor(rect.y / MOVER_SPATIAL_HASH_CELL_PX);
    const maxCellY = Math.floor(
      (rect.y + Math.max(1, rect.h) - 1) / MOVER_SPATIAL_HASH_CELL_PX,
    );

    const keys: string[] = [];
    for (let cx = minCellX; cx <= maxCellX; cx++) {
      for (let cy = minCellY; cy <= maxCellY; cy++) {
        keys.push(`${cx},${cy}`);
      }
    }
    return keys;
  }

  private rectsOverlap(a: MoverSpriteRect, b: MoverSpriteRect): boolean {
    return (
      a.x < b.x + b.w &&
      a.x + a.w > b.x &&
      a.y < b.y + b.h &&
      a.y + a.h > b.y
    );
  }

  private unionRects(
    a: MoverSpriteRect | null,
    b: MoverSpriteRect,
  ): MoverSpriteRect {
    if (a === null) {
      return { ...b };
    }
    const x1 = Math.min(a.x, b.x);
    const y1 = Math.min(a.y, b.y);
    const x2 = Math.max(a.x + a.w, b.x + b.w);
    const y2 = Math.max(a.y + a.h, b.y + b.h);
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
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
    this.dynamicMoverContext.imageSmoothingEnabled = false;

    this.trailCanvas = document.createElement("canvas");
    const trailContext = this.trailCanvas.getContext("2d");
    if (trailContext === null) throw new Error("2d context not supported");
    this.trailContext = trailContext;

    this.canvas.width = this.game.width();
    this.canvas.height = this.game.height();
    this.dynamicMoverCanvas.width = this.game.width() * DYNAMIC_MOVER_CANVAS_SCALE;
    this.dynamicMoverCanvas.height =
      this.game.height() * DYNAMIC_MOVER_CANVAS_SCALE;
    this.dynamicMoverContext.setTransform(
      DYNAMIC_MOVER_CANVAS_SCALE,
      0,
      0,
      DYNAMIC_MOVER_CANVAS_SCALE,
      0,
      0,
    );
    this.trailCanvas.width = this.game.width();
    this.trailCanvas.height = this.game.height();

    this.gridMoverUnitIds = new Set<number>(this.game.motionPlans().keys());
    this.moverState.clear();
    this.onScreenMoverIds = [];
    this.offScreenMoverIds = [];
    this.onScreenCursor = 0;
    this.offScreenCursor = 0;
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

  private currentViewBounds(): {
    left: number;
    top: number;
    right: number;
    bottom: number;
  } {
    const [topLeft, bottomRight] = this.transformHandler.screenBoundingRect();
    return {
      left: topLeft.x,
      top: topLeft.y,
      right: bottomRight.x,
      bottom: bottomRight.y,
    };
  }

  private pointInView(
    x: number,
    y: number,
    viewBounds: { left: number; top: number; right: number; bottom: number },
    pad: number = 0,
  ): boolean {
    return (
      x >= viewBounds.left - pad &&
      x <= viewBounds.right + pad &&
      y >= viewBounds.top - pad &&
      y <= viewBounds.bottom + pad
    );
  }

  private isPotentiallyOnScreen(
    plan: {
      startTick: number;
      ticksPerStep: number;
      points: Uint32Array;
      segmentSteps: Uint32Array;
      segCumSteps: Uint32Array;
    },
    state: MoverRenderState,
    tickFloat: number,
    viewBounds: { left: number; top: number; right: number; bottom: number },
  ): boolean {
    if (
      state.lastOnScreen &&
      this.renderFrame - state.lastSeenFrame <= ONSCREEN_HYSTERESIS_FRAMES
    ) {
      return true;
    }

    const segment = this.currentSegmentEndpoints(plan, tickFloat);
    if (!segment) {
      return false;
    }

    if (
      this.pointInView(segment.x0, segment.y0, viewBounds, VIEW_PADDING_PX) ||
      this.pointInView(segment.x1, segment.y1, viewBounds, VIEW_PADDING_PX)
    ) {
      return true;
    }

    const segLeft = Math.min(segment.x0, segment.x1) - VIEW_PADDING_PX;
    const segRight = Math.max(segment.x0, segment.x1) + VIEW_PADDING_PX;
    const segTop = Math.min(segment.y0, segment.y1) - VIEW_PADDING_PX;
    const segBottom = Math.max(segment.y0, segment.y1) + VIEW_PADDING_PX;

    return !(
      segRight < viewBounds.left ||
      segLeft > viewBounds.right ||
      segBottom < viewBounds.top ||
      segTop > viewBounds.bottom
    );
  }

  private currentSegmentEndpoints(
    plan: {
      startTick: number;
      ticksPerStep: number;
      points: Uint32Array;
      segmentSteps: Uint32Array;
      segCumSteps: Uint32Array;
    },
    tickFloat: number,
  ): { x0: number; y0: number; x1: number; y1: number } | null {
    const points = plan.points;
    if (points.length === 0) {
      return null;
    }
    if (points.length === 1 || plan.segmentSteps.length === 0) {
      const tile = points[0] as TileRef;
      const x = this.game.x(tile);
      const y = this.game.y(tile);
      return { x0: x, y0: y, x1: x, y1: y };
    }

    const segCum = plan.segCumSteps;
    const totalSteps = segCum[segCum.length - 1] >>> 0;
    if (totalSteps === 0) {
      const tile = points[points.length - 1] as TileRef;
      const x = this.game.x(tile);
      const y = this.game.y(tile);
      return { x0: x, y0: y, x1: x, y1: y };
    }

    const ticksPerStep = Math.max(1, plan.ticksPerStep);
    const stepFloat = (tickFloat - plan.startTick) / ticksPerStep;
    let seg = 0;
    if (stepFloat >= totalSteps) {
      seg = Math.max(0, plan.segmentSteps.length - 1);
    } else if (stepFloat > 0) {
      let lo = 0;
      let hi = plan.segmentSteps.length - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >>> 1;
        const start = segCum[mid] >>> 0;
        const end = segCum[mid + 1] >>> 0;
        if (stepFloat < start) {
          hi = mid - 1;
        } else if (stepFloat >= end) {
          lo = mid + 1;
        } else {
          seg = mid;
          break;
        }
      }
    }

    const p0 = points[seg] as TileRef;
    const p1 = points[Math.min(points.length - 1, seg + 1)] as TileRef;
    return {
      x0: this.game.x(p0),
      y0: this.game.y(p0),
      x1: this.game.x(p1),
      y1: this.game.y(p1),
    };
  }

  private ensureMoverState(unitId: number, planId: number): MoverRenderState {
    const existing = this.moverState.get(unitId);
    if (!existing) {
      const state: MoverRenderState = {
        planId,
        lastSpriteRect: null,
        lastOnScreen: false,
        bucket: "off",
        bucketIndex: -1,
        skipDebt: 0,
        lastSeenFrame: -1,
      };
      this.moverState.set(unitId, state);
      this.moveMoverToBucket(unitId, state, "off");
      return state;
    }

    if (existing.planId !== planId) {
      if (existing.lastSpriteRect) {
        this.clearMoverRect(existing.lastSpriteRect);
      }
      existing.planId = planId;
      existing.lastOnScreen = false;
      existing.lastSpriteRect = null;
      existing.skipDebt = 0;
      existing.lastSeenFrame = -1;
      this.moveMoverToBucket(unitId, existing, "off");
    }

    return existing;
  }

  private pruneMoverStates(activeMoverIds: Set<number>): void {
    for (const [unitId, state] of this.moverState) {
      if (activeMoverIds.has(unitId)) {
        continue;
      }
      if (state.lastSpriteRect) {
        this.clearMoverRect(state.lastSpriteRect);
      }
      this.removeFromBucket(unitId, state);
      this.moverState.delete(unitId);
    }
  }

  private clearMoverState(unitId: number): void {
    const state = this.moverState.get(unitId);
    if (state?.lastSpriteRect) {
      this.clearMoverRect(state.lastSpriteRect);
    }
    if (state) {
      this.removeFromBucket(unitId, state);
    }
    this.moverState.delete(unitId);
  }

  private moveMoverToBucket(
    unitId: number,
    state: MoverRenderState,
    target: "on" | "off",
  ): void {
    if (state.bucket === target && state.bucketIndex >= 0) {
      return;
    }

    this.removeFromBucket(unitId, state);

    const targetBucket =
      target === "on" ? this.onScreenMoverIds : this.offScreenMoverIds;
    state.bucket = target;
    state.bucketIndex = targetBucket.length;
    targetBucket.push(unitId);
  }

  private removeFromBucket(unitId: number, state: MoverRenderState): void {
    if (state.bucketIndex < 0) {
      return;
    }

    const bucketIds =
      state.bucket === "on" ? this.onScreenMoverIds : this.offScreenMoverIds;
    const idx = state.bucketIndex;
    const lastIdx = bucketIds.length - 1;
    if (idx < 0 || idx > lastIdx) {
      state.bucketIndex = -1;
      return;
    }

    const swappedUnitId = bucketIds[lastIdx];
    bucketIds[idx] = swappedUnitId;
    bucketIds.pop();

    if (idx !== lastIdx) {
      const swappedState = this.moverState.get(swappedUnitId);
      if (swappedState) {
        swappedState.bucketIndex = idx;
      }
    }

    state.bucketIndex = -1;

    if (state.bucket === "on" && this.onScreenCursor >= bucketIds.length) {
      this.onScreenCursor = 0;
    }
    if (state.bucket === "off" && this.offScreenCursor >= bucketIds.length) {
      this.offScreenCursor = 0;
    }
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

  private resolveSprite(
    unit: UnitView,
    customTerritoryColor?: Colord,
  ): CanvasImageSource {
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

    return getColoredSprite(
      unit,
      this.theme,
      alternateViewColor ?? customTerritoryColor,
      alternateViewColor ?? undefined,
    );
  }

  private computeSpriteRect(
    unit: UnitView,
    x: number,
    y: number,
    roundCoords: boolean,
    customTerritoryColor?: Colord,
  ): MoverSpriteRect {
    if (this.isSmallMaskShip(unit)) {
      const { x: outX, y: outY } = this.smallShipTopLeft(x, y, roundCoords);
      const pad = 1;
      return {
        x: outX - pad,
        y: outY - pad,
        w: SMALL_SHIP_MASK_SIZE + pad * 2,
        h: SMALL_SHIP_MASK_SIZE + pad * 2,
      };
    }

    const sprite = this.resolveSprite(unit, customTerritoryColor);
    const width = (sprite as { width: number }).width;
    const height = (sprite as { height: number }).height;
    const drawX = x - width / 2;
    const drawY = y - height / 2;
    const outX = roundCoords ? Math.round(drawX) : drawX;
    const outY = roundCoords ? Math.round(drawY) : drawY;
    const pad = 1;
    return {
      x: outX - pad,
      y: outY - pad,
      w: width + pad * 2,
      h: width + pad * 2,
    };
  }

  private drawSpriteAt(
    unit: UnitView,
    x: number,
    y: number,
    ctx: CanvasRenderingContext2D = this.context,
    roundCoords: boolean = true,
    customTerritoryColor?: Colord,
  ): MoverSpriteRect | null {
    if (!unit.isActive()) {
      return null;
    }

    const targetable = unit.targetable();
    ctx.save();
    if (!targetable) {
      ctx.globalAlpha = 0.5;
    }

    if (this.isSmallMaskShip(unit)) {
      const mask = this.smallShipMask(unit);
      const { territory, border } = this.resolveSmallShipMaskColors(
        unit,
        customTerritoryColor,
      );
      const { x: outX, y: outY } = this.smallShipTopLeft(x, y, roundCoords);

      const centerToken = mask[2][2];
      const crossColor = centerToken === "T" ? territory : border;

      // Draw the center cross with 2 rectangles instead of 5 single pixels.
      ctx.fillStyle = crossColor.toRgbString();
      ctx.fillRect(outX + 1, outY + 2, 3, 1);
      ctx.fillRect(outX + 2, outY + 1, 1, 3);

      // Draw remaining ring pixels from the mask.
      for (let row = 0; row < SMALL_SHIP_MASK_SIZE; row++) {
        const line = mask[row];
        for (let col = 0; col < SMALL_SHIP_MASK_SIZE; col++) {
          if (this.isSmallShipCrossCell(col, row)) {
            continue;
          }
          const cellType = line[col];
          if (cellType === ".") {
            continue;
          }
          ctx.fillStyle =
            cellType === "T" ? territory.toRgbString() : border.toRgbString();
          ctx.fillRect(outX + col, outY + row, 1, 1);
        }
      }

      ctx.restore();

      return this.computeSpriteRect(
        unit,
        x,
        y,
        roundCoords,
        customTerritoryColor,
      );
    }

    const sprite = this.resolveSprite(unit, customTerritoryColor) as {
      width: number;
      height: number;
    };

    const drawX = x - sprite.width / 2;
    const drawY = y - sprite.height / 2;
    const outX = roundCoords ? Math.round(drawX) : drawX;
    const outY = roundCoords ? Math.round(drawY) : drawY;
    ctx.drawImage(
      sprite as CanvasImageSource,
      outX,
      outY,
      sprite.width,
      sprite.width,
    );

    ctx.restore();

    return this.computeSpriteRect(
      unit,
      x,
      y,
      roundCoords,
      customTerritoryColor,
    );
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

  private isSmallMaskShip(unit: UnitView): boolean {
    const type = unit.type();
    return type === UnitType.TransportShip || type === UnitType.TradeShip;
  }

  private smallShipMask(unit: UnitView): readonly string[] {
    return unit.type() === UnitType.TransportShip
      ? TRANSPORT_SHIP_MASK
      : TRADE_SHIP_MASK;
  }

  private smallShipTopLeft(
    x: number,
    y: number,
    roundCoords: boolean,
  ): { x: number; y: number } {
    const drawX = x - SMALL_SHIP_MASK_SIZE / 2;
    const drawY = y - SMALL_SHIP_MASK_SIZE / 2;
    return {
      x: roundCoords ? Math.round(drawX) : drawX,
      y: roundCoords ? Math.round(drawY) : drawY,
    };
  }

  private isSmallShipCrossCell(col: number, row: number): boolean {
    return (
      (row === 2 && col >= 1 && col <= 3) || (col === 2 && row >= 1 && row <= 3)
    );
  }

  private resolveSmallShipMaskColors(
    unit: UnitView,
    customTerritoryColor?: Colord,
  ): { territory: Colord; border: Colord } {
    if (this.alternateView) {
      const rel = this.relationshipForAlternateView(unit);
      switch (rel) {
        case Relationship.Self:
          return {
            territory: this.theme.selfColor(),
            border: this.theme.selfColor(),
          };
        case Relationship.Ally:
          return {
            territory: this.theme.allyColor(),
            border: this.theme.allyColor(),
          };
        case Relationship.Enemy:
          return {
            territory: this.theme.enemyColor(),
            border: this.theme.enemyColor(),
          };
      }
    }
    return {
      territory: customTerritoryColor ?? unit.owner().territoryColor(),
      border: unit.owner().borderColor(),
    };
  }
}
