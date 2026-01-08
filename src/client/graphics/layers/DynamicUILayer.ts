import { renderNumber } from "src/client/Utils";
import { UnitType } from "src/core/game/Game";
import {
  BonusEventUpdate,
  ConquestUpdate,
  GameUpdateType,
} from "src/core/game/GameUpdates";
import type { GameView, UnitView } from "../../../core/game/GameView";
import { TransformHandler } from "../TransformHandler";
import { NavalTarget } from "../ui/NavalTarget";
import { NukeTelegraph } from "../ui/NukeTelegraph";
import { TextIndicator } from "../ui/TextIndicator";
import { UIElement } from "../ui/UIElement";
import { Layer } from "./Layer";

const TEXT_OFFSET_Y = -5;
const TEXT_STACK_SPACING = 8;
const TEXT_DURATION = 2500;

export class DynamicUILayer implements Layer {
  private readonly allElements: Array<UIElement> = [];
  private lastRefresh = Date.now();

  constructor(
    private readonly game: GameView,
    private transformHandler: TransformHandler,
  ) {}

  shouldTransform(): boolean {
    return false;
  }

  tick() {
    if (!this.game.config().userSettings()?.fxLayer()) {
      return;
    }

    const updates = this.game.updatesSinceLastTick();
    if (!updates) return;

    updates[GameUpdateType.Unit]?.forEach((unit) => {
      const unitView = this.game.unit(unit.id);
      if (!unitView) return;
      this.onUnitEvent(unitView);
    });

    updates[GameUpdateType.BonusEvent]?.forEach((bonusEvent) => {
      if (bonusEvent === undefined) return;
      this.onBonusEvent(bonusEvent);
    });

    updates[GameUpdateType.ConquestEvent]?.forEach((update) => {
      if (update === undefined) return;
      this.onConquestEvent(update);
    });
  }

  onBonusEvent(bonus: BonusEventUpdate) {
    // Only display text fx for the current player
    if (this.game.player(bonus.player) !== this.game.myPlayer()) {
      return;
    }
    const tile = bonus.tile;
    const x = this.game.x(tile);
    let y = this.game.y(tile) + TEXT_OFFSET_Y;
    const gold = bonus.gold;
    const troops = bonus.troops;

    if (gold !== 0) {
      this.addNumber(gold, x, y, 1000, 10);
      y += TEXT_STACK_SPACING; // increase y so the next popup starts below
    }

    if (troops !== 0) {
      this.addNumber(troops, x, y, 1000, 10);
    }
  }

  onConquestEvent(conquest: ConquestUpdate) {
    // Only display text for the current player
    const conqueror = this.game.player(conquest.conquerorId);
    if (conqueror !== this.game.myPlayer()) {
      return;
    }
    const nameLocation = this.game.player(conquest.conqueredId).nameLocation();
    const x = nameLocation.x;
    const y = nameLocation.y;
    this.addNumber(conquest.gold, x, y + 8, TEXT_DURATION, 0);
  }

  onUnitEvent(unit: UnitView) {
    switch (unit.type()) {
      case UnitType.HydrogenBomb:
      case UnitType.AtomBomb: {
        this.onBombEvent(unit);
        break;
      }
      case UnitType.TransportShip: {
        this.onTransportShipEvent(unit);
        break;
      }
    }
  }

  onBombEvent(unit: UnitView) {
    if (this.createdThisTick(unit) && this.isOwnedByPlayer(unit)) {
      const target = new NukeTelegraph(this.transformHandler, this.game, unit);
      this.allElements.push(target);
    }
  }

  onTransportShipEvent(unit: UnitView) {
    if (this.createdThisTick(unit) && this.isOwnedByPlayer(unit)) {
      const target = new NavalTarget(this.transformHandler, this.game, unit);
      this.allElements.push(target);
    }
  }

  renderLayer(context: CanvasRenderingContext2D) {
    const now = Date.now();
    const dt = now - this.lastRefresh;
    this.lastRefresh = now;
    if (this.game.config().userSettings()?.fxLayer()) {
      this.renderAllTargets(context, dt);
    }
  }

  renderAllTargets(context: CanvasRenderingContext2D, delta: number) {
    for (let i = this.allElements.length - 1; i >= 0; i--) {
      if (!this.allElements[i].render(context, delta)) {
        this.allElements.splice(i, 1);
      }
    }
  }

  private isOwnedByPlayer(unit: UnitView): boolean {
    const my = this.game.myPlayer();
    return my !== null && unit.owner() === my;
  }

  private createdThisTick(unit: UnitView): boolean {
    return unit.createdAt() === this.game.ticks();
  }

  private addNumber(
    num: bigint | number,
    x: number,
    y: number,
    duration: number,
    riseDistance: number,
  ) {
    if (BigInt(num) === 0n) return; // Don't show anything for 0
    const absNum =
      typeof num === "bigint" ? (num < 0n ? -num : num) : Math.abs(num);
    const shortened = renderNumber(absNum, 0);
    const sign = num >= 0 ? "+" : "-";
    this.allElements.push(
      new TextIndicator(
        this.transformHandler,
        `${sign} ${shortened}`,
        x,
        y,
        duration,
        riseDistance,
      ),
    );
  }
}
