import { MultiSourceAnyTargetBFS } from "../../../src/core/pathfinding/MultiSourceAnyTargetBFS";

type TileRef = number;

function makeGridWaterMap(w: number, h: number, water: boolean[]) {
  const num = w * h;
  if (water.length !== num) throw new Error("bad water array");
  return {
    width: () => w,
    height: () => h,
    x: (ref: TileRef) => ref % w,
    y: (ref: TileRef) => Math.floor(ref / w),
    isWater: (ref: TileRef) => water[ref] === true,
    neighbors: (ref: TileRef) => {
      const out: TileRef[] = [];
      const x = ref % w;
      if (ref >= w) out.push(ref - w);
      if (ref < (h - 1) * w) out.push(ref + w);
      if (x !== 0) out.push(ref - 1);
      if (x !== w - 1) out.push(ref + 1);
      return out;
    },
  } as any;
}

describe("MultiSourceAnyTargetBFS", () => {
  it("returns king-move (Chebyshev) diagonal routes when enabled", () => {
    // 3x3, all water.
    const gm = makeGridWaterMap(3, 3, new Array(9).fill(true));
    const bfs = new MultiSourceAnyTargetBFS(9);

    const res = bfs.findWaterPath(gm, [0], [8], { kingMoves: true });
    expect(res).not.toBeNull();
    expect(res!.path).toEqual([0, 4, 8]);
  });

  it("prevents diagonal corner cutting when enabled", () => {
    // 2x2:
    // S (water)  X (land)
    // X (land)   T (water)
    const gm = makeGridWaterMap(2, 2, [true, false, false, true]);
    const bfs = new MultiSourceAnyTargetBFS(4);

    const blocked = bfs.findWaterPath(gm, [0], [3], {
      kingMoves: true,
      noCornerCutting: true,
    });
    expect(blocked).toBeNull();

    const allowed = bfs.findWaterPath(gm, [0], [3], {
      kingMoves: true,
      noCornerCutting: false,
    });
    expect(allowed).not.toBeNull();
    expect(allowed!.path).toEqual([0, 3]);
  });
});

