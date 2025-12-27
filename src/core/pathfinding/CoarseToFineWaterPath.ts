import { GameMap, TileRef } from "../game/GameMap";
import {
  MultiSourceAnyTargetBFS,
  MultiSourceAnyTargetBFSOptions,
  MultiSourceAnyTargetBFSResult,
} from "./MultiSourceAnyTargetBFS";

export type CoarseToFineWaterPathOptions = {
  /**
   * Corridor radius in coarse cells (Chebyshev) around the coarse path.
   * Larger = safer (less likely to miss due to minimap tearing), smaller = faster.
   */
  corridorRadius?: number;
  /**
   * How many corridor attempts to try before falling back to unrestricted fine BFS.
   */
  maxAttempts?: number;
  /**
   * Multiply radius each attempt (e.g. 2 turns 2 -> 4 -> 8 ...).
   */
  radiusMultiplier?: number;
};

const bfsCache = new WeakMap<GameMap, MultiSourceAnyTargetBFS>();
function getBfs(gm: GameMap): MultiSourceAnyTargetBFS {
  const cached = bfsCache.get(gm);
  if (cached) return cached;
  const bfs = new MultiSourceAnyTargetBFS(gm.width() * gm.height());
  bfsCache.set(gm, bfs);
  return bfs;
}

type FineToCoarseMapping = {
  coarse: GameMap;
  fineToCoarse: Uint32Array;
  scaleX: number;
  scaleY: number;
};
const fineToCoarseCache = new WeakMap<GameMap, FineToCoarseMapping>();

function getFineToCoarseMapping(
  fine: GameMap,
  coarse: GameMap,
): FineToCoarseMapping | null {
  const cached = fineToCoarseCache.get(fine);
  if (cached && cached.coarse === coarse) return cached;

  const fw = fine.width();
  const fh = fine.height();
  const cw = coarse.width();
  const ch = coarse.height();

  if (cw <= 0 || ch <= 0) return null;
  if (fw % cw !== 0 || fh % ch !== 0) return null;

  const scaleX = fw / cw;
  const scaleY = fh / ch;
  if (!Number.isInteger(scaleX) || !Number.isInteger(scaleY)) return null;
  if (scaleX <= 0 || scaleY <= 0) return null;

  const fineToCoarse = new Uint32Array(fw * fh);

  // Fill by coarse cell rectangles to avoid division in the inner loop.
  for (let cy = 0; cy < ch; cy++) {
    const fineYStart = cy * scaleY;
    const fineYEnd = fineYStart + scaleY;
    for (let cx = 0; cx < cw; cx++) {
      const coarseRef = cy * cw + cx;
      const fineXStart = cx * scaleX;
      const fineXEnd = fineXStart + scaleX;
      for (let y = fineYStart; y < fineYEnd; y++) {
        let fineRef = y * fw + fineXStart;
        for (let x = fineXStart; x < fineXEnd; x++) {
          fineToCoarse[fineRef++] = coarseRef;
        }
      }
    }
  }

  const entry: FineToCoarseMapping = { coarse, fineToCoarse, scaleX, scaleY };
  fineToCoarseCache.set(fine, entry);
  return entry;
}

type StampSet = { stamp: number; data: Uint32Array };
const stampSetCache = new WeakMap<GameMap, StampSet>();
function getStampSet(gm: GameMap): StampSet {
  const cached = stampSetCache.get(gm);
  if (cached) return cached;
  const set: StampSet = { stamp: 1, data: new Uint32Array(gm.width() * gm.height()) };
  stampSetCache.set(gm, set);
  return set;
}
function nextStamp(set: StampSet): number {
  const next = (set.stamp + 1) >>> 0;
  set.stamp = next === 0 ? 1 : next;
  return set.stamp;
}

function dedupeByStamp(
  tiles: readonly TileRef[],
  stampSet: StampSet,
  stamp: number,
): TileRef[] {
  const out: TileRef[] = [];
  for (const t of tiles) {
    if (t < 0 || t >= stampSet.data.length) continue;
    if (stampSet.data[t] === stamp) continue;
    stampSet.data[t] = stamp;
    out.push(t);
  }
  return out;
}

function markCoarseCorridor(
  coarseWidth: number,
  coarseHeight: number,
  corridorStamp: Uint32Array,
  stamp: number,
  coarsePath: readonly TileRef[],
  radius: number,
) {
  for (const ref of coarsePath) {
    const x = ref % coarseWidth;
    const y = Math.floor(ref / coarseWidth);
    const y0 = Math.max(0, y - radius);
    const y1 = Math.min(coarseHeight - 1, y + radius);
    const x0 = Math.max(0, x - radius);
    const x1 = Math.min(coarseWidth - 1, x + radius);

    for (let yy = y0; yy <= y1; yy++) {
      const row = yy * coarseWidth;
      for (let xx = x0; xx <= x1; xx++) {
        corridorStamp[row + xx] = stamp;
      }
    }
  }
}

export function findWaterPathFromSeedsCoarseToFine(
  fineMap: GameMap,
  seedNodes: readonly TileRef[],
  seedOrigins: readonly TileRef[],
  targets: readonly TileRef[],
  bfsOpts: MultiSourceAnyTargetBFSOptions = {},
  coarseMap: GameMap | null = null,
  coarseToFine: CoarseToFineWaterPathOptions = {},
): MultiSourceAnyTargetBFSResult | null {
  const fineBfs = getBfs(fineMap);

  if (!coarseMap) {
    return fineBfs.findWaterPathFromSeeds(
      fineMap,
      seedNodes,
      seedOrigins,
      targets,
      bfsOpts,
    );
  }

  const mapping = getFineToCoarseMapping(fineMap, coarseMap);
  if (mapping === null) {
    return fineBfs.findWaterPathFromSeeds(
      fineMap,
      seedNodes,
      seedOrigins,
      targets,
      bfsOpts,
    );
  }

  const coarseWidth = coarseMap.width();
  const coarseHeight = coarseMap.height();
  const coarseStampSet = getStampSet(coarseMap);
  const coarseSeedStamp = nextStamp(coarseStampSet);
  const coarseTargetStamp = nextStamp(coarseStampSet);

  const coarseSeedsRaw: TileRef[] = [];
  for (const s of seedNodes) {
    if (s < 0 || s >= mapping.fineToCoarse.length) continue;
    coarseSeedsRaw.push(mapping.fineToCoarse[s] as TileRef);
  }
  const coarseTargetsRaw: TileRef[] = [];
  for (const t of targets) {
    if (t < 0 || t >= mapping.fineToCoarse.length) continue;
    coarseTargetsRaw.push(mapping.fineToCoarse[t] as TileRef);
  }

  const coarseSeeds = dedupeByStamp(
    coarseSeedsRaw,
    coarseStampSet,
    coarseSeedStamp,
  );
  const coarseTargets = dedupeByStamp(
    coarseTargetsRaw,
    coarseStampSet,
    coarseTargetStamp,
  );

  if (coarseSeeds.length === 0 || coarseTargets.length === 0) {
    return fineBfs.findWaterPathFromSeeds(
      fineMap,
      seedNodes,
      seedOrigins,
      targets,
      bfsOpts,
    );
  }

  // Coarse solve (cheap) to define a corridor.
  const coarseBfs = getBfs(coarseMap);
  const coarseResult = coarseBfs.findWaterPath(
    coarseMap,
    coarseSeeds,
    coarseTargets,
    bfsOpts,
  );

  if (coarseResult === null) {
    // Safe fallback: if the coarse map is conservative, we might still have a fine path.
    return fineBfs.findWaterPathFromSeeds(
      fineMap,
      seedNodes,
      seedOrigins,
      targets,
      bfsOpts,
    );
  }

  const corridorRadius0 = Math.max(0, coarseToFine.corridorRadius ?? 2);
  const maxAttempts = Math.max(1, coarseToFine.maxAttempts ?? 2);
  const radiusMultiplier = Math.max(1, coarseToFine.radiusMultiplier ?? 2);

  const corridorSet = getStampSet(coarseMap);
  for (let attempt = 0, radius = corridorRadius0; attempt < maxAttempts; attempt++) {
    const corridorStamp = nextStamp(corridorSet);
    markCoarseCorridor(
      coarseWidth,
      coarseHeight,
      corridorSet.data,
      corridorStamp,
      coarseResult.path,
      radius,
    );

    const refined = fineBfs.findWaterPathFromSeeds(
      fineMap,
      seedNodes,
      seedOrigins,
      targets,
      {
        ...bfsOpts,
        allowedMask: {
          tileToRegion: mapping.fineToCoarse,
          regionStamp: corridorSet.data,
          stamp: corridorStamp,
        },
      },
    );
    if (refined !== null) return refined;

    radius *= radiusMultiplier;
  }

  // Final fallback: unrestricted fine BFS.
  return fineBfs.findWaterPathFromSeeds(
    fineMap,
    seedNodes,
    seedOrigins,
    targets,
    bfsOpts,
  );
}
