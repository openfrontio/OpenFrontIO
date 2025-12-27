import { findWaterPathFromSeedsCoarseToFine } from "../../../src/core/pathfinding/CoarseToFineWaterPath";

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
  } as any;
}

function coarseCellOfFine(ref: TileRef, fineW: number): number {
  const x = ref % fineW;
  const y = Math.floor(ref / fineW);
  const cx = x >= 4 ? 1 : 0;
  const cy = y >= 4 ? 1 : 0;
  return cy * 2 + cx;
}

describe("findWaterPathFromSeedsCoarseToFine (Option A)", () => {
  it("finds a route inside a tight corridor on all-water maps", () => {
    const fineW = 8;
    const fineH = 8;
    const fine = makeGridWaterMap(fineW, fineH, new Array(64).fill(true));
    const coarse = makeGridWaterMap(2, 2, new Array(4).fill(true));

    const res = findWaterPathFromSeedsCoarseToFine(
      fine,
      [0],
      [0],
      [63],
      { kingMoves: true, noCornerCutting: true },
      coarse,
      { corridorRadius: 0, maxAttempts: 1 },
    );

    expect(res).not.toBeNull();
    // Corridor from coarse path [0,3] at radius 0 only allows coarse cells {0,3}.
    const usedCells = new Set(
      res!.path.map((t) => coarseCellOfFine(t, fineW)),
    );
    expect(Array.from(usedCells).sort()).toEqual([0, 3]);
  });

  it("falls back to unrestricted fine BFS when the corridor is too tight", () => {
    const fineW = 8;
    const fineH = 8;
    const water = new Array(64).fill(true) as boolean[];

    // Block the central no-corner-cutting diagonal from (3,3)->(4,4):
    // it requires both orthogonals (4,3) and (3,4) to be water.
    water[4 + 3 * fineW] = false; // (4,3)
    water[3 + 4 * fineW] = false; // (3,4)

    const fine = makeGridWaterMap(fineW, fineH, water);
    const coarse = makeGridWaterMap(2, 2, new Array(4).fill(true));

    const res = findWaterPathFromSeedsCoarseToFine(
      fine,
      [0],
      [0],
      [63],
      { kingMoves: true, noCornerCutting: true },
      coarse,
      { corridorRadius: 0, maxAttempts: 1 },
    );

    expect(res).not.toBeNull();
    // With the diagonal blocked, any fine path from cell 0 to cell 3 must pass through cell 1 or 2.
    const usedCells = new Set(
      res!.path.map((t) => coarseCellOfFine(t, fineW)),
    );
    expect(usedCells.has(1) || usedCells.has(2)).toBe(true);
  });
});

