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

export class UnitLayer implements Layer {
  private canvas: HTMLCanvasElement;
  private context: CanvasRenderingContext2D;
  private unitTrailCanvas: HTMLCanvasElement;
  private unitTrailContext: CanvasRenderingContext2D;
  private transportShipTrailCanvas: HTMLCanvasElement;
  private transportShipTrailContext: CanvasRenderingContext2D;

  // Pixel trails (currently only used for nukes).
  private unitToTrail = new Map<UnitView, TileRef[]>();

  private gridMoverUnitIds = new Set<number>();

  private transportShipTrails = new Map<
    number,
    {
      xy: number[];
      planId: number;
      lastX: number;
      lastY: number;
      lastOnScreen: boolean;
    }
  >();
  private transportShipTrailDirty = false;

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
    // Cleanup trails for nukes that were removed without a final inactive update event.
    // These trails are stored outside of the normal unit sprite lifecycle.
    const trailUnits = Array.from(this.unitToTrail.keys());
    for (const unit of trailUnits) {
      const current = this.game.unit(unit.id());
      if (!current || !current.isActive()) {
        this.clearTrail(unit);
      }
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
      this.redrawStaticSprites();
      return;
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
    const moversToDraw: Array<{ unit: UnitView; x: number; y: number }> = [];

    const tickAlpha = this.computeTickAlpha();
    const tickFloat = this.game.ticks() + tickAlpha;

    for (const [unitId, plan] of this.game.motionPlans()) {
      const unit = this.game.unit(unitId);
      if (!unit || !unit.isActive()) {
        if (this.transportShipTrails.delete(unitId)) {
          this.transportShipTrailDirty = true;
        }
        continue;
      }

      const sampled = sampleGridSegmentPlan(this.game, plan, tickFloat);
      if (!sampled) {
        continue;
      }

      const onScreen = this.transformHandler.isOnScreen(
        new Cell(Math.floor(sampled.x), Math.floor(sampled.y)),
      );

      if (unit.type() === UnitType.TransportShip) {
        const existing = this.transportShipTrails.get(unitId);
        if (!existing || existing.planId !== plan.planId) {
          const xy: number[] = onScreen ? [sampled.x, sampled.y] : [];
          this.transportShipTrails.set(unitId, {
            xy,
            planId: plan.planId,
            lastX: sampled.x,
            lastY: sampled.y,
            lastOnScreen: onScreen,
          });
          if (onScreen) {
            this.transportShipTrailDirty = true;
          }
        } else {
          if (
            onScreen &&
            (existing.lastX !== sampled.x || existing.lastY !== sampled.y)
          ) {
            if (!existing.lastOnScreen && existing.xy.length > 0) {
              existing.xy.push(Number.NaN, Number.NaN);
            }
            existing.xy.push(sampled.x, sampled.y);
            this.transportShipTrailDirty = true;
          } else if (onScreen && existing.xy.length === 0) {
            existing.xy.push(sampled.x, sampled.y);
            this.transportShipTrailDirty = true;
          }

          existing.lastX = sampled.x;
          existing.lastY = sampled.y;
          existing.lastOnScreen = onScreen;
        }

        if (onScreen) {
          moversToDraw.push({ unit, x: sampled.x, y: sampled.y });
        }
        continue;
      }

      if (onScreen) {
        moversToDraw.push({ unit, x: sampled.x, y: sampled.y });
      }
    }

    // Remove transport-ship trails when the unit is gone (no fade during movement).
    for (const unitId of this.transportShipTrails.keys()) {
      const unit = this.game.unit(unitId);
      if (!unit || !unit.isActive()) {
        this.transportShipTrails.delete(unitId);
        this.transportShipTrailDirty = true;
      }
    }
    this.rebuildTransportShipTrailCanvasIfDirty();

    context.drawImage(
      this.unitTrailCanvas,
      -this.game.width() / 2,
      -this.game.height() / 2,
      this.game.width(),
      this.game.height(),
    );
    context.drawImage(
      this.transportShipTrailCanvas,
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

    for (const mover of moversToDraw) {
      this.drawSpriteAt(
        mover.unit,
        mover.x - this.game.width() / 2,
        mover.y - this.game.height() / 2,
        context,
        false,
      );
    }
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

    this.unitTrailCanvas = document.createElement("canvas");
    const unitTrailContext = this.unitTrailCanvas.getContext("2d");
    if (unitTrailContext === null) throw new Error("2d context not supported");
    this.unitTrailContext = unitTrailContext;

    this.transportShipTrailCanvas = document.createElement("canvas");
    const transportTrailContext =
      this.transportShipTrailCanvas.getContext("2d");
    if (transportTrailContext === null)
      throw new Error("2d context not supported");
    this.transportShipTrailContext = transportTrailContext;

    this.canvas.width = this.game.width();
    this.canvas.height = this.game.height();
    this.unitTrailCanvas.width = this.game.width();
    this.unitTrailCanvas.height = this.game.height();
    this.transportShipTrailCanvas.width = this.game.width();
    this.transportShipTrailCanvas.height = this.game.height();

    this.gridMoverUnitIds = new Set<number>(this.game.motionPlans().keys());
    this.transportShipTrailDirty = true;

    this.redrawStaticSprites();

    this.unitToTrail.forEach((trail, unit) => {
      for (const t of trail) {
        this.paintCell(
          this.game.x(t),
          this.game.y(t),
          this.relationship(unit),
          unit.owner().territoryColor(),
          150,
          this.unitTrailContext,
        );
      }
    });
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

  private rebuildTransportShipTrailCanvasIfDirty(): void {
    if (!this.transportShipTrailDirty) {
      return;
    }
    this.transportShipTrailDirty = false;

    const ctx = this.transportShipTrailContext;
    ctx.clearRect(0, 0, this.game.width(), this.game.height());

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

  private drawTrail(trail: number[], color: Colord, rel: Relationship) {
    // Paint new trail
    for (const t of trail) {
      this.paintCell(
        this.game.x(t),
        this.game.y(t),
        rel,
        color,
        150,
        this.unitTrailContext,
      );
    }
  }

  private clearTrail(unit: UnitView) {
    const trail = this.unitToTrail.get(unit) ?? [];
    const rel = this.relationship(unit);
    for (const t of trail) {
      this.clearCell(this.game.x(t), this.game.y(t), this.unitTrailContext);
    }
    this.unitToTrail.delete(unit);

    // Repaint overlapping trails
    const trailSet = new Set(trail);
    for (const [other, trail] of this.unitToTrail) {
      for (const t of trail) {
        if (trailSet.has(t)) {
          this.paintCell(
            this.game.x(t),
            this.game.y(t),
            rel,
            other.owner().territoryColor(),
            150,
            this.unitTrailContext,
          );
        }
      }
    }
  }

  private handleNuke(unit: UnitView) {
    const rel = this.relationship(unit);

    if (!this.unitToTrail.has(unit)) {
      this.unitToTrail.set(unit, []);
    }

    let newTrailSize = 1;
    const trail = this.unitToTrail.get(unit) ?? [];
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
      newTrailSize = line.size();
    } else {
      trail.push(unit.lastTile());
    }

    this.drawTrail(
      trail.slice(-newTrailSize),
      unit.owner().territoryColor(),
      rel,
    );
    this.drawSprite(unit);
    if (!unit.isActive()) {
      this.clearTrail(unit);
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
  ) {
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
      return;
    }

    const targetable = unit.targetable();
    ctx.save();
    if (!targetable) {
      ctx.globalAlpha = 0.5;
    }

    const drawX = x - sprite.width / 2;
    const drawY = y - sprite.height / 2;
    ctx.drawImage(
      sprite,
      roundCoords ? Math.round(drawX) : drawX,
      roundCoords ? Math.round(drawY) : drawY,
      sprite.width,
      sprite.width,
    );

    ctx.restore();
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
