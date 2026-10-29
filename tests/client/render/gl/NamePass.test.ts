import { describe, expect, it, vi } from "vitest";
import { NamePass } from "../../../../src/client/render/gl/passes/name-pass";
import { FlagAtlasArray } from "../../../../src/client/render/gl/passes/name-pass/FlagAtlasArray";

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
  it("uses the camera-dependent target boost", () => {
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

    // Here the boost is 2, so the cursor remains outside the plate.
    const zoomedMatrix = new Float32Array([0.002, 0, 0, 0, 0.002, 0, 0, 0, 1]);
    expect(pass.hitTestNamePlate(1, zoomedMatrix)).toBe(0);

    // The flag extends the hitbox beyond the name text on the left.
    slot.flagLayerIdx = 0;
    pass.setMouseWorldPos(-150, 200);
    expect(pass.hitTestNamePlate(1, cameraMatrix)).toBe(42);

    // Without a flag, the same position stays outside the plate.
    slot.flagLayerIdx = -1;
    expect(pass.hitTestNamePlate(1, cameraMatrix)).toBe(0);
  });
});

describe("NamePass draw hover-owner forwarding", () => {
  it("forwards the camera matrix and hover owner", () => {
    const nowSpy = vi.spyOn(performance, "now").mockReturnValue(1000);
    try {
      const slot: any = {
        alive: true,
        startTime: 0,
        nameHalfWidth: 50,
        target: true,
        flagLayerIdx: -1,
        emojiAtlasIdx: -1,
      };
      for (const k of ["srcX", "tgtX"]) slot[k] = 100;
      for (const k of ["srcY", "tgtY"]) slot[k] = 200;
      for (const k of ["srcScale", "tgtScale"]) slot[k] = 10;
      slot.static = { smallID: 42, verified: false };

      const textDraw = vi.fn();
      const statusDraw = vi.fn();
      const iconDraw = vi.fn();
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
      const cameraMatrix = new Float32Array([
        0.001, 0, 0, 0, 0.001, 0, 0, 0, 1,
      ]);
      Object.assign(pass, {
        settings: { name, passEnabled: { nameDebug: false } },
        slots: new Map([["p1", slot]]),
        fontBase: 32,
        fontSize: 32,
        textProgram: { ready: true, draw: textDraw },
        statusIconProgram: { draw: statusDraw },
        iconProgram: { draw: iconDraw },
        stringDataDirty: false,
        cursorDataDirty: false,
        playerDataDirty: false,
        vao: {},
        maxPlayers: 1,
        highlightOwnerID: 0,
      });

      pass.setMouseWorldPos(160, 160);
      pass.draw(cameraMatrix, 0.5);

      expect(textDraw.mock.calls[0][0]).toBe(cameraMatrix);
      expect(statusDraw.mock.calls[0][0]).toBe(cameraMatrix);
      expect(iconDraw.mock.calls[0][0]).toBe(cameraMatrix);
      expect(textDraw.mock.calls[0][6]).toBe(42);
      expect(statusDraw.mock.calls[0][3]).toBe(42);
      expect(iconDraw.mock.calls[0][3]).toBe(42);
    } finally {
      nowSpy.mockRestore();
    }
  });
});

describe("FlagAtlasArray disposal", () => {
  it("guards against upload and callbacks when disposed while image is loading", () => {
    let deleted = false;
    const fakeGl: any = {
      MAX_ARRAY_TEXTURE_LAYERS: 256,
      TEXTURE_2D_ARRAY: 0x8c1a,
      RGBA8: 0x8058,
      RGBA: 0x1908,
      UNSIGNED_BYTE: 0x1401,
      getParameter: () => 256,
      createTexture: () => ({}),
      deleteTexture: () => (deleted = true),
      bindTexture: () => {},
      texStorage3D: () => {},
      texParameteri: () => {},
      texSubImage3D: vi.fn(),
      generateMipmap: vi.fn(),
    };
    let onReady = false;
    const atlas = new FlagAtlasArray(fakeGl, () => (onReady = true));
    let onload: (() => void) | undefined;
    vi.stubGlobal(
      "Image",
      class {
        width = 32;
        height = 32;
        set onload(fn: () => void) {
          onload = fn;
        }
      },
    );
    atlas.request("http://example.com/flag.png");
    atlas.dispose();
    expect(deleted).toBe(true);
    onload?.();
    expect(fakeGl.texSubImage3D).not.toHaveBeenCalled();
    expect(onReady).toBe(false);
  });
});
