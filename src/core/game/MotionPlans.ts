import { TileRef } from "./GameMap";

export const MOTION_PLANS_SCHEMA_VERSION = 4;

export enum PackedMotionPlanKind {
  GridPathSet = 1,
  TrainRailPathSet = 2,
}

export interface GridPathPlan {
  kind: "grid";
  unitId: number;
  planId: number;
  startTick: number;
  ticksPerStep: number;
  /**
   * TileRef path where `path[0]` is the unit tile at `startTick`.
   */
  path: readonly TileRef[] | Uint32Array;
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

export type MotionPlanRecord = GridPathPlan | TrainRailPathPlan;

export function packMotionPlans(
  records: readonly MotionPlanRecord[],
): Uint32Array {
  const out: number[] = [MOTION_PLANS_SCHEMA_VERSION, records.length];

  for (const record of records) {
    switch (record.kind) {
      case "grid": {
        const path =
          record.path instanceof Uint32Array
            ? record.path
            : Uint32Array.from(record.path);
        const pathLen = path.length >>> 0;
        const wordCount = 2 + 5 + pathLen;
        out.push(
          PackedMotionPlanKind.GridPathSet,
          wordCount,
          record.unitId >>> 0,
          record.planId >>> 0,
          record.startTick >>> 0,
          record.ticksPerStep >>> 0,
          pathLen,
        );
        for (let i = 0; i < path.length; i++) {
          out.push(path[i] >>> 0);
        }
        break;
      }
      case "train": {
        const carUnitIds =
          record.carUnitIds instanceof Uint32Array
            ? record.carUnitIds
            : Uint32Array.from(record.carUnitIds);
        const carCount = carUnitIds.length >>> 0;

        const path =
          record.path instanceof Uint32Array
            ? record.path
            : Uint32Array.from(record.path);
        const pathLen = path.length >>> 0;

        const wordCount = 2 + 7 + carCount + pathLen;
        out.push(
          PackedMotionPlanKind.TrainRailPathSet,
          wordCount,
          record.engineUnitId >>> 0,
          record.planId >>> 0,
          record.startTick >>> 0,
          record.speed >>> 0,
          record.spacing >>> 0,
          carCount,
          pathLen,
        );
        for (let i = 0; i < carUnitIds.length; i++) {
          out.push(carUnitIds[i] >>> 0);
        }
        for (let i = 0; i < path.length; i++) {
          out.push(path[i] >>> 0);
        }
        break;
      }
    }
  }

  return new Uint32Array(out);
}

export function unpackMotionPlans(packed: Uint32Array): {
  schemaVersion: number;
  records: MotionPlanRecord[];
} {
  if (packed.length < 2) {
    return { schemaVersion: 0, records: [] };
  }

  const schemaVersion = packed[0] >>> 0;
  const recordCount = packed[1] >>> 0;

  const records: MotionPlanRecord[] = [];
  let offset = 2;

  for (let i = 0; i < recordCount && offset + 1 < packed.length; i++) {
    const kind = packed[offset] >>> 0;
    const wordCount = packed[offset + 1] >>> 0;

    if (wordCount < 2 || offset + wordCount > packed.length) {
      break;
    }

    switch (kind) {
      case PackedMotionPlanKind.GridPathSet: {
        if (wordCount < 2 + 5) {
          break;
        }
        const unitId = packed[offset + 2] >>> 0;
        const planId = packed[offset + 3] >>> 0;
        const startTick = packed[offset + 4] >>> 0;
        const ticksPerStep = packed[offset + 5] >>> 0;
        const pathLen = packed[offset + 6] >>> 0;

        const expectedWordCount = 2 + 5 + pathLen;
        if (expectedWordCount !== wordCount) {
          break;
        }

        const pathStart = offset + 7;
        const pathEnd = pathStart + pathLen;
        const path = packed.slice(pathStart, pathEnd);

        records.push({
          kind: "grid",
          unitId,
          planId,
          startTick,
          ticksPerStep,
          path,
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

  return { schemaVersion, records };
}
