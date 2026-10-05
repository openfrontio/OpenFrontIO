import { describe, expect, it, vi } from "vitest";
import { RailroadPass } from "../../../../src/client/render/gl/passes/RailroadPass";
import type { GhostPreviewData } from "../../../../src/client/render/types";

function makePass() {
  const computePathOrientations = vi.fn((path: number[]) =>
    path.map((ref) => ({ ref, type: 0 })),
  );
  const pass = Object.create(RailroadPass.prototype) as RailroadPass;
  Object.assign(pass, {
    mapW: 100,
    mapH: 100,
    ghostTiles: new Map<number, number>(),
    ghostOps: [],
    ghostOwnerID: 0,
    lastGhostRailPaths: null,
    lastOverlappingRailroads: null,
    computePathOrientations,
  });
  return { pass, computePathOrientations };
}

function preview(
  ghostRailPaths: number[][],
  overlappingRailroads: number[],
): GhostPreviewData {
  return {
    ghostType: "Factory",
    tileX: 10,
    tileY: 10,
    radiusTileX: 10,
    radiusTileY: 10,
    canBuild: true,
    canUpgrade: false,
    cost: 0,
    showCost: false,
    canAfford: true,
    ghostRailPaths,
    overlappingRailroads,
    ownerID: 1,
    upgradeTargetTile: null,
    rangeRadius: 0,
    rangeWarning: false,
  };
}

describe("RailroadPass ghost preview caching", () => {
  it("skips orientation and diff work when the rail arrays are unchanged", () => {
    const { pass, computePathOrientations } = makePass();
    const paths = [[1, 2, 3]];
    const overlaps = [9];

    pass.updateGhostPreview(preview(paths, overlaps));
    expect(computePathOrientations).toHaveBeenCalledTimes(1);

    // The cursor loop creates a new outer object each frame but preserves the
    // worker result arrays while moving only the structure's screen position.
    pass.updateGhostPreview({
      ...preview(paths, overlaps),
      tileX: 10.25,
      tileY: 10.5,
    });
    expect(computePathOrientations).toHaveBeenCalledTimes(1);

    pass.updateGhostPreview(preview([[1, 2, 3]], overlaps));
    expect(computePathOrientations).toHaveBeenCalledTimes(2);
  });
});
