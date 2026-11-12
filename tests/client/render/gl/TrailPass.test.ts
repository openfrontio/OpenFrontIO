import { describe, expect, it, vi } from "vitest";
import { TrailPass } from "../../../../src/client/render/gl/passes/TrailPass";

function createTrailPass(mapW = 100, mapH = 100) {
  const pass = Object.create(TrailPass.prototype) as any;
  pass.mapW = mapW;
  pass.mapH = mapH;
  pass.dirtyRowMin = Infinity;
  pass.dirtyRowMax = -1;
  pass.trailsDirty = false;
  pass.fullUploadPending = false;
  pass.scatterRowMin = Infinity;
  pass.scatterRowMax = -1;
  pass.liveTrailRef = null;

  let patchCount = 0;
  pass.scatter = {
    push: vi.fn(() => patchCount++),
    clear: vi.fn(() => {
      patchCount = 0;
    }),
    flush: vi.fn(() => {
      patchCount = 0;
    }),
    get count() {
      return patchCount;
    },
  };

  const mockGl = {
    activeTexture: vi.fn(),
    bindTexture: vi.fn(),
    texSubImage2D: vi.fn(),
    TEXTURE0: 0,
    TEXTURE_2D: 1,
    RED_INTEGER: 2,
    UNSIGNED_SHORT: 3,
  };
  pass.gl = mockGl;
  pass.trailTex = {} as any;

  return { pass, mockGl };
}

describe("TrailPass upload management", () => {
  it("accumulates consecutive sparse trail deltas in the scatter queue across ticks", () => {
    const { pass, mockGl } = createTrailPass();
    const trailState = new Uint16Array(100 * 100);

    // Tick 1: sparse update (2 tiles)
    pass.applyLiveDelta(trailState, 10, 20, [15, 25]);
    expect(pass.scatter.count).toBe(2);
    expect(pass.trailsDirty).toBe(true);
    expect(pass.fullUploadPending).toBe(false);
    expect(pass.dirtyRowMax).toBe(-1);

    // Tick 2: second sparse update arrives before flush (3 tiles)
    pass.applyLiveDelta(trailState, 30, 40, [35, 45, 55]);
    expect(pass.scatter.count).toBe(5);
    expect(pass.fullUploadPending).toBe(false);
    expect(pass.dirtyRowMax).toBe(-1);

    // Flush frame: only flushes scatter queue, does NOT upload entire texture
    pass.flushTexture();
    expect(pass.scatter.flush).toHaveBeenCalledTimes(1);
    expect(mockGl.texSubImage2D).not.toHaveBeenCalled();
    expect(pass.trailsDirty).toBe(false);
  });

  it("handles full upload on seek/resync and clears pending scatter queue", () => {
    const { pass, mockGl } = createTrailPass();
    const trailState = new Uint16Array(100 * 100);

    // Sparse delta queued
    pass.applyLiveDelta(trailState, 10, 20, [15, 25]);
    expect(pass.scatter.count).toBe(2);

    // Seek / resync triggers setLiveRef (full upload)
    pass.setLiveRef(trailState);
    expect(pass.scatter.clear).toHaveBeenCalled();
    expect(pass.fullUploadPending).toBe(true);

    // Flush frame executes full upload
    pass.flushTexture();
    expect(mockGl.texSubImage2D).toHaveBeenCalledWith(
      mockGl.TEXTURE_2D,
      0,
      0,
      0,
      100,
      100,
      mockGl.RED_INTEGER,
      mockGl.UNSIGNED_SHORT,
      trailState,
    );
    expect(pass.fullUploadPending).toBe(false);
    expect(pass.trailsDirty).toBe(false);
  });

  it("falls back to row-range upload and clears scatter when delta exceeds threshold", () => {
    const { pass, mockGl } = createTrailPass();
    const trailState = new Uint16Array(100 * 100);

    // Large delta (>= 8192 changed tiles)
    const largeChangedTiles = new Array(8192).fill(0).map((_, i) => i);
    pass.applyLiveDelta(trailState, 10, 50, largeChangedTiles);

    expect(pass.scatter.clear).toHaveBeenCalled();
    expect(pass.dirtyRowMin).toBe(10);
    expect(pass.dirtyRowMax).toBe(50);

    pass.flushTexture();
    expect(mockGl.texSubImage2D).toHaveBeenCalledTimes(1);
    expect(pass.dirtyRowMax).toBe(-1);
  });

  it("merges queued scatter row span into row-range upload when followed by a large delta before flush", () => {
    const { pass, mockGl } = createTrailPass();
    const trailState = new Uint16Array(100 * 100);

    // Tick 1: sparse update in rows 10-20 (tile 1050 is row 10, tile 2050 is row 20 on 100-wide map)
    pass.applyLiveDelta(trailState, 10, 20, [1050, 2050]);
    expect(pass.scatter.count).toBe(2);

    // Tick 2: large delta in rows 50-60 before flush occurs
    const largeChangedTiles = new Array(8192).fill(0).map((_, i) => i + 5000);
    pass.applyLiveDelta(trailState, 50, 60, largeChangedTiles);

    // Scatter is cleared and row range is merged (10 to 60) without full upload
    expect(pass.scatter.clear).toHaveBeenCalled();
    expect(pass.fullUploadPending).toBe(false);
    expect(pass.dirtyRowMin).toBe(10);
    expect(pass.dirtyRowMax).toBe(60);

    pass.flushTexture();
    expect(mockGl.texSubImage2D).toHaveBeenCalledWith(
      mockGl.TEXTURE_2D,
      0,
      0,
      10,
      100,
      51,
      mockGl.RED_INTEGER,
      mockGl.UNSIGNED_SHORT,
      expect.any(Uint16Array),
    );
    expect(pass.fullUploadPending).toBe(false);
  });
});
