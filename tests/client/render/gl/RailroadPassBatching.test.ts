import { afterEach, describe, expect, it, vi } from "vitest";
import { RailroadPass } from "../../../../src/client/render/gl/passes/RailroadPass";
import type { GhostPreviewData } from "../../../../src/client/render/types";

interface RailroadPassHarness {
  pass: RailroadPass;
  gl: {
    TEXTURE0: number;
    TEXTURE4: number;
    TEXTURE_2D: number;
    RED_INTEGER: number;
    UNSIGNED_BYTE: number;
    UNPACK_ROW_LENGTH: number;
    UNPACK_ALIGNMENT: number;
    activeTexture: ReturnType<typeof vi.fn>;
    bindTexture: ReturnType<typeof vi.fn>;
    pixelStorei: ReturnType<typeof vi.fn>;
    texSubImage2D: ReturnType<typeof vi.fn>;
  };
  ghostRailData: Uint8Array;
}

function makeRailroadPassHarness(mapW = 100, mapH = 100): RailroadPassHarness {
  const activeTexture = vi.fn();
  const bindTexture = vi.fn();
  const pixelStorei = vi.fn();
  const texSubImage2D = vi.fn();

  const gl = {
    TEXTURE0: 0x84c0,
    TEXTURE4: 0x84c4,
    TEXTURE_2D: 0x0de1,
    RED_INTEGER: 0x8d94,
    UNSIGNED_BYTE: 0x1401,
    UNPACK_ROW_LENGTH: 0x0cf2,
    UNPACK_ALIGNMENT: 0x0cf5,
    activeTexture,
    bindTexture,
    pixelStorei,
    texSubImage2D,
  };

  const ghostRailData = new Uint8Array(mapW * mapH);
  const pass = Object.create(RailroadPass.prototype) as RailroadPass;
  Object.assign(pass, {
    gl,
    mapW,
    mapH,
    ghostRailTex: {} as WebGLTexture,
    ghostTiles: new Map<number, number>(),
    ghostRailData,
    dirtyMinX: Infinity,
    dirtyMinY: Infinity,
    dirtyMaxX: -Infinity,
    dirtyMaxY: -Infinity,
  });

  return { pass, gl, ghostRailData };
}

function flushGhost(h: RailroadPassHarness): void {
  (h.pass as unknown as { flushGhostOps(): void }).flushGhostOps();
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("RailroadPass Ghost Preview Batching", () => {
  it("batches multiple preview updates into a single texSubImage2D upload", () => {
    const h = makeRailroadPassHarness(100, 100);

    // Simulate 3 mousemove updates before a render frame
    const preview1 = {
      ownerID: 1,
      ghostRailPaths: [[105, 106, 107]], // tiles (5,1), (6,1), (7,1)
      overlappingRailroads: [],
    } as unknown as GhostPreviewData;
    const preview2 = {
      ownerID: 1,
      ghostRailPaths: [[105, 106, 107, 108]], // tiles (5,1)..(8,1)
      overlappingRailroads: [],
    } as unknown as GhostPreviewData;
    const preview3 = {
      ownerID: 1,
      ghostRailPaths: [[205, 206]], // tiles (5,2), (6,2) - clears previous row 1!
      overlappingRailroads: [],
    } as unknown as GhostPreviewData;

    h.pass.updateGhostPreview(preview1);
    h.pass.updateGhostPreview(preview2);
    h.pass.updateGhostPreview(preview3);

    // Call flushGhostOps once (as happens in draw())
    flushGhost(h);

    // INVARIANT 1: Exactly 1 texSubImage2D call
    expect(h.gl.texSubImage2D).toHaveBeenCalledTimes(1);

    // INVARIANT 2: Uses gl.RED_INTEGER (not gl.RED)
    const callArgs = h.gl.texSubImage2D.mock.calls[0];
    expect(callArgs[6]).toBe(h.gl.RED_INTEGER);

    // INVARIANT 3: Bounding box covers both old cleared tiles (x=5..8, y=1) and new tiles (x=5..6, y=2)
    // dirtyMinX = 5, dirtyMinY = 1, dirtyMaxX = 8, dirtyMaxY = 2
    // w = 8 - 5 + 1 = 4, h = 2 - 1 + 1 = 2
    expect(callArgs[2]).toBe(5); // dirtyMinX
    expect(callArgs[3]).toBe(1); // dirtyMinY
    expect(callArgs[4]).toBe(4); // width
    expect(callArgs[5]).toBe(2); // height
    expect(callArgs[9]).toBe(1 * 100 + 5); // offset = y * mapW + x

    // INVARIANT 4: Unpack parameters are set and restored
    expect(h.gl.pixelStorei).toHaveBeenCalledWith(h.gl.UNPACK_ROW_LENGTH, 100);
    expect(h.gl.pixelStorei).toHaveBeenCalledWith(h.gl.UNPACK_ALIGNMENT, 1);
    expect(h.gl.pixelStorei).toHaveBeenCalledWith(h.gl.UNPACK_ROW_LENGTH, 0);
    expect(h.gl.pixelStorei).toHaveBeenCalledWith(h.gl.UNPACK_ALIGNMENT, 4);

    // INVARIANT 5: Active texture is restored to TEXTURE0 on exit
    expect(h.gl.activeTexture).toHaveBeenLastCalledWith(h.gl.TEXTURE0);
  });

  it("does not issue GL calls when there are no dirty ghost tiles", () => {
    const h = makeRailroadPassHarness(100, 100);

    flushGhost(h);

    expect(h.gl.texSubImage2D).not.toHaveBeenCalled();
    expect(h.gl.pixelStorei).not.toHaveBeenCalled();
  });

  it("clears old ghost tiles in CPU mirror when preview is set to null", () => {
    const h = makeRailroadPassHarness(100, 100);

    h.pass.updateGhostPreview({
      ownerID: 1,
      ghostRailPaths: [[105]],
      overlappingRailroads: [],
    } as unknown as GhostPreviewData);
    flushGhost(h);
    expect(h.ghostRailData[105]).toBeGreaterThan(0);

    // Clear preview
    h.pass.updateGhostPreview(null);
    expect(h.ghostRailData[105]).toBe(0);

    flushGhost(h);
    expect(h.gl.texSubImage2D).toHaveBeenCalledTimes(2);
  });

  it("correctly handles extreme map boundary tiles at (0, 0) and (mapW-1, mapH-1)", () => {
    const mapW = 100;
    const mapH = 50;
    const h = makeRailroadPassHarness(mapW, mapH);
    const originTile = 0; // (0, 0)
    const farCornerTile = mapW * mapH - 1; // (99, 49)

    h.pass.updateGhostPreview({
      ownerID: 1,
      ghostRailPaths: [[originTile, farCornerTile]],
      overlappingRailroads: [],
    } as unknown as GhostPreviewData);

    flushGhost(h);

    expect(h.gl.texSubImage2D).toHaveBeenCalledTimes(1);
    const args = h.gl.texSubImage2D.mock.calls[0];
    expect(args[2]).toBe(0); // dirtyMinX
    expect(args[3]).toBe(0); // dirtyMinY
    expect(args[4]).toBe(mapW); // width: 99 - 0 + 1 = 100
    expect(args[5]).toBe(mapH); // height: 49 - 0 + 1 = 50
    expect(args[9]).toBe(0); // offset = 0
  });

  it("correctly handles a single tile at the far corner without buffer overrun", () => {
    const mapW = 200;
    const mapH = 150;
    const h = makeRailroadPassHarness(mapW, mapH);
    const farCornerTile = mapW * mapH - 1; // (199, 149)

    h.pass.updateGhostPreview({
      ownerID: 1,
      ghostRailPaths: [[farCornerTile]],
      overlappingRailroads: [],
    } as unknown as GhostPreviewData);

    flushGhost(h);

    expect(h.gl.texSubImage2D).toHaveBeenCalledTimes(1);
    const args = h.gl.texSubImage2D.mock.calls[0];
    expect(args[2]).toBe(mapW - 1); // 199
    expect(args[3]).toBe(mapH - 1); // 149
    expect(args[4]).toBe(1); // width
    expect(args[5]).toBe(1); // height
    expect(args[9]).toBe((mapH - 1) * mapW + (mapW - 1)); // offset is the exact last element
  });
});
