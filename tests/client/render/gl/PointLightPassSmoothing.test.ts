import { afterEach, describe, expect, it, vi } from "vitest";
import { PointLightPass } from "../../../../src/client/render/gl/passes/PointLightPass";

const FLOATS_PER_LIGHT = 6;
const TICK_MS = 100;

interface PointLightSmoothingHarness {
  pass: PointLightPass;
  lightData: Float32Array;
  bufferSubData: ReturnType<typeof vi.fn>;
  bindBuffer: ReturnType<typeof vi.fn>;
}

function makePointLightSmoothingHarness(
  segs: number[],
  lightCount: number,
  nowMs: number,
  lastUpdateMs: number,
): PointLightSmoothingHarness {
  const lightData = new Float32Array(Math.max(lightCount, 16) * FLOATS_PER_LIGHT);
  const bufferSubData = vi.fn();
  const bindBuffer = vi.fn();
  const dummyBuf = {} as WebGLBuffer;
  const gl = {
    ARRAY_BUFFER: 0x8892,
    bindBuffer,
    bufferSubData,
  };

  vi.spyOn(performance, "now").mockReturnValue(nowMs);

  const pass = Object.create(PointLightPass.prototype) as PointLightPass;
  Object.assign(pass, {
    gl,
    smoothSegs: segs,
    lightCount,
    lightBuf: dummyBuf,
    lightData,
    lastUnitsUpdateMs: lastUpdateMs,
    tickIntervalMs: TICK_MS,
  });

  return { pass, lightData, bufferSubData, bindBuffer };
}

function runSmoothing(h: PointLightSmoothingHarness): void {
  (h.pass as unknown as { applySmoothing(): void }).applySmoothing();
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PointLightPass.applySmoothing", () => {
  it("issues exactly 1 buffer upload when multiple smoothed lights are active", () => {
    // 3 active smoothed lights at indices 0, 2, and 4 in a pool of 5 lights
    const segs = [
      0, 10, 20, 30, 40,   // light 0: (10,20) -> (30,40)
      2, 100, 100, 200, 200, // light 2: (100,100) -> (200,200)
      4, 50, 60, 70, 80,    // light 4: (50,60) -> (70,80)
    ];
    const lightCount = 5;
    const h = makePointLightSmoothingHarness(segs, lightCount, 1050, 1000);

    runSmoothing(h);

    // CRITICAL INVARIANT: Exactly 1 bufferSubData upload per frame, not 3
    expect(h.bufferSubData).toHaveBeenCalledTimes(1);
    expect(h.bindBuffer).toHaveBeenCalledTimes(1);

    // Verify 5-argument zero-allocation WebGL2 signature
    expect(h.bufferSubData).toHaveBeenCalledWith(
      0x8892, // ARRAY_BUFFER
      0,      // dstByteOffset
      h.lightData,
      0,      // srcOffset
      lightCount * FLOATS_PER_LIGHT, // length
    );
  });

  it("accurately lerps position coordinates for all active segments", () => {
    // 50ms into a 100ms tick (alpha = 0.5)
    const segs = [
      1, 10, 20, 30, 40,
      3, 100, 200, 300, 400,
    ];
    const h = makePointLightSmoothingHarness(segs, 4, 1050, 1000);

    runSmoothing(h);

    const off1 = 1 * FLOATS_PER_LIGHT;
    expect(h.lightData[off1 + 0]).toBeCloseTo(20); // 10 + 20 * 0.5
    expect(h.lightData[off1 + 1]).toBeCloseTo(30); // 20 + 20 * 0.5

    const off3 = 3 * FLOATS_PER_LIGHT;
    expect(h.lightData[off3 + 0]).toBeCloseTo(200); // 100 + 200 * 0.5
    expect(h.lightData[off3 + 1]).toBeCloseTo(300); // 200 + 200 * 0.5
  });

  it("clamps alpha to 1.0 when tick progress exceeds interval", () => {
    const segs = [0, 10, 20, 30, 40];
    const h = makePointLightSmoothingHarness(segs, 1, 1250, 1000); // 250ms elapsed

    runSmoothing(h);

    expect(h.lightData[0]).toBeCloseTo(30);
    expect(h.lightData[1]).toBeCloseTo(40);
  });

  it("clamps alpha to 0.0 when wall clock is behind last update time", () => {
    const segs = [0, 10, 20, 30, 40];
    const h = makePointLightSmoothingHarness(segs, 1, 950, 1000); // -50ms elapsed (clock skew)

    runSmoothing(h);

    expect(h.lightData[0]).toBeCloseTo(10);
    expect(h.lightData[1]).toBeCloseTo(20);
  });

  it("does not upload when smoothSegs is empty", () => {
    const h = makePointLightSmoothingHarness([], 5, 1050, 1000);

    runSmoothing(h);

    expect(h.bufferSubData).not.toHaveBeenCalled();
    expect(h.bindBuffer).not.toHaveBeenCalled();
  });

  it("does not upload when lightCount is 0", () => {
    const segs = [0, 10, 20, 30, 40];
    const h = makePointLightSmoothingHarness(segs, 0, 1050, 1000);

    runSmoothing(h);

    expect(h.bufferSubData).not.toHaveBeenCalled();
  });
});
