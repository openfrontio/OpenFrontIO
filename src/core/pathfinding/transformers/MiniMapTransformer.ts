import { Cell } from "../../game/Game";
import { GameMap, TileRef } from "../../game/GameMap";
import { PathFinder, SegmentPlan } from "../types";

export class MiniMapTransformer implements PathFinder<number> {
  private lastPlanFrom: TileRef | TileRef[] | null = null;
  private lastPlanTo: TileRef | null = null;
  private lastPlan: SegmentPlan | null = null;

  constructor(
    private inner: PathFinder<number>,
    private map: GameMap,
    private miniMap: GameMap,
  ) {}

  findPath(from: TileRef | TileRef[], to: TileRef): TileRef[] | null {
    // Convert game coords → minimap coords (supports multi-source)
    const fromArray = Array.isArray(from) ? from : [from];
    const miniFromArray = fromArray.map((f) =>
      this.miniMap.ref(
        Math.floor(this.map.x(f) / 2),
        Math.floor(this.map.y(f) / 2),
      ),
    );
    const miniFrom =
      miniFromArray.length === 1 ? miniFromArray[0] : miniFromArray;

    const miniTo = this.miniMap.ref(
      Math.floor(this.map.x(to) / 2),
      Math.floor(this.map.y(to) / 2),
    );

    // Search on minimap
    const path = this.inner.findPath(miniFrom, miniTo);
    if (!path || path.length === 0) {
      this.lastPlanFrom = from;
      this.lastPlanTo = to;
      this.lastPlan = null;
      return null;
    }

    // Convert minimap TileRefs → Cells
    const cellPath = path.map(
      (ref) => new Cell(this.miniMap.x(ref), this.miniMap.y(ref)),
    );

    // For multi-source, find closest source to path start
    const upscaledPath = this.upscalePath(cellPath);
    let cellFrom: Cell | undefined;
    if (Array.isArray(from)) {
      if (upscaledPath.length > 0) {
        const pathStart = upscaledPath[0];
        let minDist = Infinity;
        for (const f of from) {
          const fx = this.map.x(f);
          const fy = this.map.y(f);
          const dist = Math.abs(fx - pathStart.x) + Math.abs(fy - pathStart.y);
          if (dist < minDist) {
            minDist = dist;
            cellFrom = new Cell(fx, fy);
          }
        }
      }
    } else {
      cellFrom = new Cell(this.map.x(from), this.map.y(from));
    }
    const cellTo = new Cell(this.map.x(to), this.map.y(to));
    const upscaled = this.fixExtremes(upscaledPath, cellTo, cellFrom);

    const miniPlan = this.inner.planSegments?.(miniFrom, miniTo) ?? null;
    this.lastPlanFrom = from;
    this.lastPlanTo = to;
    this.lastPlan = miniPlan
      ? this.upscaleSegmentPlan(miniPlan, cellFrom, cellTo)
      : null;

    return upscaled.map((c) => this.map.ref(c.x, c.y));
  }

  planSegments(from: TileRef | TileRef[], to: TileRef): SegmentPlan | null {
    if (this.lastPlanFrom === from && this.lastPlanTo === to) {
      return this.lastPlan;
    }

    this.findPath(from, to);
    return this.lastPlan;
  }

  private upscaleSegmentPlan(
    plan: SegmentPlan,
    cellFrom: Cell | undefined,
    cellTo: Cell,
    scaleFactor: number = 2,
  ): SegmentPlan {
    const dstRef = this.map.ref(cellTo.x, cellTo.y);

    const points: number[] = [];
    for (let i = 0; i < plan.points.length; i++) {
      const miniRef = plan.points[i] as unknown as TileRef;
      const x = this.miniMap.x(miniRef) * scaleFactor;
      const y = this.miniMap.y(miniRef) * scaleFactor;
      points.push(this.map.ref(x, y) >>> 0);
    }

    const steps: number[] = new Array(plan.segmentSteps.length);
    for (let i = 0; i < plan.segmentSteps.length; i++) {
      steps[i] = (plan.segmentSteps[i] * scaleFactor) >>> 0;
    }

    if (cellFrom !== undefined && points.length > 0) {
      const srcRef = this.map.ref(cellFrom.x, cellFrom.y);
      if (points[0] !== srcRef >>> 0) {
        const a = srcRef;
        const b = points[0] as TileRef;
        const dx = this.map.x(b) - this.map.x(a);
        const dy = this.map.y(b) - this.map.y(a);
        const segSteps = Math.max(Math.abs(dx), Math.abs(dy)) || 1;
        points.unshift(srcRef >>> 0);
        steps.unshift(segSteps >>> 0);
      }
    }

    if (points.length > 0 && points[points.length - 1] !== dstRef >>> 0) {
      const a = points[points.length - 1] as TileRef;
      const b = dstRef;
      const dx = this.map.x(b) - this.map.x(a);
      const dy = this.map.y(b) - this.map.y(a);
      const segSteps = Math.max(Math.abs(dx), Math.abs(dy)) || 1;
      points.push(dstRef >>> 0);
      steps.push(segSteps >>> 0);
    }

    return {
      points: Uint32Array.from(points),
      segmentSteps: Uint32Array.from(steps),
    };
  }

  private upscalePath(path: Cell[], scaleFactor: number = 2): Cell[] {
    const scaledPath = path.map(
      (point) => new Cell(point.x * scaleFactor, point.y * scaleFactor),
    );

    const smoothPath: Cell[] = [];

    for (let i = 0; i < scaledPath.length - 1; i++) {
      const current = scaledPath[i];
      const next = scaledPath[i + 1];

      smoothPath.push(current);

      const dx = next.x - current.x;
      const dy = next.y - current.y;
      const distance = Math.max(Math.abs(dx), Math.abs(dy));
      const steps = distance;

      for (let step = 1; step < steps; step++) {
        smoothPath.push(
          new Cell(
            Math.round(current.x + (dx * step) / steps),
            Math.round(current.y + (dy * step) / steps),
          ),
        );
      }
    }

    if (scaledPath.length > 0) {
      smoothPath.push(scaledPath[scaledPath.length - 1]);
    }

    return smoothPath;
  }

  private fixExtremes(upscaled: Cell[], cellDst: Cell, cellSrc?: Cell): Cell[] {
    if (cellSrc !== undefined) {
      const srcIndex = this.findCell(upscaled, cellSrc);
      if (srcIndex === -1) {
        upscaled.unshift(cellSrc);
      } else if (srcIndex !== 0) {
        upscaled = upscaled.slice(srcIndex);
      }
    }

    const dstIndex = this.findCell(upscaled, cellDst);
    if (dstIndex === -1) {
      upscaled.push(cellDst);
    } else if (dstIndex !== upscaled.length - 1) {
      upscaled = upscaled.slice(0, dstIndex + 1);
    }
    return upscaled;
  }

  private findCell(cells: Cell[], target: Cell): number {
    for (let i = 0; i < cells.length; i++) {
      if (cells[i].x === target.x && cells[i].y === target.y) {
        return i;
      }
    }
    return -1;
  }
}
