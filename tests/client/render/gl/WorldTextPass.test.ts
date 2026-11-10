import { describe, expect, it } from "vitest";
import { CHAR_RANGE } from "../../../../src/client/render/gl/passes/name-pass/Types";
import { WorldTextPass } from "../../../../src/client/render/gl/passes/WorldTextPass";

function createWorldTextPass() {
  const pass = Object.create(WorldTextPass.prototype) as any;
  pass.glyph = {
    advance: new Float32Array(CHAR_RANGE).fill(10),
    xOffset: new Float32Array(CHAR_RANGE).fill(0),
    visW: new Float32Array(CHAR_RANGE).fill(10),
  };
  pass.kernTable = new Int8Array(CHAR_RANGE * CHAR_RANGE);
  pass.charCodes = new Uint8Array(64);
  pass.cursors = new Float32Array(64);
  pass.maxInstances = 256;
  pass.instanceData = new Float32Array(256 * 10);
  pass.active = [];
  pass.attackTroopLabels = [];
  pass.ghostCostLabel = null;
  pass.timeFn = () => 0;
  pass.settings = {
    ghostCost: {
      screenScale: 1,
      screenYOffset: 0,
    },
  };
  return pass;
}

describe("WorldTextPass bounds culling", () => {
  it("culls attack troop labels that are completely outside the camera bounds", () => {
    const pass = createWorldTextPass();
    pass.attackTroopLabels = [
      { x: 50, y: 50, text: "100", colorR: 1, colorG: 1, colorB: 1 },
      { x: 500, y: 500, text: "999", colorR: 1, colorG: 1, colorB: 1 },
    ];

    // Bounds only covering [0, 100] in both dimensions
    const bounds = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
    pass.tick(1.0, bounds);

    // Only label 1 ("100") should have instances generated (3 characters)
    expect(pass.instanceCount).toBe(3);
  });

  it("retains attack troop labels whose screen extent overlaps the bounds boundary", () => {
    const pass = createWorldTextPass();
    // Label center is at 105, just outside bounds maxX=100, but text extends into viewport
    pass.attackTroopLabels = [
      { x: 105, y: 50, text: "5000", colorR: 1, colorG: 1, colorB: 1 },
    ];

    const bounds = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
    pass.tick(1.0, bounds);

    expect(pass.instanceCount).toBe(4);
  });

  it("culls the same text label when positioned completely beyond the extent margin", () => {
    const pass = createWorldTextPass();
    // Same text "5000", but placed at x: 250, well past the extent margin for bounds maxX=100
    pass.attackTroopLabels = [
      { x: 250, y: 50, text: "5000", colorR: 1, colorG: 1, colorB: 1 },
    ];

    const bounds = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
    pass.tick(1.0, bounds);

    expect(pass.instanceCount).toBe(0);
  });

  it("scales culling extent inversely with zoom when zoomed out below 1.0", () => {
    const pass = createWorldTextPass();
    // At zoom 0.5, world-space scale doubles, so an attack label at x: 120 extends further
    pass.attackTroopLabels = [
      { x: 120, y: 50, text: "5000", colorR: 1, colorG: 1, colorB: 1 },
    ];

    const bounds = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
    pass.tick(0.5, bounds);

    expect(pass.instanceCount).toBe(4);
  });

  it("culls popups that are completely outside viewport bounds", () => {
    const pass = createWorldTextPass();
    pass.active = [
      {
        x: 50,
        y: 50,
        text: "+10",
        scale: 1,
        colorR: 1,
        colorG: 1,
        colorB: 1,
        outlineWidth: 1,
        startMs: 0,
        lifetimeMs: 1000,
        riseSpeed: 0,
      },
      {
        x: 1000,
        y: 1000,
        text: "+50",
        scale: 1,
        colorR: 1,
        colorG: 1,
        colorB: 1,
        outlineWidth: 1,
        startMs: 0,
        lifetimeMs: 1000,
        riseSpeed: 0,
      },
    ];

    const bounds = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
    pass.tick(1.0, bounds);

    // Only "+10" (3 characters)
    expect(pass.instanceCount).toBe(3);
  });
});
