import { colord, Colord } from "colord";
import { EventBus } from "../../../core/EventBus";
import { Theme } from "../../../core/configuration/Config";
import { UnitType } from "../../../core/game/Game";
import { TileRef } from "../../../core/game/GameMap";
import { GameView, UnitView } from "../../../core/game/GameView";
import { AlternateViewEvent, UnitSelectionEvent } from "../../InputHandler";
import { getColoredSprite, isSpriteReady } from "../SpriteLoader";
import { Layer } from "./Layer";

const TICK_MS = 100;

enum Relationship {
  Self,
  Ally,
  Enemy,
}

type StoredMotionPlan = {
  planId: number;
  startTick: number;
  ticksPerStep: number;
  path: Uint32Array;
};

export class MotionPlanLayer implements Layer {
  private theme: Theme;
  private alternateView = false;
  private selectedUnitId: number | null = null;

  private lastTickAtMs = performance.now();

  constructor(
    private game: GameView,
    private eventBus: EventBus,
  ) {
    this.theme = game.config().theme();
  }

  shouldTransform(): boolean {
    return true;
  }

  init(): void {
    this.eventBus.on(AlternateViewEvent, (e) => {
      this.alternateView = e.alternateView;
    });
    this.eventBus.on(UnitSelectionEvent, (e) => {
      this.selectedUnitId = e.isSelected ? (e.unit?.id() ?? null) : null;
    });
  }

  tick(): void {
    this.lastTickAtMs = performance.now();
  }

  renderLayer(context: CanvasRenderingContext2D): void {
    const now = performance.now();
    const alpha = this.game.isCatchingUp()
      ? 1
      : Math.max(0, Math.min(1, (now - this.lastTickAtMs) / TICK_MS));
    const tRender = (this.game.ticks() - 1) + alpha;

    for (const [unitId, plan] of this.game.motionPlans()) {
      const unit = this.game.unit(unitId);
      if (!unit || !unit.isActive()) {
        continue;
      }
      if (!isSpriteReady(unit)) {
        continue;
      }

      const pos = this.positionAtTime(plan, tRender);
      if (!pos) {
        continue;
      }

      const isSelected = this.selectedUnitId === unitId;
      this.drawUnitSprite(context, unit, pos.x, pos.y, isSelected);
    }
  }

  private positionAtTime(
    plan: StoredMotionPlan,
    t: number,
  ): { x: number; y: number } | null {
    if (plan.path.length < 1) {
      return null;
    }

    const baseTick = Math.floor(t);
    const frac = t - baseTick;

    const tileA = this.tileAtTick(plan, baseTick);
    const tileB = this.tileAtTick(plan, baseTick + 1);

    const xA = this.game.x(tileA);
    const yA = this.game.y(tileA);
    const xB = this.game.x(tileB);
    const yB = this.game.y(tileB);

    return {
      x: xA + (xB - xA) * frac,
      y: yA + (yB - yA) * frac,
    };
  }

  private tileAtTick(plan: StoredMotionPlan, tick: number): TileRef {
    const dt = tick - plan.startTick;
    const stepIndex =
      dt <= 0 ? 0 : Math.floor(dt / Math.max(1, plan.ticksPerStep));
    const idx = Math.max(0, Math.min(plan.path.length - 1, stepIndex));
    return plan.path[idx] as TileRef;
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

  private drawUnitSprite(
    context: CanvasRenderingContext2D,
    unit: UnitView,
    x: number,
    y: number,
    isSelected: boolean,
  ): void {
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
      alternateViewColor ?? undefined,
      alternateViewColor ?? undefined,
    );

    const mapX = x - this.game.width() / 2;
    const mapY = y - this.game.height() / 2;

    const targetable = unit.targetable();
    if (!targetable) {
      context.save();
      context.globalAlpha = 0.5;
    }

    context.drawImage(
      sprite,
      Math.round(mapX - sprite.width / 2),
      Math.round(mapY - sprite.height / 2),
      sprite.width,
      sprite.width,
    );

    if (!targetable) {
      context.restore();
    }

    if (isSelected) {
      context.save();
      context.strokeStyle = colord("white").alpha(0.9).toRgbString();
      context.lineWidth = 2;
      context.beginPath();
      context.arc(mapX, mapY, Math.max(sprite.width, 18) / 2 + 4, 0, Math.PI * 2);
      context.stroke();
      context.restore();
    }
  }
}
