import type { EventBus } from "../../../core/EventBus";
import { UnitType } from "../../../core/game/Game";
import { GameUpdateType } from "../../../core/game/GameUpdates";
import type { GameView, UnitView } from "../../../core/game/GameView";
import { UIState } from "../UIState";
import { Layer } from "./Layer";

type Interval = [number, number];
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

  private computeUncoveredArcIntervals(
    a: FactoryRadius,
    circles: FactoryRadius[],
  ) {
    a.arcs = [];
    const TWO_PI = Math.PI * 2;
    const EPS = 1e-9;

    const normalize = (angle: number) => {
      while (angle < 0) angle += TWO_PI;
      while (angle >= TWO_PI) angle -= TWO_PI;
      return angle;
    };

    const mergeIntervals = (
      intervals: Array<[number, number]>,
    ): Array<[number, number]> => {
      if (intervals.length === 0) return [];
      const flat: Array<[number, number]> = [];
      for (const [s, e] of intervals) {
        const ns = normalize(s);
        const ne = normalize(e);
        if (ne < ns) {
          flat.push([ns, TWO_PI]);
          flat.push([0, ne]);
        } else {
          flat.push([ns, ne]);
        }
      }
      flat.sort((x, y) => x[0] - y[0]);
      const merged: Array<[number, number]> = [];
      let cur = flat[0].slice() as [number, number];
      for (let i = 1; i < flat.length; i++) {
        const it = flat[i];
        if (it[0] <= cur[1] + EPS) {
          cur[1] = Math.max(cur[1], it[1]);
        } else {
          merged.push([cur[0], cur[1]]);
          cur = it.slice() as [number, number];
        }
      }
      merged.push([cur[0], cur[1]]);
      return merged;
    };

    const covered: Interval[] = [];
    let fullyCovered = false;

    for (const b of circles) {
      if (a === b) continue;

      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.hypot(dx, dy);

      // a fully inside b
      if (d + a.r <= b.r + EPS) {
        fullyCovered = true;
        break;
      }

      // no overlap
      if (d >= a.r + b.r - EPS) continue;

      // coincident centers
      if (d <= EPS) {
        if (b.r >= a.r) {
          fullyCovered = true;
          break;
        }
        continue;
      }

      // angular span on a covered by b
      const theta = Math.atan2(dy, dx);
      const cosPhi = (a.r * a.r + d * d - b.r * b.r) / (2 * a.r * d);
      const phi = Math.acos(Math.max(-1, Math.min(1, cosPhi)));

      covered.push([theta - phi, theta + phi]);
    }

    if (fullyCovered) return;

    const merged = mergeIntervals(covered);

    // subtract from [0, 2π)
    const uncovered: Interval[] = [];
    if (merged.length === 0) {
      uncovered.push([0, TWO_PI]);
    } else {
      let cursor = 0;
      for (const [s, e] of merged) {
        if (s > cursor + EPS) {
          uncovered.push([cursor, s]);
        }
        cursor = Math.max(cursor, e);
      }
      if (cursor < TWO_PI - EPS) {
        uncovered.push([cursor, TWO_PI]);
      }
    }
    a.arcs = uncovered;
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

  private drawFill(ctx: CanvasRenderingContext2D) {
    const fillColor = "rgba(0, 255, 0, 0.12)";
    const offsetX = -this.game.width() / 2;
    const offsetY = -this.game.height() / 2;

    // Draw filled circles (the fill naturally unions due to transparency)
    ctx.fillStyle = fillColor;
    for (const circle of this.factoryRanges) {
      ctx.beginPath();
      ctx.arc(circle.x + offsetX, circle.y + offsetY, circle.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private computeCircleUnions() {
    this.factoryRanges = this.getMyFactoryRanges();
    for (const circle of this.factoryRanges) {
      this.computeUncoveredArcIntervals(circle, this.factoryRanges);
    }
  }

  private drawCirclesUnion(context: CanvasRenderingContext2D) {
    if (this.factoryRanges.length === 0) return;

    context.save();

    // Draw the fill first (uses natural transparency blending)
    this.drawFill(context);

    // Draw only the outer arc segments for the stroke
    for (const circle of this.factoryRanges) {
      this.drawArcSegments(context, circle);
    }

    context.restore();
  }
}
