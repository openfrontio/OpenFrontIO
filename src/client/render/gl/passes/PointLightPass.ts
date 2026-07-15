/**
 * PointLightPass — instanced radial-falloff quads for unit/structure lights.
 *
 * Single VBO/VAO: units and structures packed together, uploaded once per tick.
 * draw() is pure GPU: uniforms + one drawArraysInstanced call.
 */

import type { Config } from "src/core/configuration/Config";
import type { RendererConfig, UnitState } from "../../types";
import {
  SMOOTHED_NUKE_TYPES,
  UT_ATOM_BOMB,
  UT_CITY,
  UT_DEFENSE_POST,
  UT_FACTORY,
  UT_HYDROGEN_BOMB,
  UT_MIRV,
  UT_MIRV_WARHEAD,
  UT_MISSILE_SILO,
  UT_PORT,
  UT_SAM_LAUNCHER,
  UT_TRADE_SHIP,
  UT_TRAIN,
  UT_TRANSPORT,
  UT_WARSHIP,
} from "../../types";
import type { RenderSettings } from "../RenderSettings";
import { createProgram, shaderSrc } from "../utils/GlUtils";

import lightFragSrc from "../shaders/day-night/light.frag.glsl?raw";
import lightVertSrc from "../shaders/day-night/light.vert.glsl?raw";

// ---------------------------------------------------------------------------
// Light source configuration
// ---------------------------------------------------------------------------

interface LightConfig {
  r: number;
  g: number;
  b: number;
  radius: number;
  intensity: number;
}

const LIGHT_CONFIGS: Record<string, LightConfig> = {
  [UT_CITY]: { r: 1.0, g: 0.85, b: 0.5, radius: 18, intensity: 1.2 },
  [UT_PORT]: { r: 1.0, g: 0.75, b: 0.4, radius: 12, intensity: 1.0 },
  [UT_FACTORY]: { r: 1.0, g: 0.6, b: 0.3, radius: 12, intensity: 1.0 },
  [UT_DEFENSE_POST]: { r: 0.8, g: 0.85, b: 1.0, radius: 10, intensity: 0.9 },
  [UT_SAM_LAUNCHER]: { r: 0.8, g: 0.85, b: 1.0, radius: 10, intensity: 0.9 },
  [UT_MISSILE_SILO]: { r: 1.0, g: 0.4, b: 0.2, radius: 10, intensity: 0.9 },
  [UT_TRANSPORT]: { r: 0.9, g: 0.8, b: 0.6, radius: 6, intensity: 2.7 },
  [UT_TRADE_SHIP]: { r: 0.9, g: 0.8, b: 0.6, radius: 6, intensity: 2.7 },
  [UT_WARSHIP]: { r: 0.9, g: 0.85, b: 0.7, radius: 10, intensity: 2.8 },
  [UT_ATOM_BOMB]: { r: 1.0, g: 0.9, b: 0.7, radius: 16, intensity: 1.1 },
  [UT_HYDROGEN_BOMB]: { r: 1.0, g: 0.95, b: 0.6, radius: 22, intensity: 1.3 },
  [UT_MIRV]: { r: 1.0, g: 0.9, b: 0.7, radius: 18, intensity: 1.2 },
  [UT_MIRV_WARHEAD]: { r: 1.0, g: 0.6, b: 0.3, radius: 12, intensity: 1.0 },
  // A train is many UT_TRAIN units (engine + tail + carriages) in a line, and
  // lights blend additively — keep per-unit intensity low (~a trade ship's
  // brightness ÷ car count) so the train corridor doesn't blow out.
  [UT_TRAIN]: { r: 1.0, g: 0.85, b: 0.5, radius: 6, intensity: 0.5 },
};

const FLOATS_PER_LIGHT = 6;
const BYTES_PER_LIGHT = FLOATS_PER_LIGHT * 4;
const MAX_LIGHT_TYPES = 64;
const MAX_LIGHTS = 12288; // units + structures combined

/** Values per smoothing segment in the flat `smoothSegs` array:
 *  (lightIdx, lastX, lastY, x, y). Mirrors UnitPass's nuke smoothing so the
 *  light tracks the smoothly-lerped sprite instead of jumping once per tick. */
const SMOOTH_SEG_STRIDE = 5;

export class PointLightPass {
  private gl: WebGL2RenderingContext;
  private settings: RenderSettings;
  private mapW: number;

  // Program + uniforms
  private lightProg: WebGLProgram;
  private uLightCam: WebGLUniformLocation;
  private uRadiusMultiplier: WebGLUniformLocation;
  private uRadiusArr: WebGLUniformLocation;
  private uIntensityArr: WebGLUniformLocation;
  private uFalloffPower: WebGLUniformLocation;

  // Single instance buffer — units + structures packed together
  private lightVao: WebGLVertexArrayObject;
  private lightBuf: WebGLBuffer;
  private lightData: Float32Array;
  private lightCount = 0;

  // Type config
  private typeToIdx = new Map<string, number>();
  private typeConfigs: (LightConfig | undefined)[];
  private typeNames: string[];
  private radiusArr = new Float32Array(MAX_LIGHT_TYPES);
  private intensityArr = new Float32Array(MAX_LIGHT_TYPES);
  private paletteData: Float32Array;

  // Per-frame nuke light smoothing: flat SMOOTH_SEG_STRIDE-wide tuples
  // (lightIdx, lastX, lastY, x, y) recorded each tick, lerped into the light
  // buffer in draw() so the glow tracks the per-frame-smoothed missile sprite.
  private smoothSegs: number[] = [];
  private lastUnitsUpdateMs = 0;
  /** Simulation tick duration in ms (Config.msPerTick). */
  private tickIntervalMs: number;

  constructor(
    gl: WebGL2RenderingContext,
    header: RendererConfig,
    paletteData: Float32Array,
    settings: RenderSettings,
    config: Config,
  ) {
    this.gl = gl;
    this.settings = settings;
    this.paletteData = paletteData;
    this.mapW = header.mapWidth;
    this.tickIntervalMs = config.msPerTick();

    // Build type → light config mapping
    this.typeNames = header.unitTypes;
    this.typeConfigs = new Array(header.unitTypes.length);
    for (let i = 0; i < header.unitTypes.length; i++) {
      this.typeConfigs[i] = LIGHT_CONFIGS[header.unitTypes[i]];
      this.typeToIdx.set(header.unitTypes[i], i);
    }

    // Light program
    this.lightProg = createProgram(
      gl,
      shaderSrc(lightVertSrc, { MAX_LIGHT_TYPES }),
      lightFragSrc,
    );
    this.uLightCam = gl.getUniformLocation(this.lightProg, "uCamera")!;
    this.uRadiusMultiplier = gl.getUniformLocation(
      this.lightProg,
      "uRadiusMultiplier",
    )!;
    this.uRadiusArr = gl.getUniformLocation(this.lightProg, "uRadius")!;
    this.uIntensityArr = gl.getUniformLocation(this.lightProg, "uIntensity")!;
    this.uFalloffPower = gl.getUniformLocation(
      this.lightProg,
      "uFalloffPower",
    )!;

    // Instance buffer + VAO
    this.lightData = new Float32Array(MAX_LIGHTS * FLOATS_PER_LIGHT);
    this.lightBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lightBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.lightData.byteLength, gl.DYNAMIC_DRAW);

    this.lightVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.lightVao);

    // Attribute 0: quad corner [0,1]
    const quadBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([0, 0, 1, 0, 0, 1, 1, 0, 1, 1, 0, 1]),
      gl.STATIC_DRAW,
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    // Attribute 1: per-instance vec3 (x, y, typeIdx)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lightBuf);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, BYTES_PER_LIGHT, 0);
    gl.vertexAttribDivisor(1, 1);

    // Attribute 2: per-instance vec3 (r, g, b)
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 3, gl.FLOAT, false, BYTES_PER_LIGHT, 12);
    gl.vertexAttribDivisor(2, 1);

    gl.bindVertexArray(null);
  }

  /** Pack all light-emitting entities into the instance buffer and upload. Called every tick. */
  updateLights(units: Map<number, UnitState>): void {
    let count = 0;
    this.smoothSegs.length = 0;
    this.lastUnitsUpdateMs = performance.now();

    for (const unit of units.values()) {
      if (!unit.isActive) continue;
      const typeIdx = this.typeToIdx.get(unit.unitType);
      if (typeIdx === undefined) continue;
      const cfg = this.typeConfigs[typeIdx];
      if (!cfg) continue;
      if (count >= MAX_LIGHTS) break;

      const x = unit.pos % this.mapW;
      const y = (unit.pos - x) / this.mapW;
      if (SMOOTHED_NUKE_TYPES.has(unit.unitType) && unit.lastPos !== unit.pos) {
        const lx = unit.lastPos % this.mapW;
        const ly = (unit.lastPos - lx) / this.mapW;
        this.smoothSegs.push(count, lx, ly, x, y);
      }
      const off = count * FLOATS_PER_LIGHT;
      const pOff = unit.ownerID * 4;
      this.lightData[off + 0] = x;
      this.lightData[off + 1] = y;
      this.lightData[off + 2] = typeIdx;
      this.lightData[off + 3] = this.paletteData[pOff];
      this.lightData[off + 4] = this.paletteData[pOff + 1];
      this.lightData[off + 5] = this.paletteData[pOff + 2];
      count++;
    }

    this.lightCount = count;
    if (count > 0) {
      const gl = this.gl;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.lightBuf);
      gl.bufferSubData(
        gl.ARRAY_BUFFER,
        0,
        this.lightData,
        0,
        count * FLOATS_PER_LIGHT,
      );
    }
  }

  /** Lerp smoothed-nuke light positions lastPos→pos by wall-clock progress
   *  through the current tick and re-upload only the affected instances. */
  private applySmoothing(): void {
    const segs = this.smoothSegs;
    if (segs.length === 0) return;
    const alpha = Math.min(
      1,
      (performance.now() - this.lastUnitsUpdateMs) / this.tickIntervalMs,
    );
    const data = this.lightData;
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lightBuf);
    for (let i = 0; i < segs.length; i += SMOOTH_SEG_STRIDE) {
      const idx = segs[i];
      const off = idx * FLOATS_PER_LIGHT;
      data[off + 0] = segs[i + 1] + (segs[i + 3] - segs[i + 1]) * alpha;
      data[off + 1] = segs[i + 2] + (segs[i + 4] - segs[i + 2]) * alpha;
      gl.bufferSubData(gl.ARRAY_BUFFER, idx * BYTES_PER_LIGHT, data, off, 2);
    }
  }

  /**
   * Render instanced point lights into the currently bound FBO.
   * Caller must set up additive blending and viewport.
   */
  draw(cameraMatrix: Float32Array): void {
    if (this.lightCount === 0) return;

    this.applySmoothing();

    const gl = this.gl;
    const dn = this.settings.lighting;

    gl.useProgram(this.lightProg);
    gl.uniformMatrix3fv(this.uLightCam, false, cameraMatrix);
    gl.uniform1f(this.uRadiusMultiplier, dn.lightRadiusMultiplier);
    gl.uniform1f(this.uFalloffPower, dn.falloffPower);

    for (let i = 0; i < this.typeNames.length; i++) {
      const cfg = this.typeConfigs[i];
      if (!cfg) continue;
      const ov = this.settings.lightConfigs[this.typeNames[i]];
      this.radiusArr[i] = ov?.radius ?? cfg.radius;
      this.intensityArr[i] = ov?.intensity ?? cfg.intensity;
    }
    gl.uniform1fv(this.uRadiusArr, this.radiusArr);
    gl.uniform1fv(this.uIntensityArr, this.intensityArr);

    gl.bindVertexArray(this.lightVao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.lightCount);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.lightProg);
    gl.deleteVertexArray(this.lightVao);
    gl.deleteBuffer(this.lightBuf);
  }
}
