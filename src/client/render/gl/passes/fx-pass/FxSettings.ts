/**
 * Pure (no WebGL) helpers that turn the `settings.fx` slice into per-spawn
 * FX parameters. Kept out of the passes so they can be unit-tested and so
 * the debug GUI's live edits have a single place where they take effect.
 */

import {
  DEFAULT_NUKE_EXPLOSION_COLOR,
  MAX_NUKE_EXPLOSION_COLORS,
  UT_ATOM_BOMB,
  UT_HYDROGEN_BOMB,
  UT_MIRV_WARHEAD,
  type NukeExplosionRenderParams,
} from "../../../types";
import type { RenderSettings } from "../../RenderSettings";

type FxSettings = RenderSettings["fx"];

/**
 * Visual explosion radius (shockwave / debris scatter — not the gameplay
 * damage radius) for a detonating unit type, or undefined for non-nukes.
 */
export function nukeExplosionRadius(
  fx: FxSettings,
  unitType: string,
): number | undefined {
  switch (unitType) {
    case UT_ATOM_BOMB:
      return fx.nukeRadiusAtom;
    case UT_HYDROGEN_BOMB:
      return fx.nukeRadiusHydro;
    case UT_MIRV_WARHEAD:
      return fx.nukeRadiusMirv;
    default:
      return undefined;
  }
}

/**
 * The explosion params a detonating nuke should render with: the debug
 * override from `settings.fx.nukeExplosion` when enabled, otherwise the
 * firing player's cosmetic (`undefined` = default look). The override mirrors
 * the cosmetic catalog's attribute shape (size = diameter in world tiles,
 * speed = tiles/s, …) so tuned values can be copied straight into a catalog
 * entry — see `attributesToExplosionParams` in WebGLFrameBuilder.
 */
export function resolveExplosionParams(
  fx: FxSettings,
  cosmetic: NukeExplosionRenderParams | undefined,
): NukeExplosionRenderParams | undefined {
  const o = fx.nukeExplosion;
  if (!o.override) return cosmetic;
  const count = Math.min(
    Math.max(Math.round(o.colorCount), 1),
    MAX_NUKE_EXPLOSION_COLORS,
  );
  const all: (readonly [number, number, number])[] = [
    [o.color0R, o.color0G, o.color0B],
    [o.color1R, o.color1G, o.color1B],
    [o.color2R, o.color2G, o.color2B],
    [o.color3R, o.color3G, o.color3B],
  ];
  const colors = all.slice(0, count);
  const base = {
    colors: colors.length > 0 ? colors : [DEFAULT_NUKE_EXPLOSION_COLOR],
    maxRadius: o.size / 2,
    speed: o.speed,
    thickness: o.thickness,
    transitionSpeed: o.transitionSpeed,
  };
  switch (o.type) {
    case "sparkles":
      return { ...base, type: "sparkles", density: o.density };
    case "embers":
      return { ...base, type: "embers", density: o.density };
    default:
      return { ...base, type: "shockwave" };
  }
}
