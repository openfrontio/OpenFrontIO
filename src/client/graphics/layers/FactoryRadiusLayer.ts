import type { EventBus } from "../../../core/EventBus";
import { UnitType } from "../../../core/game/Game";
import { GameUpdateType } from "../../../core/game/GameUpdates";
import type { GameView, UnitView } from "../../../core/game/GameView";
import { UIState } from "../UIState";
import { Layer } from "./Layer";
import {
  computeUncoveredArcIntervals,
  Interval,
} from "./utils/circleUnion";

interface FactoryRadius {
  x: number;
  y: number;
  r: number;
  arcs: Interval[];
}

/**
 * Layer responsible for rendering factory train range radii when placing a city.
 * Uses circle union algorithm to merge overlapping circles into a single blob shape.
 */
export class FactoryRadiusLayer implements Layer {
  private readonly factories: Set<number> = new Set(); // Track factory IDs
  private visible: boolean = false;
  private factoryRanges: FactoryRadius[] = [];
  private needsRedraw = false;

  constructor(
    private readonly game: GameView,
    private readonly eventBus: EventBus,
    private readonly uiState: UIState,
  ) {}

  init() {
    // No special initialization needed
  }

  shouldTransform(): boolean {
    return true;
  }

  tick() {
    // Check for updates to factories
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

    // Only show when placing a city
    const wasVisible = this.visible;
    this.visible = this.uiState.ghostStructure === UnitType.City;

    // Force redraw when visibility changes
    if (this.visible && !wasVisible) {
      this.needsRedraw = true;
    }
  }

  renderLayer(context: CanvasRenderingContext2D) {
    if (!this.visible) return;

    if (this.needsRedraw) {
      this.computeCircleUnions();
      this.needsRedraw = false;
    }

    this.drawCirclesUnion(context);
  }

  private hasChanged(unit: UnitView): boolean {
    const known = this.factories.has(unit.id());
    const active = unit.isActive();
    // Factory was added or removed
    return known !== active;
  }

  private getMyFactoryRanges(): FactoryRadius[] {
    const myPlayer = this.game.myPlayer();
    if (!myPlayer) return [];

    // Get all active factories owned by the current player
    const factories = this.game
      .units(UnitType.Factory)
      .filter((unit) => unit.isActive() && unit.owner().id() === myPlayer.id());

    // Update tracking set
    this.factories.clear();
    factories.forEach((f) => this.factories.add(f.id()));

    const radius = this.game.config().trainStationMaxRange();

    // Collect radius data
    return factories.map((factory) => {
      const tile = factory.tile();
      return {
        x: this.game.x(tile),
        y: this.game.y(tile),
        r: radius,
        arcs: [],
      };
    });
  }

  private drawArcSegments(ctx: CanvasRenderingContext2D, a: FactoryRadius) {
    const fillColor = "rgba(0, 255, 0, 0.15)";
    const strokeColor = "rgba(0, 255, 0, 0.8)";
    const outlineColor = "rgba(0, 0, 0, 0.6)";
    const lineWidth = 2;
    const outlineWidth = 1;

    const offsetX = -this.game.width() / 2;
    const offsetY = -this.game.height() / 2;

    for (const [s, e] of a.arcs) {
      if (e - s < 1e-3) continue;

      // Draw outline
      ctx.beginPath();
      ctx.arc(a.x + offsetX, a.y + offsetY, a.r, s, e);
      ctx.strokeStyle = outlineColor;
      ctx.lineWidth = lineWidth + outlineWidth * 2;
      ctx.stroke();

      // Draw colored stroke
      ctx.beginPath();
      ctx.arc(a.x + offsetX, a.y + offsetY, a.r, s, e);
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = lineWidth;
      ctx.stroke();
    }
  }

  private computeCircleUnions() {
    this.factoryRanges = this.getMyFactoryRanges();
    for (const circle of this.factoryRanges) {
      computeUncoveredArcIntervals(circle, this.factoryRanges);
    }
  }

  private drawCirclesUnion(context: CanvasRenderingContext2D) {
    if (this.factoryRanges.length === 0) return;

    context.save();

    // Draw only the outer arc segments for the stroke
    for (const circle of this.factoryRanges) {
      this.drawArcSegments(context, circle);
    }

    context.restore();
  }
}
