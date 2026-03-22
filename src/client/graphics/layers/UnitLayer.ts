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

interface TrailData {
  trail: TileRef[];
  relationship: Relationship;
  color: Colord;
}

export class UnitLayer implements Layer {
  // Using unit ID as key for stability across ticks
  private unitToTrail = new Map<number, TrailData>();

  private theme: Theme;
  private alternateView = false;
  private transformHandler: TransformHandler;
  private selectedUnit: UnitView | null = null;

  private readonly WARSHIP_SELECTION_RADIUS = 10;

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
    // 1. Collect all units that might need trail updates
    const updates = this.game.updatesSinceLastTick();
    const updatedUnitIds =
      updates?.[GameUpdateType.Unit]?.map((u) => u.id) ?? [];
    const motionPlanUnitIds = this.game.motionPlannedUnitIds();

    const unitsToCheck = new Set<number>([
      ...updatedUnitIds,
      ...motionPlanUnitIds,
    ]);

    for (const id of unitsToCheck) {
      const unit = this.game.unit(id);
      if (unit && unit.isActive()) {
        this.updateTrailState(unit);
      }
    }

    // 2. Clean up trails for units that are no longer in the game or inactive
    for (const id of this.unitToTrail.keys()) {
      const unit = this.game.unit(id);
      if (!unit || !unit.isActive()) {
        this.unitToTrail.delete(id);
      }
    }
  }

  private updateTrailState(unit: UnitView) {
    const type = unit.type();
    if (
      type !== UnitType.TransportShip &&
      type !== UnitType.AtomBomb &&
      type !== UnitType.HydrogenBomb &&
      type !== UnitType.MIRV
    ) {
      return;
    }

    const currentPos = unit.tile();
    if (!this.unitToTrail.has(unit.id())) {
      this.unitToTrail.set(unit.id(), {
        trail: [currentPos],
        relationship: this.relationship(unit),
        color: unit.owner().territoryColor(),
      });
      return;
    }

    const data = this.unitToTrail.get(unit.id())!;
    const trail = data.trail;
    const lastPosInTrail = trail[trail.length - 1];

    // Use Bezenham interpolation to fill gaps if the unit moved
    if (lastPosInTrail !== currentPos) {
      const prev = {
        x: this.game.x(lastPosInTrail),
        y: this.game.y(lastPosInTrail),
      };
      const cur = { x: this.game.x(currentPos), y: this.game.y(currentPos) };

      const line = new BezenhamLine(prev, cur);
      let point = line.increment();
      // line.increment() starts from the point AFTER prev.
      while (point !== true) {
        const ref = this.game.ref(point.x, point.y);
        if (ref !== null) {
          trail.push(ref);
        }
        point = line.increment();
      }

      // Cap trail length to prevent memory leaks and rendering lag
      // Increased from 500 to 2000 to better support giant maps while still being performant
      if (trail.length > 2000) {
        data.trail = trail.slice(-2000);
      }
    }

    // Update relationship and color in case they changed
    data.relationship = this.relationship(unit);
    data.color = unit.owner().territoryColor();
  }

  init() {
    this.eventBus.on(AlternateViewEvent, (e) => {
      this.alternateView = e.alternateView;
    });
    this.eventBus.on(MouseUpEvent, (e) => this.onMouseUp(e));
    this.eventBus.on(TouchEvent, (e) => this.onTouch(e));
    this.eventBus.on(UnitSelectionChange, (e) => {
      if (e.isSelected) this.selectedUnit = e.unit;
      else if (this.selectedUnit === e.unit) this.selectedUnit = null;
    });

    loadAllSprites();
  }

  renderLayer(context: CanvasRenderingContext2D) {
    const [topLeft, bottomRight] = this.transformHandler.screenBoundingRect();
    const visLeft = Math.max(0, topLeft.x - 30);
    const visTop = Math.max(0, topLeft.y - 30);
    const visRight = Math.min(this.game.width(), bottomRight.x + 30);
    const visBottom = Math.min(this.game.height(), bottomRight.y + 30);

    const offsetX = -this.game.width() / 2;
    const offsetY = -this.game.height() / 2;

    // Draw trails
    for (const data of this.unitToTrail.values()) {
      context.fillStyle = this.getTrailColor(data).toRgbString();
      for (const t of data.trail) {
        const x = this.game.x(t);
        const y = this.game.y(t);
        if (x >= visLeft && x <= visRight && y >= visTop && y <= visBottom) {
          // Trails are drawn at 1x1 world pixels
          context.fillRect(x + offsetX, y + offsetY, 1, 1);
        }
      }
    }

    // Draw units
    for (const unit of this.game.units()) {
      const x = this.game.x(unit.tile());
      const y = this.game.y(unit.tile());

      if (x < visLeft || x > visRight || y < visTop || y > visBottom) {
        continue;
      }

      if (unit.type() === UnitType.Shell && unit.isActive()) {
        this.renderShell(context, unit, offsetX, offsetY);
      } else if (unit.type() === UnitType.MIRVWarhead && unit.isActive()) {
        this.renderSmallPoint(context, unit, offsetX, offsetY);
      } else if (unit.isActive() && isSpriteReady(unit)) {
        this.drawSprite(context, unit, x + offsetX, y + offsetY);
      }
    }
  }

  private getTrailColor(data: TrailData): Colord {
    if (this.alternateView) {
      switch (data.relationship) {
        case Relationship.Self:
          return this.theme.selfColor();
        case Relationship.Ally:
          return this.theme.allyColor();
        case Relationship.Enemy:
          return this.theme.enemyColor();
      }
    }
    // Increased alpha from 150 to 220 because it no longer stacks on a persistent canvas
    return data.color.alpha(220 / 255);
  }

  private renderShell(
    context: CanvasRenderingContext2D,
    unit: UnitView,
    offsetX: number,
    offsetY: number,
  ) {
    const rel = this.relationship(unit);
    const color = unit.owner().borderColor();
    context.fillStyle = this.getPointColor(rel, color, 255).toRgbString();
    context.fillRect(
      this.game.x(unit.tile()) + offsetX,
      this.game.y(unit.tile()) + offsetY,
      1,
      1,
    );
    context.fillRect(
      this.game.x(unit.lastTile()) + offsetX,
      this.game.y(unit.lastTile()) + offsetY,
      1,
      1,
    );
  }

  private renderSmallPoint(
    context: CanvasRenderingContext2D,
    unit: UnitView,
    offsetX: number,
    offsetY: number,
  ) {
    const rel = this.relationship(unit);
    const color = unit.owner().borderColor();
    context.fillStyle = this.getPointColor(rel, color, 255).toRgbString();
    context.fillRect(
      this.game.x(unit.tile()) + offsetX,
      this.game.y(unit.tile()) + offsetY,
      1,
      1,
    );
  }

  private getPointColor(
    rel: Relationship,
    color: Colord,
    alpha: number,
  ): Colord {
    if (this.alternateView) {
      switch (rel) {
        case Relationship.Self:
          return this.theme.selfColor();
        case Relationship.Ally:
          return this.theme.allyColor();
        case Relationship.Enemy:
          return this.theme.enemyColor();
      }
    }
    return color.alpha(alpha / 255);
  }

  private drawSprite(
    context: CanvasRenderingContext2D,
    unit: UnitView,
    worldX: number,
    worldY: number,
  ) {
    let altColor: Colord | undefined = undefined;
    if (this.alternateView) {
      const rel = this.relationship(unit);
      if (rel === Relationship.Self) altColor = this.theme.selfColor();
      else if (rel === Relationship.Ally) altColor = this.theme.allyColor();
      else altColor = this.theme.enemyColor();
    }

    let customColor = undefined;
    if (unit.type() === UnitType.Warship && unit.targetUnitId()) {
      customColor = colord("rgb(200,0,0)");
    }

    const sprite = getColoredSprite(
      unit,
      this.theme,
      altColor ?? customColor,
      altColor,
    );

    const targetable = unit.targetable();
    if (!targetable) {
      context.save();
      context.globalAlpha = 0.5;
    }
    context.drawImage(
      sprite,
      Math.round(worldX - sprite.width / 2),
      Math.round(worldY - sprite.height / 2),
      sprite.width,
      sprite.width,
    );
    if (!targetable) context.restore();
  }

  private relationship(unit: UnitView): Relationship {
    const myPlayer = this.game.myPlayer();
    if (!myPlayer) return Relationship.Enemy;
    if (myPlayer === unit.owner()) return Relationship.Self;
    if (myPlayer.isFriendly(unit.owner())) return Relationship.Ally;
    return Relationship.Enemy;
  }

  // --- INPUT HANDLING ---

  private onMouseUp(event: MouseUpEvent, clickRef?: TileRef) {
    if (clickRef === undefined) {
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
      this.eventBus.emit(new UnitSelectionEvent(this.selectedUnit, false));
      return;
    }

    const nearby = this.findWarshipsNearCell(clickRef);
    if (nearby.length > 0)
      this.eventBus.emit(new UnitSelectionEvent(nearby[0], true));
  }

  private onTouch(event: TouchEvent) {
    const cell = this.transformHandler.screenToWorldCoordinates(
      event.x,
      event.y,
    );
    if (!this.game.isValidCoord(cell.x, cell.y)) return;
    const clickRef = this.game.ref(cell.x, cell.y);

    if (!this.game.isOcean(clickRef)) {
      this.eventBus.emit(new ContextMenuEvent(event.x, event.y));
      return;
    }

    if (this.selectedUnit) {
      this.onMouseUp(new MouseUpEvent(event.x, event.y), clickRef);
      return;
    }

    const nearby = this.findWarshipsNearCell(clickRef);
    if (nearby.length > 0)
      this.onMouseUp(new MouseUpEvent(event.x, event.y), clickRef, nearby);
    else this.eventBus.emit(new ContextMenuEvent(event.x, event.y));
  }

  private findWarshipsNearCell(clickRef: TileRef): UnitView[] {
    return this.game
      .units(UnitType.Warship)
      .filter(
        (u) =>
          u.isActive() &&
          u.owner() === this.game.myPlayer() &&
          this.game.manhattanDist(u.tile(), clickRef) <=
            this.WARSHIP_SELECTION_RADIUS,
      )
      .sort(
        (a, b) =>
          this.game.manhattanDist(a.tile(), clickRef) -
          this.game.manhattanDist(b.tile(), clickRef),
      );
  }
}
