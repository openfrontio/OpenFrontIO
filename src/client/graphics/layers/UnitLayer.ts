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
  private transportShipTrailCanvas: HTMLCanvasElement;
  private unitTrailContext: CanvasRenderingContext2D;
  private interpolationCanvas: HTMLCanvasElement;
  private interpolationContext: CanvasRenderingContext2D;

  private unitToTrail = new Map<UnitView, TileRef[]>();

  private theme: Theme;

  private alternateView = false;

  private transformHandler: TransformHandler;

  // Selected unit property as suggested in the review comment
  private selectedUnit: UnitView | null = null;

  // Configuration for unit selection
  private readonly WARSHIP_SELECTION_RADIUS = 10; // Radius in game cells for warship selection hit zone
  private readonly interpolatedUnitTypes: UnitType[] = [
    UnitType.SAMMissile,
    UnitType.AtomBomb,
    UnitType.HydrogenBomb,
    UnitType.MIRV,
    UnitType.MIRVWarhead,
    UnitType.Shell,
    UnitType.Warship,
    UnitType.Train,
    UnitType.TransportShip,
    UnitType.TradeShip,
  ];
  private readonly tickIntervalMs: number = 100;
  private lastTickTimestamp = 0;

  constructor(
    private game: GameView,
    private eventBus: EventBus,
    transformHandler: TransformHandler,
  ) {
    this.theme = game.config().theme();
    this.transformHandler = transformHandler;
    this.lastTickTimestamp = this.now();
  }

  shouldTransform(): boolean {
    return true;
  }

  tick() {
    this.lastTickTimestamp = this.now();
    const unitIds = this.game
      .updatesSinceLastTick()
      ?.[GameUpdateType.Unit]?.map((unit) => unit.id);

    this.updateUnitsSprites(unitIds ?? []);
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
    this.updateInterpolatedUnits();
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
    if (this.interpolationCanvas) {
      context.drawImage(
        this.interpolationCanvas,
        -this.game.width() / 2,
        -this.game.height() / 2,
        this.game.width(),
        this.game.height(),
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
    this.transportShipTrailCanvas = document.createElement("canvas");
    const trailContext = this.transportShipTrailCanvas.getContext("2d");
    if (trailContext === null) throw new Error("2d context not supported");
    this.unitTrailContext = trailContext;
    this.interpolationCanvas = document.createElement("canvas");
    const interpolationContext = this.interpolationCanvas.getContext("2d");
    if (interpolationContext === null)
      throw new Error("2d context not supported");
    this.interpolationContext = interpolationContext;

    this.canvas.width = this.game.width();
    this.canvas.height = this.game.height();
    this.transportShipTrailCanvas.width = this.game.width();
    this.transportShipTrailCanvas.height = this.game.height();
    this.interpolationCanvas.width = this.game.width();
    this.interpolationCanvas.height = this.game.height();

    this.updateUnitsSprites(this.game.units().map((unit) => unit.id()));

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
      case UnitType.AtomBomb:
      case UnitType.HydrogenBomb:
      case UnitType.MIRV:
        this.handleNuke(unit);
        break;
    }
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
    if (!unit.isActive()) {
      this.clearTrail(unit);
    }
  }

  private handleBoatEvent(unit: UnitView) {
    const rel = this.relationship(unit);

    if (!this.unitToTrail.has(unit)) {
      this.unitToTrail.set(unit, []);
    }
    const trail = this.unitToTrail.get(unit) ?? [];
    trail.push(unit.lastTile());

    // Paint trail
    this.drawTrail(trail.slice(-1), unit.owner().territoryColor(), rel);
    this.drawSprite(unit);

    if (!unit.isActive()) {
      this.clearTrail(unit);
    }
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

  drawSprite(unit: UnitView, customTerritoryColor?: Colord) {
    const position = {
      x: this.game.x(unit.tile()),
      y: this.game.y(unit.tile()),
    };
    this.drawSpriteAtPosition(unit, position, customTerritoryColor);
  }

  private drawSpriteAtPosition(
    unit: UnitView,
    position: { x: number; y: number },
    customTerritoryColor?: Colord,
    context: CanvasRenderingContext2D = this.context,
    snapToPixel: boolean = true,
  ) {
    let alternateViewColor: Colord | null = null;

    if (this.alternateView) {
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
      alternateViewColor = this.getAlternateViewColor(rel);
    }

    const sprite = getColoredSprite(
      unit,
      this.theme,
      alternateViewColor ?? customTerritoryColor,
      alternateViewColor ?? undefined,
    );

    if (unit.isActive()) {
      const targetable = unit.targetable();
      if (!targetable) {
        context.save();
        context.globalAlpha = 0.5;
      }
      const offsetX = snapToPixel
        ? Math.round(position.x - sprite.width / 2)
        : position.x - sprite.width / 2;
      const offsetY = snapToPixel
        ? Math.round(position.y - sprite.height / 2)
        : position.y - sprite.height / 2;
      context.drawImage(sprite, offsetX, offsetY, sprite.width, sprite.width);
      if (!targetable) {
        context.restore();
      }
    }
  }

  private interpolatePosition(unit: UnitView, alpha: number) {
    const startTile = unit.lastTile();
    const endTile = unit.tile();

    const startX = this.game.x(startTile);
    const startY = this.game.y(startTile);
    const endX = this.game.x(endTile);
    const endY = this.game.y(endTile);

    return {
      x: startX + (endX - startX) * alpha,
      y: startY + (endY - startY) * alpha,
    };
  }

  private updateInterpolatedUnits() {
    if (!this.interpolationContext || !this.interpolationCanvas) {
      return;
    }

    this.interpolationContext.clearRect(
      0,
      0,
      this.game.width(),
      this.game.height(),
    );

    const alpha = this.computeTickAlpha();
    const missiles = this.game.units(...this.interpolatedUnitTypes);

    for (const unit of missiles) {
      if (!unit.isActive()) {
        continue;
      }
      const position = this.interpolatePosition(unit, alpha);
      switch (unit.type()) {
        case UnitType.Shell:
          this.renderShell(unit, position);
          continue;
        case UnitType.MIRVWarhead:
          this.renderWarhead(unit, position);
          continue;
      }
      if (!isSpriteReady(unit)) {
        continue;
      }
      const customColor = this.getInterpolatedSpriteColor(unit);
      this.drawSpriteAtPosition(
        unit,
        position,
        customColor,
        this.interpolationContext,
        false,
      );
    }
  }

  private getInterpolatedSpriteColor(unit: UnitView): Colord | undefined {
    if (unit.type() === UnitType.Warship && unit.targetUnitId()) {
      return colord("rgb(200,0,0)");
    }
    return undefined;
  }

  private renderShell(unit: UnitView, position: { x: number; y: number }) {
    const rel = this.relationship(unit);
    const color = unit.owner().borderColor();
    this.drawInterpolatedSquare(position, rel, color, 1, 1);
    this.drawInterpolatedSquare(position, rel, color, 2, 0.4);

    const last = {
      x: this.game.x(unit.lastTile()),
      y: this.game.y(unit.lastTile()),
    };
    if (last.x !== position.x || last.y !== position.y) {
      this.drawInterpolatedSegment(last, position, rel, color, 0.7);
    }
  }

  private renderWarhead(unit: UnitView, position: { x: number; y: number }) {
    const rel = this.relationship(unit);
    const color = unit.owner().borderColor();
    this.drawInterpolatedSquare(position, rel, color, 1, 1);
    this.drawInterpolatedSquare(position, rel, color, 2, 0.35);

    const last = {
      x: this.game.x(unit.lastTile()),
      y: this.game.y(unit.lastTile()),
    };
    if (last.x !== position.x || last.y !== position.y) {
      this.drawInterpolatedSegment(last, position, rel, color, 0.5);
    }
  }

  private drawInterpolatedSquare(
    position: { x: number; y: number },
    relationship: Relationship,
    color: Colord,
    size: number,
    alpha: number,
  ) {
    if (!this.interpolationContext) {
      return;
    }
    const ctx = this.interpolationContext;
    ctx.fillStyle = this.resolveInterpolatedColor(relationship, color, alpha);
    ctx.fillRect(position.x - size / 2, position.y - size / 2, size, size);
  }

  private drawInterpolatedSegment(
    start: { x: number; y: number },
    end: { x: number; y: number },
    relationship: Relationship,
    color: Colord,
    alpha: number,
  ) {
    if (!this.interpolationContext) {
      return;
    }
    const ctx = this.interpolationContext;
    ctx.strokeStyle = this.resolveInterpolatedColor(relationship, color, alpha);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
  }

  private resolveInterpolatedColor(
    relationship: Relationship,
    color: Colord,
    alpha: number,
  ): string {
    if (this.alternateView) {
      return this.getAlternateViewColor(relationship)
        .alpha(alpha)
        .toRgbString();
    }
    return color.alpha(alpha).toRgbString();
  }

  private getAlternateViewColor(relationship: Relationship): Colord {
    switch (relationship) {
      case Relationship.Self:
        return this.theme.selfColor();
      case Relationship.Ally:
        return this.theme.allyColor();
      case Relationship.Enemy:
      default:
        return this.theme.enemyColor();
    }
  }

  private computeTickAlpha(): number {
    const elapsed = Math.min(
      this.now() - this.lastTickTimestamp,
      this.tickIntervalMs,
    );
    if (this.tickIntervalMs === 0) {
      return 1;
    }
    return Math.max(0, elapsed / this.tickIntervalMs);
  }

  private now(): number {
    if (typeof performance !== "undefined" && performance.now) {
      return performance.now();
    }
    return Date.now();
  }
}
