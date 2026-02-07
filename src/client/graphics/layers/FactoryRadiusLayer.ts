import { UnitType } from "../../../core/game/Game";
import { GameUpdateType } from "../../../core/game/GameUpdates";
import type { GameView, PlayerView, UnitView } from "../../../core/game/GameView";
import { UIState } from "../UIState";
import { Layer } from "./Layer";

interface FactoryInfo {
  ownerId: number;
}

type Interval = [number, number];
interface FactoryRadius {
  x: number;
  y: number;
  r: number;
  owner: PlayerView;
  arcs: Interval[];
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
      this.computeCircleUnions();
      this.needsRedraw = false;
    }

    if (this.ranges.length === 0) {
      return;
    }

    this.drawCirclesUnion(context);
  }

  /**
   * Compute for each circle which angular segments are NOT covered by any other circle
   */
  private computeCircleUnions() {
    this.ranges = this.collectFactoryRanges();
    for (let i = 0; i < this.ranges.length; i++) {
      const a = this.ranges[i];
      this.computeUncoveredArcIntervals(a, this.ranges);
    }
  }

  private computeUncoveredArcIntervals(
    a: FactoryRadius,
    circles: FactoryRadius[],
  ) {
    a.arcs = [];
    const TWO_PI = Math.PI * 2;
    const EPS = 1e-9;
    // helper functions
    const normalize = (a: number) => {
      while (a < 0) a += TWO_PI;
      while (a >= TWO_PI) a -= TWO_PI;
      return a;
    };
    // merge a list of intervals [s,e] (both between 0..2pi), taking wraparound into account
    const mergeIntervals = (
      intervals: Array<[number, number]>,
    ): Array<[number, number]> => {
      if (intervals.length === 0) return [];
      // normalize to non-wrap intervals
      const flat: Array<[number, number]> = [];
      for (const [s, e] of intervals) {
        const ns = normalize(s);
        const ne = normalize(e);
        if (ne < ns) {
          // wraps, split
          flat.push([ns, TWO_PI]);
          flat.push([0, ne]);
        } else {
          flat.push([ns, ne]);
        }
      }
      flat.sort((a, b) => a[0] - b[0]);
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

      // Only same-owner coverage
      if (a.owner.smallID() !== b.owner.smallID()) continue;

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

  /**
   * Draw union of multiple circles: stroke only the outer arcs so overlapping circles appear as one combined shape.
   */
  private drawCirclesUnion(context: CanvasRenderingContext2D) {
    const circles = this.ranges;
    if (circles.length === 0 || !this.visible) return;
    // Draw factory radius arcs when the player is placing a City, Port, or Factory.
    context.save();
    for (let i = 0; i < circles.length; i++) {
      this.drawArcSegments(context, circles[i]);
    }
    context.restore();
  }

  private drawArcSegments(ctx: CanvasRenderingContext2D, a: FactoryRadius) {
    const lineColorSelf = "rgba(0, 255, 0, 1)";
    const lineColorEnemy = "rgba(255, 255, 255, 1)";
    const lineColorFriend = "rgba(255, 255, 0, 1)";

    const offsetX = -this.game.width() / 2;
    const offsetY = -this.game.height() / 2;
    for (const [s, e] of a.arcs) {
      // skip tiny arcs
      if (e - s < 1e-3) continue;
      ctx.beginPath();
      ctx.arc(a.x + offsetX, a.y + offsetY, a.r, s, e);

      if (a.owner.isMe()) {
        ctx.strokeStyle = lineColorSelf;
      } else if (this.game.myPlayer()?.isFriendly(a.owner)) {
        ctx.strokeStyle = lineColorFriend;
      } else {
        ctx.strokeStyle = lineColorEnemy;
      }
      ctx.lineWidth = 1;
      ctx.stroke();
    }
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

  private collectFactoryRanges(): FactoryRadius[] {
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

    return activeFactories
      .filter((factory) => !this.game.myPlayer()!.hasEmbargo(factory.owner()))
      .map((factory) => {
        const tile = factory.tile();
        return {
          x: this.game.x(tile),
          y: this.game.y(tile),
          r: radius,
          owner: factory.owner(),
          arcs: [],
        };
      });
  }
}
