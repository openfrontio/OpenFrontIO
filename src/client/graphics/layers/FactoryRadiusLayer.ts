import { UnitType } from "../../../core/game/Game";
import { GameUpdateType } from "../../../core/game/GameUpdates";
import type { GameView, UnitView } from "../../../core/game/GameView";
import { UIState } from "../UIState";
import { Layer } from "./Layer";

interface FactoryInfo {
  ownerId: number;
}

interface FactoryRadius {
  x: number;
  y: number;
  r: number;
}

export class FactoryRadiusLayer implements Layer {
  private readonly factories: Map<number, FactoryInfo> = new Map();
  private visible: boolean = false;
  private needsRedraw: boolean = false;
  private ranges: FactoryRadius[] = [];

  constructor(
    private readonly game: GameView,
    private readonly uiState: UIState,
  ) {}

  shouldTransform(): boolean {
    return true;
  }

  tick(): void {
    const unitUpdates = this.game.updatesSinceLastTick()?.[GameUpdateType.Unit];
    if (unitUpdates) {
      for (const update of unitUpdates) {
        const unit = this.game.unit(update.id);
        if (unit && unit.type() === UnitType.Factory) {
          if (this.hasChanged(unit)) {
            this.needsRedraw = true;
            break;
          }
        }
      }
    }

    const nextVisible =
      this.uiState.ghostStructure === UnitType.City ||
      this.uiState.ghostStructure === UnitType.Port ||
      this.uiState.ghostStructure === UnitType.Factory;
    if (nextVisible !== this.visible) {
      this.visible = nextVisible;
    }
  }

  renderLayer(context: CanvasRenderingContext2D): void {
    if (!this.visible) {
      return;
    }

    if (this.needsRedraw) {
      this.collectFactoryRanges();
      this.needsRedraw = false;
    }

    if (this.ranges.length === 0) {
      return;
    }

    const offsetX = -this.game.width() / 2;
    const offsetY = -this.game.height() / 2;

    context.save();
    for (const range of this.ranges) {
      context.beginPath();
      context.arc(
        range.x + offsetX,
        range.y + offsetY,
        range.r,
        0,
        Math.PI * 2,
      );
      context.fillStyle = "rgba(255, 255, 255, 0.2)";
      context.fill();
      context.strokeStyle = "rgba(255, 255, 255, 0.5)";
      context.lineWidth = 1;
      context.stroke();
    }
    context.restore();
  }

  private hasChanged(unit: UnitView): boolean {
    const info = this.factories.get(unit.id());
    const isNew = info === undefined;
    const active = unit.isActive();
    const ownerId = unit.owner().smallID();

    let hasChanges = isNew || !active;
    hasChanges ||= !isNew && info.ownerId !== ownerId;

    return hasChanges;
  }

  private collectFactoryRanges(): void {
    const activeFactories = this.game
      .units(UnitType.Factory)
      .filter((unit) => unit.isActive());

    this.factories.clear();
    for (const factory of activeFactories) {
      this.factories.set(factory.id(), {
        ownerId: factory.owner().smallID(),
      });
    }

    const radius = this.game.config().trainStationMaxRange();
    this.ranges = activeFactories.map((factory) => {
      const tile = factory.tile();
      return {
        x: this.game.x(tile),
        y: this.game.y(tile),
        r: radius,
      };
    });
  }
}
