import { GameMap, TileRef } from "../game/GameMap";
import { BezenhamLine } from "../utilities/Line";
import { MultiSourceAnyTargetBFSOptions } from "./MultiSourceAnyTargetBFS";

export type RubberBandPathResult = {
  waypoints: TileRef[];
  path: TileRef[];
};

function sign(n: number): -1 | 0 | 1 {
  return n === 0 ? 0 : n > 0 ? 1 : -1;
}

function lineOfSightWater(
  gm: GameMap,
  from: TileRef,
  to: TileRef,
  noCornerCutting: boolean,
): boolean {
  const w = gm.width();
  const x0 = gm.x(from);
  const y0 = gm.y(from);
  const x1 = gm.x(to);
  const y1 = gm.y(to);

  const line = new BezenhamLine({ x: x0, y: y0 }, { x: x1, y: y1 });

  let prevX = x0;
  let prevY = y0;
  let point = line.increment();
  while (point !== true) {
    const t = point.y * w + point.x;
    if (!gm.isWater(t)) return false;

    if (noCornerCutting) {
      const dx = sign(point.x - prevX);
      const dy = sign(point.y - prevY);
      if (dx !== 0 && dy !== 0) {
        const orthoA = prevY * w + (prevX + dx);
        const orthoB = (prevY + dy) * w + prevX;
        if (!gm.isWater(orthoA) || !gm.isWater(orthoB)) return false;
      }
    }

    prevX = point.x;
    prevY = point.y;
    point = line.increment();
  }

  return gm.isWater(to);
}

function expandLine(gm: GameMap, from: TileRef, to: TileRef, out: TileRef[]) {
  const w = gm.width();
  const x0 = gm.x(from);
  const y0 = gm.y(from);
  const x1 = gm.x(to);
  const y1 = gm.y(to);
  const line = new BezenhamLine({ x: x0, y: y0 }, { x: x1, y: y1 });
  let point = line.increment();
  while (point !== true) {
    const t = point.y * w + point.x;
    if (out.length === 0 || out[out.length - 1] !== t) out.push(t);
    point = line.increment();
  }
  if (out.length === 0 || out[out.length - 1] !== to) out.push(to);
}

/**
 * Reduce "staircase inflation" in the coarse corridor by replacing zig-zaggy coarse paths
 * with a line-of-sight spine, then expanding that spine back into a contiguous coarse-cell list.
 *
 * This is a performance optimization only; correctness is preserved by mask expansion + fine fallback.
 */
export function rubberBandCoarsePath(
  coarseMap: GameMap,
  coarsePath: readonly TileRef[],
  bfsOpts: MultiSourceAnyTargetBFSOptions,
): TileRef[] {
  if (coarsePath.length <= 2) return [...coarsePath];

  const kingMoves = bfsOpts.kingMoves ?? true;
  if (!kingMoves) return [...coarsePath];
  const noCornerCutting = bfsOpts.noCornerCutting ?? true;

  // Keep this bounded: coarse paths can be long on big maps.
  const maxLookahead = 1024;
  const maxChecksPerAnchor = 64;

  const waypoints: TileRef[] = [coarsePath[0]!];
  let i = 0;
  while (i < coarsePath.length - 1) {
    const end = Math.min(coarsePath.length - 1, i + maxLookahead);
    let best = i + 1;
    let checks = 0;
    for (let j = end; j > i; j--) {
      if (lineOfSightWater(coarseMap, coarsePath[i]!, coarsePath[j]!, noCornerCutting)) {
        best = j;
        break;
      }
      if (++checks >= maxChecksPerAnchor) break;
    }
    waypoints.push(coarsePath[best]!);
    i = best;
  }

  const spine: TileRef[] = [];
  for (let k = 0; k < waypoints.length - 1; k++) {
    expandLine(coarseMap, waypoints[k]!, waypoints[k + 1]!, spine);
  }
  return spine.length > 0 ? spine : [...coarsePath];
}

/**
 * "String pulling" / rubber banding for a water-only tile path.
 *
 * Returns both:
 * - `waypoints`: a sparse polyline (for rendering/splines later)
 * - `path`: a tile-valid path expanded along the waypoint segments
 *
 * This is bounded (lookahead + checks per anchor) to keep it hot-path friendly.
 */
export function rubberBandWaterPath(
  gm: GameMap,
  waterPath: readonly TileRef[],
  bfsOpts: MultiSourceAnyTargetBFSOptions,
): RubberBandPathResult {
  if (waterPath.length <= 2) return { waypoints: [...waterPath], path: [...waterPath] };

  const kingMoves = bfsOpts.kingMoves ?? true;
  if (!kingMoves) return { waypoints: [...waterPath], path: [...waterPath] };
  const noCornerCutting = bfsOpts.noCornerCutting ?? true;

  const maxLookahead = 2048;
  const maxChecksPerAnchor = 96;

  const waypoints: TileRef[] = [waterPath[0]!];
  let i = 0;
  while (i < waterPath.length - 1) {
    const end = Math.min(waterPath.length - 1, i + maxLookahead);
    let best = i + 1;
    let checks = 0;
    for (let j = end; j > i; j--) {
      if (lineOfSightWater(gm, waterPath[i]!, waterPath[j]!, noCornerCutting)) {
        best = j;
        break;
      }
      if (++checks >= maxChecksPerAnchor) break;
    }
    waypoints.push(waterPath[best]!);
    i = best;
  }

  const out: TileRef[] = [];
  for (let k = 0; k < waypoints.length - 1; k++) {
    expandLine(gm, waypoints[k]!, waypoints[k + 1]!, out);
  }

  return out.length > 0 ? { waypoints, path: out } : { waypoints: [...waterPath], path: [...waterPath] };
}
