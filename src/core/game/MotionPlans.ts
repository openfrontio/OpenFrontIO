import { TileRef } from "./GameMap";

export const MOTION_PLANS_SCHEMA_VERSION = 1;

export enum PackedMotionPlanKind {
  GridPathSet = 1,
  ParabolaSet = 2,
  ClearUnitPlan = 3,
  ResetAllPlans = 4,
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
  path: readonly TileRef[];
  flags?: number;
}

export interface ParabolaPlan {
  kind: "parabola";
  unitId: number;
  planId: number;
  startTick: number;
  src: TileRef;
  dst: TileRef;
  increment: number;
  distanceBasedHeight: boolean;
  directionUp: boolean;
}

export interface ClearUnitPlanRecord {
  kind: "clear";
  unitId: number;
  /**
   * Clear only if the current planId matches. `0` means clear unconditionally.
   */
  planId: number;
}

export interface ResetAllPlansRecord {
  kind: "reset_all";
}

export type MotionPlanRecord =
  | GridPathPlan
  | ParabolaPlan
  | ClearUnitPlanRecord
  | ResetAllPlansRecord;

export function packMotionPlans(records: readonly MotionPlanRecord[]): Uint32Array {
  const out: number[] = [MOTION_PLANS_SCHEMA_VERSION, records.length];

  for (const record of records) {
    switch (record.kind) {
      case "grid": {
        const flags = record.flags ?? 0;
        const pathLen = record.path.length >>> 0;
        const wordCount = 2 + 6 + pathLen;
        out.push(
          PackedMotionPlanKind.GridPathSet,
          wordCount,
          record.unitId >>> 0,
          record.planId >>> 0,
          record.startTick >>> 0,
          record.ticksPerStep >>> 0,
          flags >>> 0,
          pathLen,
        );
        for (let i = 0; i < record.path.length; i++) {
          out.push(record.path[i] >>> 0);
        }
        break;
      }
      case "parabola": {
        const flags =
          (record.distanceBasedHeight ? 1 : 0) |
          (record.directionUp ? 2 : 0);
        const wordCount = 2 + 7;
        out.push(
          PackedMotionPlanKind.ParabolaSet,
          wordCount,
          record.unitId >>> 0,
          record.planId >>> 0,
          record.startTick >>> 0,
          record.src >>> 0,
          record.dst >>> 0,
          record.increment >>> 0,
          flags >>> 0,
        );
        break;
      }
      case "clear": {
        const wordCount = 2 + 2;
        out.push(
          PackedMotionPlanKind.ClearUnitPlan,
          wordCount,
          record.unitId >>> 0,
          record.planId >>> 0,
        );
        break;
      }
      case "reset_all": {
        out.push(PackedMotionPlanKind.ResetAllPlans, 2);
        break;
      }
    }
  }

  return new Uint32Array(out);
}

export function unpackMotionPlans(
  packed: Uint32Array,
): { schemaVersion: number; records: MotionPlanRecord[] } {
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
        if (wordCount < 2 + 6) {
          break;
        }
        const unitId = packed[offset + 2] >>> 0;
        const planId = packed[offset + 3] >>> 0;
        const startTick = packed[offset + 4] >>> 0;
        const ticksPerStep = packed[offset + 5] >>> 0;
        const flags = packed[offset + 6] >>> 0;
        const pathLen = packed[offset + 7] >>> 0;

        const expectedWordCount = 2 + 6 + pathLen;
        if (expectedWordCount !== wordCount) {
          break;
        }

        const pathStart = offset + 8;
        const pathEnd = pathStart + pathLen;
        const path = packed.slice(pathStart, pathEnd) as unknown as TileRef[];

        records.push({
          kind: "grid",
          unitId,
          planId,
          startTick,
          ticksPerStep,
          flags,
          path,
        });
        break;
      }
      case PackedMotionPlanKind.ParabolaSet: {
        if (wordCount !== 2 + 7) {
          break;
        }
        const unitId = packed[offset + 2] >>> 0;
        const planId = packed[offset + 3] >>> 0;
        const startTick = packed[offset + 4] >>> 0;
        const src = packed[offset + 5] as TileRef;
        const dst = packed[offset + 6] as TileRef;
        const increment = packed[offset + 7] >>> 0;
        const flags = packed[offset + 8] >>> 0;

        records.push({
          kind: "parabola",
          unitId,
          planId,
          startTick,
          src,
          dst,
          increment,
          distanceBasedHeight: (flags & 1) !== 0,
          directionUp: (flags & 2) !== 0,
        });
        break;
      }
      case PackedMotionPlanKind.ClearUnitPlan: {
        if (wordCount !== 2 + 2) {
          break;
        }
        const unitId = packed[offset + 2] >>> 0;
        const planId = packed[offset + 3] >>> 0;
        records.push({ kind: "clear", unitId, planId });
        break;
      }
      case PackedMotionPlanKind.ResetAllPlans: {
        if (wordCount !== 2) {
          break;
        }
        records.push({ kind: "reset_all" });
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

