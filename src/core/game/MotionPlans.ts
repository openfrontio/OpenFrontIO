import type { GameMap } from "./GameMap";
import { TileRef } from "./GameMap";

export enum PackedMotionPlanKind {
  TrainRailPathSet = 2,
  GridPathKeypointSegments = 3,
}

export interface GridKeypointSegmentPlan {
  kind: "grid_segments";
  unitId: number;
  planId: number;
  startTick: number;
  ticksPerStep: number;
  points: readonly TileRef[] | Uint32Array;
  segmentSteps: readonly number[] | Uint32Array;
}

export interface TrainRailPathPlan {
  kind: "train";
  engineUnitId: number;
  /**
   * TrainExecution `cars[]` order (tail engine + carriages).
   */
  carUnitIds: readonly number[] | Uint32Array;
  planId: number;
  startTick: number;
  speed: number;
  spacing: number;
  /**
   * Concatenated rail tile path across all segments, without de-duplicating at stations.
   */
  path: readonly TileRef[] | Uint32Array;
}

export type MotionPlanRecord = GridKeypointSegmentPlan | TrainRailPathPlan;

export function packMotionPlans(
  records: readonly MotionPlanRecord[],
): Uint32Array {
  let totalWords = 1;
  for (const record of records) {
    switch (record.kind) {
      case "grid_segments": {
        const pointCount = (record.points.length >>> 0) as number;
        totalWords += 2 + 5 + pointCount + Math.max(0, pointCount - 1);
        break;
      }
      case "train": {
        const carCount = (record.carUnitIds.length >>> 0) as number;
        const pathLen = (record.path.length >>> 0) as number;
        totalWords += 2 + 7 + carCount + pathLen;
        break;
      }
    }
  }

  const out = new Uint32Array(totalWords);
  out[0] = records.length >>> 0;

  let offset = 1;
  for (const record of records) {
    switch (record.kind) {
      case "grid_segments": {
        const points = record.points as ArrayLike<number>;
        const segmentSteps = record.segmentSteps as ArrayLike<number>;
        const pointCount = points.length >>> 0;
        const segmentCount = pointCount > 0 ? pointCount - 1 : 0;
        if (segmentSteps.length >>> 0 !== segmentCount) {
          throw new Error(
            `grid_segments segmentSteps length mismatch: points=${pointCount}, segmentSteps=${segmentSteps.length}`,
          );
        }

        const wordCount = 2 + 5 + pointCount + segmentCount;

        out[offset++] = PackedMotionPlanKind.GridPathKeypointSegments;
        out[offset++] = wordCount >>> 0;
        out[offset++] = record.unitId >>> 0;
        out[offset++] = record.planId >>> 0;
        out[offset++] = record.startTick >>> 0;
        out[offset++] = record.ticksPerStep >>> 0;
        out[offset++] = pointCount >>> 0;

        for (let i = 0; i < pointCount; i++) {
          out[offset++] = points[i] >>> 0;
        }
        for (let i = 0; i < segmentCount; i++) {
          out[offset++] = segmentSteps[i] >>> 0;
        }
        break;
      }
      case "train": {
        const carUnitIds = record.carUnitIds as ArrayLike<number>;
        const carCount = carUnitIds.length >>> 0;

        const path = record.path as ArrayLike<number>;
        const pathLen = path.length >>> 0;

        const wordCount = 2 + 7 + carCount + pathLen;
        out[offset++] = PackedMotionPlanKind.TrainRailPathSet;
        out[offset++] = wordCount >>> 0;
        out[offset++] = record.engineUnitId >>> 0;
        out[offset++] = record.planId >>> 0;
        out[offset++] = record.startTick >>> 0;
        out[offset++] = record.speed >>> 0;
        out[offset++] = record.spacing >>> 0;
        out[offset++] = carCount >>> 0;
        out[offset++] = pathLen >>> 0;

        for (let i = 0; i < carCount; i++) {
          out[offset++] = carUnitIds[i] >>> 0;
        }
        for (let i = 0; i < pathLen; i++) {
          out[offset++] = path[i] >>> 0;
        }
        break;
      }
    }
  }

  if (offset !== out.length) {
    throw new Error(
      `packMotionPlans size mismatch: wrote ${offset}, expected ${out.length}`,
    );
  }
  return out;
}

export function unpackMotionPlans(packed: Uint32Array): MotionPlanRecord[] {
  if (packed.length < 1) {
    return [];
  }

  const recordCount = packed[0] >>> 0;
  const records: MotionPlanRecord[] = [];
  let offset = 1;

  for (let i = 0; i < recordCount && offset + 1 < packed.length; i++) {
    const kind = packed[offset] >>> 0;
    const wordCount = packed[offset + 1] >>> 0;

    if (wordCount < 2 || offset + wordCount > packed.length) {
      break;
    }

    switch (kind) {
      case PackedMotionPlanKind.GridPathKeypointSegments: {
        if (wordCount < 2 + 5) {
          break;
        }
        const unitId = packed[offset + 2] >>> 0;
        const planId = packed[offset + 3] >>> 0;
        const startTick = packed[offset + 4] >>> 0;
        const ticksPerStep = packed[offset + 5] >>> 0;
        const pointCount = packed[offset + 6] >>> 0;
        const segmentCount = pointCount > 0 ? pointCount - 1 : 0;

        const expectedWordCount = 2 + 5 + pointCount + segmentCount;
        if (
          expectedWordCount !== wordCount ||
          pointCount < 1 ||
          ticksPerStep < 1
        ) {
          break;
        }

        const pointsStart = offset + 7;
        const pointsEnd = pointsStart + pointCount;
        const segmentsStart = pointsEnd;
        const segmentsEnd = segmentsStart + segmentCount;

        const points = packed.slice(pointsStart, pointsEnd);
        const segmentSteps = packed.slice(segmentsStart, segmentsEnd);

        records.push({
          kind: "grid_segments",
          unitId,
          planId,
          startTick,
          ticksPerStep,
          points,
          segmentSteps,
        });
        break;
      }
      case PackedMotionPlanKind.TrainRailPathSet: {
        if (wordCount < 2 + 7) {
          break;
        }
        const engineUnitId = packed[offset + 2] >>> 0;
        const planId = packed[offset + 3] >>> 0;
        const startTick = packed[offset + 4] >>> 0;
        const speed = packed[offset + 5] >>> 0;
        const spacing = packed[offset + 6] >>> 0;
        const carCount = packed[offset + 7] >>> 0;
        const pathLen = packed[offset + 8] >>> 0;

        const expectedWordCount = 2 + 7 + carCount + pathLen;
        if (expectedWordCount !== wordCount) {
          break;
        }

        const carStart = offset + 9;
        const carEnd = carStart + carCount;
        const pathStart = carEnd;
        const pathEnd = pathStart + pathLen;
        const carUnitIds = packed.slice(carStart, carEnd);
        const path = packed.slice(pathStart, pathEnd);

        records.push({
          kind: "train",
          engineUnitId,
          carUnitIds,
          planId,
          startTick,
          speed,
          spacing,
          path,
        });
        break;
      }
      default:
        // Unknown kind: skip.
        break;
    }

    offset += wordCount;
  }

  return records;
}

export function densePathToKeypointSegments(path: ArrayLike<number>): {
  points: Uint32Array;
  segmentSteps: Uint32Array;
} | null {
  const len = path.length >>> 0;
  if (len === 0) {
    return null;
  }

  const first = path[0] >>> 0;
  if (len === 1) {
    return {
      points: Uint32Array.from([first]),
      segmentSteps: new Uint32Array(0),
    };
  }

  const points: number[] = [first];
  const segmentSteps: number[] = [];

  let last = first;
  let dirDelta: number | null = null;
  let runSteps = 0;

  for (let i = 1; i < len; i++) {
    const cur = path[i] >>> 0;
    const delta = (cur - last) | 0;
    if (delta === 0) {
      last = cur;
      continue;
    }

    if (dirDelta === null) {
      dirDelta = delta;
      runSteps = 1;
    } else if (delta === dirDelta) {
      runSteps++;
    } else {
      points.push(last);
      segmentSteps.push(runSteps);
      dirDelta = delta;
      runSteps = 1;
    }
    last = cur;
  }

  if (dirDelta === null) {
    return {
      points: Uint32Array.from([first]),
      segmentSteps: new Uint32Array(0),
    };
  }

  points.push(last);
  segmentSteps.push(runSteps);

  return {
    points: Uint32Array.from(points),
    segmentSteps: Uint32Array.from(segmentSteps),
  };
}

function canTraverseDda(
  map: GameMap,
  from: TileRef,
  to: TileRef,
  isTraversable: (t: TileRef) => boolean,
): boolean {
  const x0 = map.x(from);
  const y0 = map.y(from);
  const x1 = map.x(to);
  const y1 = map.y(to);

  const dx = x1 - x0;
  const dy = y1 - y0;
  const steps = Math.max(Math.abs(dx), Math.abs(dy));
  if (steps === 0) {
    return isTraversable(from);
  }

  for (let t = 0; t <= steps; t++) {
    const x = Math.round(x0 + (dx * t) / steps);
    const y = Math.round(y0 + (dy * t) / steps);
    if (!map.isValidCoord(x, y)) {
      return false;
    }
    const ref = map.ref(x, y);
    if (!isTraversable(ref)) {
      return false;
    }
  }

  return true;
}

export function densePathToLosKeypointSegments(
  path: readonly TileRef[] | Uint32Array,
  map: GameMap,
  isTraversable: (t: TileRef) => boolean,
): { points: Uint32Array; segmentSteps: Uint32Array } | null {
  const len = path.length >>> 0;
  if (len === 0) {
    return null;
  }

  const first = (path[0] ?? 0) as TileRef;
  if (len === 1) {
    return {
      points: Uint32Array.from([first >>> 0]),
      segmentSteps: new Uint32Array(0),
    };
  }

  const points: number[] = [first >>> 0];
  const segmentSteps: number[] = [];

  let i = 0;
  while (i < len - 1) {
    let best = i + 1;
    let lo = i + 1;
    let hi = len - 1;

    // Binary search for farthest "visible" point along the existing path.
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      const ok = canTraverseDda(
        map,
        path[i] as TileRef,
        path[mid] as TileRef,
        isTraversable,
      );
      if (ok) {
        best = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }

    points.push((path[best] as TileRef) >>> 0);
    segmentSteps.push(best - i);
    i = best;
  }

  return {
    points: Uint32Array.from(points),
    segmentSteps: Uint32Array.from(segmentSteps),
  };
}
