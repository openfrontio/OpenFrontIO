import { describe, expect, test } from "vitest";
import {
  nukeExplosionRadius,
  resolveExplosionParams,
} from "../src/client/render/gl/passes/fx-pass/FxSettings";
import { createRenderSettings } from "../src/client/render/gl/RenderSettings";
import {
  UT_ATOM_BOMB,
  UT_HYDROGEN_BOMB,
  UT_MIRV_WARHEAD,
  UT_WARSHIP,
  type NukeExplosionRenderParams,
} from "../src/client/render/types";

const cosmetic: NukeExplosionRenderParams = {
  type: "sparkles",
  colors: [[1, 0, 0]],
  maxRadius: 50,
  speed: 80,
  thickness: 2,
  transitionSpeed: 1,
  density: 100,
};

describe("nukeExplosionRadius", () => {
  test("reads the per-bomb radius from settings", () => {
    const fx = createRenderSettings().fx;
    fx.nukeRadiusAtom = 11;
    fx.nukeRadiusHydro = 22;
    fx.nukeRadiusMirv = 33;
    expect(nukeExplosionRadius(fx, UT_ATOM_BOMB)).toBe(11);
    expect(nukeExplosionRadius(fx, UT_HYDROGEN_BOMB)).toBe(22);
    expect(nukeExplosionRadius(fx, UT_MIRV_WARHEAD)).toBe(33);
  });

  test("is undefined for non-nuke units", () => {
    expect(nukeExplosionRadius(createRenderSettings().fx, UT_WARSHIP)).toBe(
      undefined,
    );
  });
});

describe("resolveExplosionParams", () => {
  test("passes the cosmetic through when the override is off", () => {
    const fx = createRenderSettings().fx;
    expect(resolveExplosionParams(fx, cosmetic)).toBe(cosmetic);
    expect(resolveExplosionParams(fx, undefined)).toBe(undefined);
  });

  test("override replaces the cosmetic with catalog-shaped params", () => {
    const fx = createRenderSettings().fx;
    Object.assign(fx.nukeExplosion, {
      override: true,
      type: "embers",
      size: 300,
      speed: 90,
      thickness: 3,
      transitionSpeed: -2,
      density: 40,
      colorCount: 2,
      color0R: 0.1,
      color0G: 0.2,
      color0B: 0.3,
      color1R: 0.4,
      color1G: 0.5,
      color1B: 0.6,
    });
    expect(resolveExplosionParams(fx, cosmetic)).toEqual({
      type: "embers",
      colors: [
        [0.1, 0.2, 0.3],
        [0.4, 0.5, 0.6],
      ],
      maxRadius: 150,
      speed: 90,
      thickness: 3,
      transitionSpeed: -2,
      density: 40,
    });
  });

  test("shockwave type carries no density; color count is clamped to 1..4", () => {
    const fx = createRenderSettings().fx;
    fx.nukeExplosion.override = true;
    fx.nukeExplosion.type = "shockwave";
    fx.nukeExplosion.colorCount = 0;
    const one = resolveExplosionParams(fx, undefined)!;
    expect(one.type).toBe("shockwave");
    expect("density" in one).toBe(false);
    expect(one.colors).toHaveLength(1);

    fx.nukeExplosion.colorCount = 9;
    expect(resolveExplosionParams(fx, undefined)!.colors).toHaveLength(4);
  });
});
