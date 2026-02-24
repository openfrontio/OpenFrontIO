import { TileRef } from "./GameMap";

export const MOTION_PLANS_SCHEMA_VERSION = 3;

export enum PackedMotionPlanKind {
  GridPathSet = 1,
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

export type MotionPlanRecord = GridPathPlan;

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
      default:
        // Unknown kind: skip.
        break;
    }

    offset += wordCount;
  }

  return { schemaVersion, records };
}
