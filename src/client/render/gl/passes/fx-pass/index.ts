/**
 * FxPass — orchestrates three independent GPU effect sub-passes:
 *   1. FxSpritePass    — animated sprite atlas (explosions, dust, conquest)
 *   2. FxShockwavePass — procedural rings for nuke/SAM events
 *   3. FxAttackRingPass — persistent rings at transport ship targets
 *
 * Spawn events that produce both a sprite and a shockwave (nukes, SAM
 * interceptions) are coordinated here so each sub-pass stays self-contained.
 */

import type { Config } from "../../../../../core/configuration/Config";
import type {
  AttackRingInput,
  ConquestFx,
  DeadUnitFx,
  RendererConfig,
} from "../../../types";
import type { RenderSettings } from "../../RenderSettings";
import { FxAttackRingPass } from "./FxAttackRingPass";
import { FxShockwavePass } from "./FxShockwavePass";
import { FxSpritePass, NUKE_EXPLOSION_RADII } from "./FxSpritePass";

export type { AttackRingInput } from "../../../types";

export class FxPass {
  private spritePass: FxSpritePass;
  private shockwavePass: FxShockwavePass;
  private attackRingPass: FxAttackRingPass;
  private mapW: number;
  private timeFn: () => number = () => performance.now();

  constructor(
    gl: WebGL2RenderingContext,
    header: RendererConfig,
    settings: RenderSettings,
    private config: Config,
  ) {
    this.mapW = header.mapWidth;
    this.spritePass = new FxSpritePass(gl, header, settings, config);
    this.shockwavePass = new FxShockwavePass(gl, settings);
    this.attackRingPass = new FxAttackRingPass(gl, settings);
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

    const nukeRadius = NUKE_EXPLOSION_RADII[typeName];
    if (nukeRadius !== undefined) {
      if (unit.reachedTarget) {
        this.spritePass.spawnFxForUnit(unit, now);
        this.shockwavePass.pushNukeShockwave(x, y, nukeRadius);
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
