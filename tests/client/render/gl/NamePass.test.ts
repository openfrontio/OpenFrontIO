import { describe, expect, it } from "vitest";
import { NamePass } from "../../../../src/client/render/gl/passes/name-pass";

describe("NamePass verified badge hover", () => {
  it("includes verified badge in nameplate hover bounding box", () => {
    const slot: any = { alive: true, startTime: 0, nameHalfWidth: 50 };
    for (const k of ["srcX", "tgtX"]) slot[k] = 100;
    for (const k of ["srcY", "tgtY"]) slot[k] = 200;
    for (const k of ["srcScale", "tgtScale"]) slot[k] = 10;
    slot.static = { smallID: 42, verified: true };

    const pass = Object.create(NamePass.prototype) as any;
    const name: any = {
      lerpSpeed: 10,
      nameScaleCap: 10,
      troopSizeMultiplier: 0.8,
    };
    name.nameScaleFactor = 1;
    Object.assign(pass, {
      settings: { name },
      slots: new Map([["p1", slot]]),
      fontBase: 32,
      fontSize: 32,
    });

    const cameraMatrix = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    pass.setMouseWorldPos(145, 182);
    expect(pass.hitTestNamePlate(1, cameraMatrix)).toBe(42);
    slot.static.verified = false;
    expect(pass.hitTestNamePlate(1, cameraMatrix)).toBe(0);
  });
});

describe("NamePass targeted nameplate hover", () => {
  it("uses the shader target boost for the hover bounds when zoomed out", () => {
    const slot: any = {
      alive: true,
      startTime: 0,
      nameHalfWidth: 50,
      target: false,
      flagLayerIdx: -1,
      emojiAtlasIdx: -1,
    };
    for (const k of ["srcX", "tgtX"]) slot[k] = 100;
    for (const k of ["srcY", "tgtY"]) slot[k] = 200;
    for (const k of ["srcScale", "tgtScale"]) slot[k] = 10;
    slot.static = { smallID: 42, verified: false };

    const pass = Object.create(NamePass.prototype) as any;
    const name: any = {
      lerpSpeed: 10,
      nameScaleCap: 10,
      nameScaleFactor: 1,
      cullThreshold: 0.1,
      troopSizeMultiplier: 0.8,
      statusRowOffset: 0.6,
      emojiRowOffset: 0.6,
    };
    Object.assign(pass, {
      settings: { name },
      slots: new Map([["p1", slot]]),
      fontBase: 32,
      fontSize: 32,
    });

    const cameraMatrix = new Float32Array([0.001, 0, 0, 0, 0.001, 0, 0, 0, 1]);
    pass.setMouseWorldPos(160, 160);

    // This cursor position is outside the unboosted nameplate bounds.
    expect(pass.hitTestNamePlate(1, cameraMatrix)).toBe(0);

    // Targeting scales the plate to the cull threshold, expanding the bounds.
    slot.target = true;
    expect(pass.hitTestNamePlate(1, cameraMatrix)).toBe(42);
  });
});
