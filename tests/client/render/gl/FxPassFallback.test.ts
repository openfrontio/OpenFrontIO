/**
 * FxPass when a sub-pass's shader program fails to build.
 *
 * Some Adreno drivers fail to link FxSpritePass's program with no info log.
 * The sprite FX are cosmetic, so FxPass must still construct (renderer setup
 * goes on) and every call routed to the failed sub-pass must be a no-op,
 * while the sub-passes that did build keep working. A lost context is not a
 * shader problem and still propagates.
 *
 * The sub-pass classes are replaced: only their constructors' outcome matters
 * here, and the real ones need a full WebGL2 context.
 */

import type { Config } from "@openfront/engine-lib/configuration/Config";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RenderSettings } from "../../../../src/client/render/gl/RenderSettings";
import { GLContextLostError } from "../../../../src/client/render/gl/utils/GlUtils";
import type { RendererConfig } from "../../../../src/client/render/types";

const failures = vi.hoisted(() => ({
  sprite: null as Error | null,
  shockwave: null as Error | null,
  attackRing: null as Error | null,
}));
const calls = vi.hoisted(() => [] as string[]);

function recorder(name: string, failure: () => Error | null) {
  return class {
    constructor() {
      const err = failure();
      if (err) throw err;
      return new Proxy(this, {
        get: (_t, method) => () => {
          calls.push(`${name}.${String(method)}`);
        },
      });
    }
  };
}

vi.mock("../../../../src/client/render/gl/passes/fx-pass/FxSpritePass", () => ({
  FxSpritePass: recorder("sprite", () => failures.sprite),
}));
vi.mock(
  "../../../../src/client/render/gl/passes/fx-pass/FxShockwavePass",
  () => ({
    FxShockwavePass: recorder("shockwave", () => failures.shockwave),
    calculateExplosionDurationMs: () => 0,
  }),
);
vi.mock(
  "../../../../src/client/render/gl/passes/fx-pass/FxAttackRingPass",
  () => ({
    FxAttackRingPass: recorder("attackRing", () => failures.attackRing),
  }),
);

const { FxPass } =
  await import("../../../../src/client/render/gl/passes/fx-pass");

const linkError = (name: string) =>
  new Error(
    `Program link error [${name}, GPU: ANGLE (Qualcomm, Adreno (TM) 642, OpenGL ES 3.2)]: (no info log, glGetError=0)`,
  );

function makeFxPass() {
  const settings = {
    fx: { nukeRadiusAtom: 10, nukeRadiusHydro: 20, nukeRadiusMirv: 5 },
  } as unknown as RenderSettings;
  const config = { msPerTick: () => 100 } as unknown as Config;
  const header = { mapWidth: 100 } as unknown as RendererConfig;
  return new FxPass({} as WebGL2RenderingContext, header, settings, config);
}

function exercise(fx: InstanceType<typeof FxPass>) {
  fx.setTimeFn(() => 0);
  fx.applyDeadUnits([
    { unitType: "Atom Bomb", pos: 205, reachedTarget: true, ownerSmallID: 1 },
    { unitType: "Warship", pos: 5, reachedTarget: false, ownerSmallID: 1 },
  ]);
  fx.applyRailroadDust([1, 2]);
  fx.applyConquestEvents([]);
  fx.updateAttackRings([]);
  fx.tick();
  fx.draw(new Float32Array(16), 1);
  fx.clear();
  fx.dispose();
}

describe("FxPass sub-pass fallback", () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    failures.sprite = failures.shockwave = failures.attackRing = null;
    calls.length = 0;
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  it("constructs and keeps the other sub-passes when FxSpritePass fails to link", () => {
    const err = linkError("FxSpritePass");
    failures.sprite = err;

    const fx = makeFxPass();
    expect(() => exercise(fx)).not.toThrow();

    expect(calls.some((c) => c.startsWith("sprite."))).toBe(false);
    expect(calls).toContain("shockwave.pushNukeShockwave");
    expect(calls).toContain("shockwave.draw");
    expect(calls).toContain("attackRing.update");
    expect(calls).toContain("attackRing.draw");
    // Still reported, so telemetry keeps naming the program.
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith(err);
  });

  it("falls back for the shockwave and attack-ring passes too", () => {
    failures.shockwave = linkError("FxShockwavePass");
    failures.attackRing = linkError("FxAttackRingPass");

    const fx = makeFxPass();
    expect(() => exercise(fx)).not.toThrow();

    expect(calls).toContain("sprite.spawnFxForUnit");
    expect(calls).toContain("sprite.draw");
    expect(calls.some((c) => c.startsWith("shockwave."))).toBe(false);
    expect(calls.some((c) => c.startsWith("attackRing."))).toBe(false);
    expect(consoleError).toHaveBeenCalledTimes(2);
  });

  it("still throws on a lost context", () => {
    failures.sprite = new GLContextLostError("link");

    expect(() => makeFxPass()).toThrow(GLContextLostError);
    expect(consoleError).not.toHaveBeenCalled();
  });
});
