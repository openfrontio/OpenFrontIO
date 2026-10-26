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

    pass.setMouseWorldPos(145, 182);
    expect(pass.hitTestNamePlate(1)).toBe(42);
    slot.static.verified = false;
    expect(pass.hitTestNamePlate(1)).toBe(0);
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
