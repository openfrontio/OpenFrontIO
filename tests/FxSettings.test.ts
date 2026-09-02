import { describe, expect, test } from "vitest";
import { nukeExplosionRadius } from "../src/client/render/gl/passes/fx-pass/FxSettings";
import { createRenderSettings } from "../src/client/render/gl/RenderSettings";
import {
  UT_ATOM_BOMB,
  UT_HYDROGEN_BOMB,
  UT_MIRV_WARHEAD,
  UT_WARSHIP,
} from "../src/client/render/types";

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
