/**
 * Render-side nuke smoothing (UnitPass).
 *
 * `applyMissileSmoothing` lerps each recorded segment's lastPos→pos by
 * wall-clock progress through the current tick and rewrites the missile
 * instance buffer's x/y, leaving the packed per-instance bytes untouched.
 * `flickerHashByte` reproduces (CPU-side) the per-instance flicker phase the
 * vertex shader used to derive from its rendered position.
 *
 * The GL pass is exercised directly via its prototype with stubbed GL calls —
 * the real method runs, only the two WebGL calls it makes are captured.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  flickerHashByte,
  UnitPass,
} from "../../../../src/client/render/gl/passes/UnitPass";

const FLOATS_PER_INSTANCE = 4;
const TICK_MS = 100;

interface SmoothingHarness {
  pass: UnitPass;
  f32: Float32Array;
  bufferSubData: ReturnType<typeof vi.fn>;
}

/**
 * Build a UnitPass instance without its GL-heavy constructor, wiring up only
 * the fields applyMissileSmoothing touches.
 */
function makeSmoothingHarness(
  segs: number[],
  instanceCount: number,
  nowMs: number,
  lastUpdateMs: number,
): SmoothingHarness {
  const f32 = new Float32Array(instanceCount * FLOATS_PER_INSTANCE);
  const bufferSubData = vi.fn();
  const gl = {
    ARRAY_BUFFER: 0x8892,
    bindBuffer: vi.fn(),
    bufferSubData,
  };

  vi.spyOn(performance, "now").mockReturnValue(nowMs);

  const pass = Object.create(UnitPass.prototype) as UnitPass;
  Object.assign(pass, {
    gl,
    smoothSegs: segs,
    missileCount: instanceCount,
    missileBuf: { float32: f32, buffer: {} },
    lastUnitsUpdateMs: lastUpdateMs,
    tickIntervalMs: TICK_MS,
  });

  return { pass, f32, bufferSubData };
}

function runSmoothing(h: SmoothingHarness): void {
  (
    h.pass as unknown as { applyMissileSmoothing(): void }
  ).applyMissileSmoothing();
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("UnitPass.applyMissileSmoothing", () => {
  it("lerps lastPos→pos by wall-clock progress through the tick", () => {
    // instance 2; lastPos (10,20) → pos (30,40); 50ms into a 100ms tick.
    const h = makeSmoothingHarness([2, 10, 20, 30, 40], 5, 1050, 1000);
    runSmoothing(h);

    const off = 2 * FLOATS_PER_INSTANCE;
    expect(h.f32[off + 0]).toBeCloseTo(20); // 10 + (30-10)*0.5
    expect(h.f32[off + 1]).toBeCloseTo(30); // 20 + (40-20)*0.5
  });

  it("sits at lastPos at the start of the tick (alpha 0)", () => {
    const h = makeSmoothingHarness([0, 10, 20, 30, 40], 1, 1000, 1000);
    runSmoothing(h);
    expect(h.f32[0]).toBeCloseTo(10);
    expect(h.f32[1]).toBeCloseTo(20);
  });

  it("clamps alpha to 1 so a stalled tick settles exactly on pos", () => {
    // 200ms elapsed into a 100ms tick → alpha would be 2, clamped to 1.
    const h = makeSmoothingHarness([0, 10, 20, 30, 40], 1, 1200, 1000);
    runSmoothing(h);
    expect(h.f32[0]).toBeCloseTo(30);
    expect(h.f32[1]).toBeCloseTo(40);
  });

  it("writes each segment to its own instance slot and leaves others alone", () => {
    const h = makeSmoothingHarness([1, 0, 0, 8, 16], 3, 1050, 1000);
    // Mark instance 0's slot; it has no segment and must be untouched.
    h.f32[0] = 111;
    h.f32[1] = 222;
    runSmoothing(h);

    expect(h.f32[0]).toBe(111);
    expect(h.f32[1]).toBe(222);
    const off = 1 * FLOATS_PER_INSTANCE;
    expect(h.f32[off + 0]).toBeCloseTo(4); // 0 + 8*0.5
    expect(h.f32[off + 1]).toBeCloseTo(8); // 0 + 16*0.5
  });

  it("overwrites only x/y, preserving the packed ownerID/atlas/flags floats", () => {
    const h = makeSmoothingHarness([0, 10, 20, 30, 40], 1, 1050, 1000);
    h.f32[2] = 999; // ownerID slot
    h.f32[3] = 888; // packed atlasIdx/flags/flickerHash slot
    runSmoothing(h);
    expect(h.f32[2]).toBe(999);
    expect(h.f32[3]).toBe(888);
  });

  it("handles multiple smoothed nukes in one pass", () => {
    const h = makeSmoothingHarness(
      [0, 0, 0, 10, 10, 2, 100, 100, 200, 200],
      3,
      1050,
      1000,
    );
    runSmoothing(h);
    expect(h.f32[0]).toBeCloseTo(5);
    expect(h.f32[1]).toBeCloseTo(5);
    expect(h.f32[2 * FLOATS_PER_INSTANCE + 0]).toBeCloseTo(150);
    expect(h.f32[2 * FLOATS_PER_INSTANCE + 1]).toBeCloseTo(150);
  });

  it("re-uploads exactly the active missile-instance float range", () => {
    const h = makeSmoothingHarness([0, 10, 20, 30, 40], 4, 1050, 1000);
    runSmoothing(h);
    expect(h.bufferSubData).toHaveBeenCalledTimes(1);
    const args = h.bufferSubData.mock.calls[0];
    // gl.bufferSubData(ARRAY_BUFFER, dstOffset, srcData, srcOffset, length)
    expect(args[1]).toBe(0);
    expect(args[3]).toBe(0);
    expect(args[4]).toBe(4 * FLOATS_PER_INSTANCE);
  });

  it("does nothing when there are no smoothed segments", () => {
    const h = makeSmoothingHarness([], 3, 1050, 1000);
    runSmoothing(h);
    expect(h.bufferSubData).not.toHaveBeenCalled();
  });
});

describe("flickerHashByte", () => {
  const fract = (x: number, y: number) => {
    const v = x * 0.1731 + y * 0.3179;
    return v - Math.floor(v);
  };

  it("returns an integer byte in [0, 254]", () => {
    for (const [x, y] of [
      [0, 0],
      [3, 5],
      [40, 80],
      [127, 255],
    ]) {
      const h = flickerHashByte(x, y);
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(254);
    }
  });

  it("is deterministic for a given tile position", () => {
    expect(flickerHashByte(12, 34)).toBe(flickerHashByte(12, 34));
  });

  it("matches the shader's fract(worldX*0.1731 + worldY*0.3179) phase", () => {
    for (const [x, y] of [
      [3, 5],
      [17, 42],
      [80, 9],
    ]) {
      // byte/255 should reproduce the original fract phase to within one step.
      expect(flickerHashByte(x, y) / 255).toBeCloseTo(fract(x, y), 2);
    }
  });
});
