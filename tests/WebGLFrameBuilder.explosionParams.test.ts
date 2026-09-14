import { describe, expect, it } from "vitest";
import { attributesToExplosionParams } from "../src/client/WebGLFrameBuilder";

describe("attributesToExplosionParams", () => {
  const base = {
    nukeType: "atom" as const,
    colors: ["#ffffff", "#ff8a28"],
    size: 20,
    speed: 5,
    thickness: 1,
    transitionSpeed: 0,
  };

  it("maps embers to embers render params carrying density", () => {
    const p = attributesToExplosionParams({
      ...base,
      type: "embers",
      density: 100,
    });
    expect(p.type).toBe("embers");
    expect((p as { type: "embers"; density: number }).density).toBe(100);
  });

  it("still maps sparkles to sparkles", () => {
    const p = attributesToExplosionParams({
      ...base,
      type: "sparkles",
      density: 7,
    });
    expect(p.type).toBe("sparkles");
  });

  it("maps shockwave to shockwave", () => {
    const p = attributesToExplosionParams({ ...base, type: "shockwave" });
    expect(p.type).toBe("shockwave");
  });

  // Colours are author-configurable per cosmetic: the catalogue's hex list is
  // converted to rgb 0..1 and passed straight through, so changing them in the
  // catalogue recolours the effect. Same path for every explosion style.
  it("passes the cosmetic's colours through (hex -> rgb 0..1) for each style", () => {
    for (const type of ["shockwave", "sparkles", "embers"] as const) {
      const p = attributesToExplosionParams({
        ...base,
        type,
        density: 100,
        colors: ["#ff0000", "#00ff00", "#0000ff"],
      });
      expect(p.colors).toEqual([
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ]);
    }
  });

  it("scales embers by the cosmetic's size the same way as the other styles", () => {
    // size is the final diameter in tiles; maxRadius = size / 2, identical across
    // shockwave/sparkles/embers. Per-bomb sizing is therefore per-cosmetic.
    const embers = attributesToExplosionParams({
      ...base,
      type: "embers",
      density: 100,
      size: 60,
    });
    const shockwave = attributesToExplosionParams({
      ...base,
      type: "shockwave",
      size: 60,
    });
    expect(embers.maxRadius).toBe(30);
    expect(embers.maxRadius).toBe(shockwave.maxRadius);
  });

  it("falls back to the default colour when the list has no valid colours", () => {
    const p = attributesToExplosionParams({
      ...base,
      type: "embers",
      density: 100,
      colors: ["not-a-colour"],
    });
    expect(p.colors.length).toBe(1);
  });
});
