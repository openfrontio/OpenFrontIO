/**
 * Railroad ghost-preview CPU benchmark.
 *
 * Usage:
 *   npx vitest run tests/perf/client/RailroadPreviewPerf.test.ts
 */
import "./Shims";

import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import { RailroadPass } from "../../../src/client/render/gl/passes/RailroadPass";
import type { GhostPreviewData } from "../../../src/client/render/types";

const MAP_WIDTH = 512;
const MAP_HEIGHT = 512;
const FRAMES_PER_SAMPLE = 60;
const SAMPLES = 200;

function makePass(): RailroadPass {
  const pass = Object.create(RailroadPass.prototype) as RailroadPass;
  Object.assign(pass, {
    mapW: MAP_WIDTH,
    mapH: MAP_HEIGHT,
    ghostTiles: new Map<number, number>(),
    ghostOps: [],
    ghostOwnerID: 0,
    lastGhostRailPaths: null,
    lastOverlappingRailroads: null,
  });
  return pass;
}

function makePreview(): GhostPreviewData {
  const paths: number[][] = [];
  for (let pathIndex = 0; pathIndex < 20; pathIndex++) {
    const y = 40 + pathIndex * 8;
    const path: number[] = [];
    for (let x = 40; x < 240; x++) path.push(y * MAP_WIDTH + x);
    paths.push(path);
  }
  return {
    ghostType: "Factory",
    tileX: 100,
    tileY: 100,
    radiusTileX: 100,
    radiusTileY: 100,
    canBuild: true,
    canUpgrade: false,
    cost: 0,
    showCost: false,
    canAfford: true,
    ghostRailPaths: paths,
    overlappingRailroads: [],
    ownerID: 1,
    upgradeTargetTile: null,
    rangeRadius: 110,
    rangeWarning: false,
  };
}

function measureFrames(
  pass: RailroadPass,
  preview: GhostPreviewData,
  forceRebuild: boolean,
): number {
  const internals = pass as unknown as {
    lastGhostRailPaths: GhostPreviewData["ghostRailPaths"] | null;
    lastOverlappingRailroads: GhostPreviewData["overlappingRailroads"] | null;
  };
  const start = performance.now();
  for (let i = 0; i < FRAMES_PER_SAMPLE * SAMPLES; i++) {
    if (forceRebuild) {
      // This reproduces pre-cache behavior while keeping the same immutable
      // arrays and avoiding benchmark-only cloning costs.
      internals.lastGhostRailPaths = null;
      internals.lastOverlappingRailroads = null;
    }
    pass.updateGhostPreview(preview);
  }
  return performance.now() - start;
}

describe("RailroadPass ghost-preview performance", () => {
  it("compares sixty-frame rebuilds with immutable-array cache hits", () => {
    const preview = makePreview();
    const rebuildMs = measureFrames(makePass(), preview, true);
    const cachedMs = measureFrames(makePass(), preview, false);
    const rebuildPer60 = rebuildMs / SAMPLES;
    const cachedPer60 = cachedMs / SAMPLES;
    const differencePercent = ((cachedMs - rebuildMs) / rebuildMs) * 100;

    console.table([
      {
        implementation: "legacy-per-frame-rebuild",
        millisecondsPer60Frames: Number(rebuildPer60.toFixed(3)),
      },
      {
        implementation: "immutable-array-cache",
        millisecondsPer60Frames: Number(cachedPer60.toFixed(3)),
        differencePercent: Number(differencePercent.toFixed(1)),
      },
    ]);

    expect(cachedMs).toBeLessThan(rebuildMs);
  });
});
