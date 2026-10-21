/**
 * FxPass — orchestrates three independent GPU effect sub-passes:
 *   1. FxSpritePass    — animated sprite atlas (explosions, dust, conquest)
 *   2. FxShockwavePass — procedural rings for nuke/SAM events
 *   3. FxAttackRingPass — persistent rings at transport ship targets
 *
 * Spawn events that produce both a sprite and a shockwave (nukes, SAM
 * interceptions) are coordinated here so each sub-pass stays self-contained.
 */

import type { Config } from "@openfront/engine-lib/configuration/Config";
import type {
  AttackRingInput,
  ConquestFx,
  DeadUnitFx,
  RendererConfig,
} from "../../../types";
import type { RenderSettings } from "../../RenderSettings";
import { GLContextLostError } from "../../utils/GlUtils";
import { FxAttackRingPass } from "./FxAttackRingPass";
import { nukeExplosionRadius } from "./FxSettings";
import {
  calculateExplosionDurationMs,
  FxShockwavePass,
} from "./FxShockwavePass";
import { FxSpritePass } from "./FxSpritePass";

export type { AttackRingInput } from "../../../types";
export { calculateExplosionDurationMs };

// What FxPass calls on each sub-pass. A sub-pass whose program fails to build
// is replaced by a no-op of the same shape (see buildOptional).
type SpritePass = Pick<
  FxSpritePass,
  | "spawnFxForUnit"
  | "applyRailroadDust"
  | "applyConquestEvents"
  | "tick"
  | "draw"
  | "setTimeFn"
  | "clear"
  | "dispose"
>;
type ShockwavePass = Pick<
  FxShockwavePass,
  | "pushNukeShockwave"
  | "pushSAMShockwave"
  | "tick"
  | "draw"
  | "setTimeFn"
  | "clear"
  | "dispose"
>;
type AttackRingPass = Pick<
  FxAttackRingPass,
  "update" | "tick" | "draw" | "clear" | "dispose"
>;

const noop = () => {};
const NOOP_SPRITE_PASS: SpritePass = {
  spawnFxForUnit: noop,
  applyRailroadDust: noop,
  applyConquestEvents: noop,
  tick: noop,
  draw: noop,
  setTimeFn: noop,
  clear: noop,
  dispose: noop,
};
const NOOP_SHOCKWAVE_PASS: ShockwavePass = {
  pushNukeShockwave: noop,
  pushSAMShockwave: noop,
  tick: noop,
  draw: noop,
  setTimeFn: noop,
  clear: noop,
  dispose: noop,
};
const NOOP_ATTACK_RING_PASS: AttackRingPass = {
  update: noop,
  tick: noop,
  draw: noop,
  clear: noop,
  dispose: noop,
};

/**
 * Build a cosmetic sub-pass, or fall back to a no-op when its shader program
 * won't compile or link. Some drivers (Adreno 6xx/7xx under ANGLE) reject a
 * program with no info log; a player without explosions can still play, one
 * whose renderer setup threw cannot. The failure is still logged, so
 * telemetry keeps naming the program. A lost context is not a shader problem
 * and nothing else would draw either, so that one still propagates.
 */
function buildOptional<T>(build: () => T, fallback: T): T {
  try {
    return build();
  } catch (e) {
    if (e instanceof GLContextLostError) throw e;
    console.error(e);
    return fallback;
  }
}

export class FxPass {
  private spritePass: SpritePass;
  private shockwavePass: ShockwavePass;
  private attackRingPass: AttackRingPass;
  private mapW: number;
  private settings: RenderSettings;
  private timeFn: () => number = () => performance.now();

  constructor(
    gl: WebGL2RenderingContext,
    header: RendererConfig,
    settings: RenderSettings,
    private config: Config,
  ) {
    this.mapW = header.mapWidth;
    this.settings = settings;
    this.spritePass = buildOptional(
      () => new FxSpritePass(gl, header, settings, config),
      NOOP_SPRITE_PASS,
    );
    this.shockwavePass = buildOptional(
      () => new FxShockwavePass(gl, settings),
      NOOP_SHOCKWAVE_PASS,
    );
    this.attackRingPass = buildOptional(
      () => new FxAttackRingPass(gl, settings),
      NOOP_ATTACK_RING_PASS,
    );
  }

  // -------------------------------------------------------------------------
  // Spawning — coordinated across sub-passes
  // -------------------------------------------------------------------------

  applyDeadUnits(deadUnits: DeadUnitFx[]): void {
    const now = this.timeFn();
    for (const unit of deadUnits) {
      const startMs = now - (unit.tickAge ?? 0) * this.config.msPerTick();
      this.spawnUnit(unit, startMs);
    }
  }

  private spawnUnit(unit: DeadUnitFx, now: number): void {
    const typeName = unit.unitType;
    const x = unit.pos % this.mapW;
    const y = (unit.pos - x) / this.mapW;

    const nukeRadius = nukeExplosionRadius(this.settings.fx, typeName);
    if (nukeRadius !== undefined) {
      if (unit.reachedTarget) {
        this.spritePass.spawnFxForUnit(unit, now);
        this.shockwavePass.pushNukeShockwave(x, y, nukeRadius, unit.explosion);
      } else {
        // SAM interception: sprite pass handles the SAM explosion sprite
        this.spritePass.spawnFxForUnit(unit, now);
        this.shockwavePass.pushSAMShockwave(x, y);
      }
      return;
    }

    // All other units: sprite-only effects
    this.spritePass.spawnFxForUnit(unit, now);
  }

  applyRailroadDust(tileRefs: number[]): void {
    this.spritePass.applyRailroadDust(tileRefs);
  }

  applyConquestEvents(events: ConquestFx[]): void {
    this.spritePass.applyConquestEvents(events);
  }

  updateAttackRings(rings: AttackRingInput[]): void {
    this.attackRingPass.update(rings);
  }

  // -------------------------------------------------------------------------
  // Per-frame
  // -------------------------------------------------------------------------

  tick(): void {
    this.spritePass.tick();
    this.shockwavePass.tick();
    this.attackRingPass.tick();
  }

  draw(cameraMatrix: Float32Array, zoom: number): void {
    this.spritePass.draw(cameraMatrix);
    this.shockwavePass.draw(cameraMatrix);
    this.attackRingPass.draw(cameraMatrix, zoom);
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  setTimeFn(fn: () => number): void {
    this.timeFn = fn;
    this.spritePass.setTimeFn(fn);
    this.shockwavePass.setTimeFn(fn);
  }

  clear(): void {
    this.spritePass.clear();
    this.shockwavePass.clear();
    this.attackRingPass.clear();
  }

  dispose(): void {
    this.spritePass.dispose();
    this.shockwavePass.dispose();
    this.attackRingPass.dispose();
  }
}
