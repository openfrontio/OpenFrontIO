/**
 * BarPass — instanced health/progress bars and warship veterancy pips.
 *
 * Three draw calls per frame (all share one program + instance buffer):
 *   1. Health bars (11x3 tiles, above warships)
 *   2. Progress bars (14x3 tiles, below structures — construction + missile readiness)
 *   3. Veterancy pips (solid gold rank bars stacked at a warship's bottom-right)
 *
 * Data flow:
 *   UnitState.health / .missileTimerQueue / .constructionStartTick → CPU progress
 *   → instance VBO (x, y, progress) → GPU colored rectangle
 *   UnitState.veterancy → one instance per level (x, y, slot) → solid gold rect
 */

import type { Config } from "../../../../core/configuration/Config";
import { UnitType } from "../../../../core/game/Game";
import { maxHealthWithVeterancy } from "../../../../core/game/Veterancy";
import type { RendererConfig, UnitState } from "../../types";
import { UT_MISSILE_SILO, UT_SAM_LAUNCHER } from "../../types";
import type { RenderSettings } from "../RenderSettings";
import { createProgram } from "../utils/GlUtils";

import barFragSrc from "../shaders/bar/bar.frag.glsl?raw";
import barVertSrc from "../shaders/bar/bar.vert.glsl?raw";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FLOATS_PER_INSTANCE = 3; // x, y, progress
const BYTES_PER_INSTANCE = FLOATS_PER_INSTANCE * 4;

// ---------------------------------------------------------------------------
// BarPass
// ---------------------------------------------------------------------------

export class BarPass {
  private gl: WebGL2RenderingContext;
  private settings: RenderSettings;
  private program: WebGLProgram;
  private maxBars = 2048;

  private uCamera: WebGLUniformLocation;
  private uBarSize: WebGLUniformLocation;
  private uBarOffset: WebGLUniformLocation;
  private uBorderWidth: WebGLUniformLocation;
  private uThresholds: WebGLUniformLocation;
  private uColorRed: WebGLUniformLocation;
  private uColorOrange: WebGLUniformLocation;
  private uColorYellow: WebGLUniformLocation;
  private uColorGreen: WebGLUniformLocation;
  private uSolid: WebGLUniformLocation;
  private uSolidColor: WebGLUniformLocation;
  private uPipStride: WebGLUniformLocation;

  private vao: WebGLVertexArrayObject;
  private instanceBuf: WebGLBuffer;

  private healthData: Float32Array;
  private healthCount = 0;
  private progressData: Float32Array;
  private progressCount = 0;
  private veterancyData: Float32Array;
  private veterancyCount = 0;

  private mapW: number;
  private warshipMaxHealth: number;
  private veterancyHealthBonus: number;

  constructor(
    gl: WebGL2RenderingContext,
    header: RendererConfig,
    settings: RenderSettings,
    private config: Config,
  ) {
    this.gl = gl;
    this.settings = settings;
    this.mapW = header.mapWidth;
    this.warshipMaxHealth = config.unitInfo(UnitType.Warship).maxHealth ?? 0;
    this.veterancyHealthBonus = config.warshipVeterancyHealthBonus();

    // --- Shader program ---
    this.program = createProgram(gl, barVertSrc, barFragSrc);
    this.uCamera = gl.getUniformLocation(this.program, "uCamera")!;
    this.uBarSize = gl.getUniformLocation(this.program, "uBarSize")!;
    this.uBarOffset = gl.getUniformLocation(this.program, "uBarOffset")!;
    this.uBorderWidth = gl.getUniformLocation(this.program, "uBorderWidth")!;
    this.uThresholds = gl.getUniformLocation(this.program, "uThresholds")!;
    this.uColorRed = gl.getUniformLocation(this.program, "uColorRed")!;
    this.uColorOrange = gl.getUniformLocation(this.program, "uColorOrange")!;
    this.uColorYellow = gl.getUniformLocation(this.program, "uColorYellow")!;
    this.uColorGreen = gl.getUniformLocation(this.program, "uColorGreen")!;
    this.uSolid = gl.getUniformLocation(this.program, "uSolid")!;
    this.uSolidColor = gl.getUniformLocation(this.program, "uSolidColor")!;
    this.uPipStride = gl.getUniformLocation(this.program, "uPipStride")!;

    // --- Instance data buffers (CPU-side) ---
    this.healthData = new Float32Array(this.maxBars * FLOATS_PER_INSTANCE);
    this.progressData = new Float32Array(this.maxBars * FLOATS_PER_INSTANCE);
    this.veterancyData = new Float32Array(this.maxBars * FLOATS_PER_INSTANCE);

    // --- VAO: unit quad + instanced data ---
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);

    // Quad vertices (2 triangles)
    const quadBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1]),
      gl.STATIC_DRAW,
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    // Instance buffer (dynamic)
    this.instanceBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      this.maxBars * BYTES_PER_INSTANCE,
      gl.DYNAMIC_DRAW,
    );
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, BYTES_PER_INSTANCE, 0);
    gl.vertexAttribDivisor(1, 1);

    gl.bindVertexArray(null);
  }

  /** Rebuild bar instance data from current unit state. */
  updateBars(
    mobileUnits: Map<number, UnitState>,
    structures: Map<number, UnitState>,
    gameTick: number,
  ): void {
    this.healthCount = 0;
    this.progressCount = 0;
    this.veterancyCount = 0;

    // --- Health bars + veterancy pips (warships) ---
    // Only warships carry health among mobile units, so this loop is effectively
    // warship-only.
    for (const unit of mobileUnits.values()) {
      if (unit.health === null || unit.health <= 0) continue;
      // Veteran warships have a higher effective max health, so a full veteran
      // ship reads as full. Shared with the engine's UnitImpl.maxHealth().
      const maxHealth = maxHealthWithVeterancy(
        this.warshipMaxHealth,
        unit.veterancy,
        this.veterancyHealthBonus,
      );
      if (unit.health < maxHealth) {
        this.pushHealth(unit, unit.health / maxHealth);
      }
      if (unit.veterancy > 0) {
        this.pushVeterancy(unit);
      }
    }

    // --- Progress bars (structures) ---
    for (const unit of structures.values()) {
      if (!unit.isActive) continue;
      const progress = this.computeStructureProgress(unit, gameTick);
      if (progress !== null) this.pushProgress(unit, progress);
    }
  }

  /** Render bars. Call once per frame after FX, before names. */
  draw(cameraMat: Float32Array): void {
    if (
      this.healthCount === 0 &&
      this.progressCount === 0 &&
      this.veterancyCount === 0
    )
      return;

    const gl = this.gl;
    const b = this.settings.bar;

    gl.useProgram(this.program);
    gl.uniformMatrix3fv(this.uCamera, false, cameraMat);
    gl.uniform1f(this.uSolid, 0); // health/progress bars use the colored path
    gl.uniform1f(this.uBorderWidth, b.borderWidth);
    gl.uniform3f(this.uThresholds, b.threshold1, b.threshold2, b.threshold3);
    gl.uniform3f(this.uColorRed, b.colorRedR, b.colorRedG, b.colorRedB);
    gl.uniform3f(
      this.uColorOrange,
      b.colorOrangeR,
      b.colorOrangeG,
      b.colorOrangeB,
    );
    gl.uniform3f(
      this.uColorYellow,
      b.colorYellowR,
      b.colorYellowG,
      b.colorYellowB,
    );
    gl.uniform3f(this.uColorGreen, b.colorGreenR, b.colorGreenG, b.colorGreenB);
    gl.bindVertexArray(this.vao);

    // Health bars
    if (this.healthCount > 0) {
      gl.uniform2f(this.uBarSize, b.healthBarW, b.healthBarH);
      gl.uniform2f(this.uBarOffset, -b.healthBarW / 2, b.healthBarOffsetY);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuf);
      gl.bufferSubData(
        gl.ARRAY_BUFFER,
        0,
        this.healthData.subarray(0, this.healthCount * FLOATS_PER_INSTANCE),
      );
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.healthCount);
    }

    // Progress bars
    if (this.progressCount > 0) {
      gl.uniform2f(this.uBarSize, b.progressBarW, b.progressBarH);
      gl.uniform2f(this.uBarOffset, -b.progressBarW / 2, b.progressBarOffsetY);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuf);
      gl.bufferSubData(
        gl.ARRAY_BUFFER,
        0,
        this.progressData.subarray(0, this.progressCount * FLOATS_PER_INSTANCE),
      );
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.progressCount);
    }

    // Veterancy pips (solid gold rank bars, bottom-right of warship sprites)
    if (this.veterancyCount > 0) {
      gl.uniform1f(this.uSolid, 1);
      gl.uniform3f(this.uSolidColor, b.veterancyR, b.veterancyG, b.veterancyB);
      gl.uniform1f(this.uPipStride, b.veterancyPipH + b.veterancyPipGap);
      gl.uniform2f(this.uBarSize, b.veterancyPipW, b.veterancyPipH);
      gl.uniform2f(
        this.uBarOffset,
        b.veterancyPipOffsetX,
        b.veterancyPipOffsetY,
      );
      gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuf);
      gl.bufferSubData(
        gl.ARRAY_BUFFER,
        0,
        this.veterancyData.subarray(
          0,
          this.veterancyCount * FLOATS_PER_INSTANCE,
        ),
      );
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.veterancyCount);
    }

    gl.bindVertexArray(null);
  }

  dispose(): void {
    this.gl.deleteProgram(this.program);
    this.gl.deleteBuffer(this.instanceBuf);
    this.gl.deleteVertexArray(this.vao);
  }

  // ---- Private ----

  private pushHealth(unit: UnitState, progress: number): void {
    if (this.healthCount >= this.maxBars) return;
    const off = this.healthCount * FLOATS_PER_INSTANCE;
    this.healthData[off] = unit.pos % this.mapW;
    this.healthData[off + 1] = (unit.pos - this.healthData[off]) / this.mapW;
    this.healthData[off + 2] = progress;
    this.healthCount++;
  }

  /** Emit one gold pip instance per veterancy level, stacked by slot index. */
  private pushVeterancy(unit: UnitState): void {
    const x = unit.pos % this.mapW;
    const y = (unit.pos - x) / this.mapW;
    for (let slot = 0; slot < unit.veterancy; slot++) {
      if (this.veterancyCount >= this.maxBars) return;
      const off = this.veterancyCount * FLOATS_PER_INSTANCE;
      this.veterancyData[off] = x;
      this.veterancyData[off + 1] = y;
      this.veterancyData[off + 2] = slot; // vertical stack slot, read by the shader
      this.veterancyCount++;
    }
  }

  private pushProgress(unit: UnitState, progress: number): void {
    if (this.progressCount >= this.maxBars) return;
    const off = this.progressCount * FLOATS_PER_INSTANCE;
    const x = unit.pos % this.mapW;
    this.progressData[off] = x;
    this.progressData[off + 1] = (unit.pos - x) / this.mapW;
    this.progressData[off + 2] = progress;
    this.progressCount++;
  }

  private computeStructureProgress(
    unit: UnitState,
    gameTick: number,
  ): number | null {
    // Deletion progress (reverse countdown — takes priority over other bars)
    if (unit.markedForDeletion !== false) {
      const remaining = unit.markedForDeletion - gameTick;
      return Math.max(
        0,
        Math.min(1, remaining / this.config.deletionMarkDuration()),
      );
    }

    // Construction progress
    if (unit.underConstruction && unit.constructionStartTick !== null) {
      const duration =
        this.config.unitInfo(unit.unitType as UnitType).constructionDuration ??
        50;
      const elapsed = gameTick - unit.constructionStartTick;
      return Math.min(1, Math.max(0, elapsed / duration));
    }

    // Missile readiness (Silo / SAM)
    if (
      unit.unitType === UT_MISSILE_SILO ||
      unit.unitType === UT_SAM_LAUNCHER
    ) {
      const readiness = this.missileReadiness(unit, gameTick);
      if (readiness < 1) return readiness;
    }

    return null;
  }

  private missileReadiness(unit: UnitState, gameTick: number): number {
    const maxMissiles = unit.level;
    const reloading = unit.missileTimerQueue.length;
    if (reloading === 0) return 1;

    const ready = maxMissiles - reloading;
    if (ready === 0 && maxMissiles > 1) return 0;

    const cooldown =
      unit.unitType === UT_SAM_LAUNCHER
        ? this.config.SAMCooldown()
        : this.config.SiloCooldown();

    let readiness = ready / maxMissiles;
    for (const timer of unit.missileTimerQueue) {
      const progress = gameTick - timer;
      readiness += progress / cooldown / maxMissiles;
    }
    return Math.max(0, Math.min(1, readiness));
  }
}
