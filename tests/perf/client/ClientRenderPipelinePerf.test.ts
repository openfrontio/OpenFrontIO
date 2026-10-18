/**
 * ClientRenderPipelinePerf — Comprehensive WebGL2 & Client Pipeline Performance Benchmark.
 *
 * Benchmarks client-side interaction, generic WebGL2 calls, and rendering passes under Node:
 *   - Generic WebGL2: VBO streaming, dirty texture blits, instanced draw dispatch, uniform/state churn
 *   - Generic Pipeline: Multi-pass composite frame, culling & CPU buffer packing, VAO isolation
 *   - PointLightPass: Dynamic light batching, nuke smoothing lerp, and bufferSubData uploads
 *   - RailroadPass: Dirty-bbox ghost preview, orientation ALU, and texSubImage2D sub-rect uploads
 *   - FxShockwavePass: 22-float ALU layout instance packing and 18-vertex octagon mesh instancing
 *   - BuildPreviewController: Idle cursor diffing bypass, active drag lerp, and Port placement snapping
 *
 * Usage:
 *   npx tsx tests/perf/client/ClientRenderPipelinePerf.ts [--suite=all|webgl2|pipeline|lighting|railroad|shockwave|preview]
 *                                                        [--iterations=500] [--warmup=50] [--json]
 */
import "./Shims";

import type { TileRef } from "@openfront/engine-api/game/GameMap";
import { PlayerType, UnitType } from "@openfront/engine-api/game/GameTypes";
import {
  GameUpdateType,
  type GameUpdateViewData,
  type PlayerUpdate,
} from "@openfront/engine-api/game/GameUpdates";
import type { Config } from "@openfront/engine-lib/configuration/Config";
import { EventBus } from "@openfront/shared/EventBus";
import { BuildPreviewController } from "../../../src/client/controllers/BuildPreviewController";
import type { MapRenderer } from "../../../src/client/render/gl/MapRenderer";
import type { FxShockwavePass as FxShockwavePassType } from "../../../src/client/render/gl/passes/fx-pass/FxShockwavePass";
import type { PointLightPass as PointLightPassType } from "../../../src/client/render/gl/passes/PointLightPass";
import type { RailroadPass as RailroadPassType } from "../../../src/client/render/gl/passes/RailroadPass";
import { createRenderSettings } from "../../../src/client/render/gl/RenderSettings";
import type {
  GhostPreviewData,
  RendererConfig,
  UnitState,
} from "../../../src/client/render/types";
import {
  UT_ATOM_BOMB,
  UT_CITY,
  UT_DEFENSE_POST,
  UT_FACTORY,
  UT_HYDROGEN_BOMB,
  UT_MIRV,
  UT_MISSILE_SILO,
  UT_PORT,
  UT_SAM_LAUNCHER,
  UT_WARSHIP,
} from "../../../src/client/render/types";
import type { TransformHandler } from "../../../src/client/TransformHandler";
import { UserSettings } from "../../../src/client/UserSettings";
import { GameView } from "../../../src/client/view/GameView";
import { setup } from "../../util/Setup";

const { PointLightPass } =
  await import("../../../src/client/render/gl/passes/PointLightPass");
const { RailroadPass } =
  await import("../../../src/client/render/gl/passes/RailroadPass");
const { FxShockwavePass } =
  await import("../../../src/client/render/gl/passes/fx-pass/FxShockwavePass");

// ───────────────────────────────────────────────────────────────────────────
// Telemetry & Instrumented WebGL2 Context
// ───────────────────────────────────────────────────────────────────────────

export interface WebGL2Telemetry {
  bufferSubDataCalls: number;
  bufferSubDataBytes: number;
  bufferDataCalls: number;
  bufferDataBytes: number;
  texSubImage2DCalls: number;
  texSubImage2DPixels: number;
  texSubImage2DBytes: number;
  texImage2DCalls: number;
  texImage2DBytes: number;
  drawArraysCalls: number;
  drawArraysInstancedCalls: number;
  drawElementsCalls: number;
  drawElementsInstancedCalls: number;
  totalVerticesDrawn: number;
  totalInstancesDrawn: number;
  uniformUploadCalls: number;
  stateChanges: number;
}

export interface InstrumentedWebGL2 {
  gl: WebGL2RenderingContext;
  getTelemetry(): WebGL2Telemetry;
  resetTelemetry(): void;
  diffTelemetry(before: WebGL2Telemetry): WebGL2Telemetry;
}

export function createEmptyTelemetry(): WebGL2Telemetry {
  return {
    bufferSubDataCalls: 0,
    bufferSubDataBytes: 0,
    bufferDataCalls: 0,
    bufferDataBytes: 0,
    texSubImage2DCalls: 0,
    texSubImage2DPixels: 0,
    texSubImage2DBytes: 0,
    texImage2DCalls: 0,
    texImage2DBytes: 0,
    drawArraysCalls: 0,
    drawArraysInstancedCalls: 0,
    drawElementsCalls: 0,
    drawElementsInstancedCalls: 0,
    totalVerticesDrawn: 0,
    totalInstancesDrawn: 0,
    uniformUploadCalls: 0,
    stateChanges: 0,
  };
}

function createProgramStubs(telem: WebGL2Telemetry) {
  const dummyProgram = {} as WebGLProgram;
  const dummyShader = {} as WebGLShader;
  return {
    createProgram: () => dummyProgram,
    createShader: () => dummyShader,
    shaderSource: () => {},
    compileShader: () => {},
    getShaderParameter: () => true,
    getShaderInfoLog: () => "",
    attachShader: () => {},
    linkProgram: () => {},
    getProgramParameter: () => true,
    getProgramInfoLog: () => "",
    useProgram: () => {
      telem.stateChanges++;
    },
    deleteShader: () => {},
    deleteProgram: () => {},
  };
}

function calcSubDataBytes(srcData: ArrayBufferView, length?: number): number {
  const elemSize =
    (srcData as ArrayBufferView & { BYTES_PER_ELEMENT?: number })
      .BYTES_PER_ELEMENT ?? 1;
  return length !== undefined ? length * elemSize : srcData.byteLength;
}

function createBufferStubs(telem: WebGL2Telemetry) {
  const dummyBuffer = {} as WebGLBuffer;
  const dummyVao = {} as WebGLVertexArrayObject;
  return {
    createBuffer: () => dummyBuffer,
    bindBuffer: () => {
      telem.stateChanges++;
    },
    bufferData: (_target: number, dataOrSize: BufferSource | number) => {
      telem.bufferDataCalls++;
      telem.bufferDataBytes +=
        typeof dataOrSize === "number" ? dataOrSize : dataOrSize.byteLength;
    },
    bufferSubData: (
      _target: number,
      _dstOffset: number,
      srcData: ArrayBufferView,
      _srcOffset?: number,
      length?: number,
    ) => {
      telem.bufferSubDataCalls++;
      telem.bufferSubDataBytes += calcSubDataBytes(srcData, length);
    },
    deleteBuffer: () => {},
    createVertexArray: () => dummyVao,
    bindVertexArray: () => {
      telem.stateChanges++;
    },
    enableVertexAttribArray: () => {},
    disableVertexAttribArray: () => {},
    vertexAttribPointer: () => {},
    vertexAttribIPointer: () => {},
    vertexAttribDivisor: () => {},
    deleteVertexArray: () => {},
  };
}

function calcTexBytes(
  w: number,
  h: number,
  format?: number,
  pixels?: ArrayBufferView | null,
): number {
  if (pixels && pixels.byteLength) return pixels.byteLength;
  const bpp =
    format === 0x8d94 /* RED_INTEGER */ || format === 0x1902 /* DEPTH */
      ? 1
      : 4;
  return w * h * bpp;
}

function createTextureStubs(telem: WebGL2Telemetry) {
  const dummyTexture = {} as WebGLTexture;
  return {
    createTexture: () => dummyTexture,
    bindTexture: () => {
      telem.stateChanges++;
    },
    activeTexture: () => {
      telem.stateChanges++;
    },
    texParameteri: () => {},
    texImage2D: (
      _t: number,
      _l: number,
      _intFmt: number,
      w: number,
      h: number,
      _b: number,
      fmt: number,
      _type: number,
      pix?: ArrayBufferView | null,
    ) => {
      telem.texImage2DCalls++;
      telem.texImage2DBytes += calcTexBytes(w, h, fmt, pix);
    },
    texSubImage2D: (
      _t: number,
      _l: number,
      _x: number,
      _y: number,
      w: number,
      h: number,
      fmt?: number,
      _type?: number,
      pix?: ArrayBufferView,
    ) => {
      telem.texSubImage2DCalls++;
      telem.texSubImage2DPixels += w * h;
      telem.texSubImage2DBytes += calcTexBytes(w, h, fmt, pix);
    },
    deleteTexture: () => {},
    pixelStorei: () => {},
    generateMipmap: () => {},
  };
}

function createUniformStubs(telem: WebGL2Telemetry) {
  const dummyLocation = {} as WebGLUniformLocation;
  const bump = () => {
    telem.uniformUploadCalls++;
  };
  return {
    getUniformLocation: () => dummyLocation,
    getAttribLocation: () => 0,
    uniform1i: bump,
    uniform1f: bump,
    uniform2f: bump,
    uniform3f: bump,
    uniform4f: bump,
    uniform1fv: bump,
    uniform2fv: bump,
    uniform3fv: bump,
    uniform4fv: bump,
    uniform1iv: bump,
    uniform2iv: bump,
    uniform3iv: bump,
    uniform4iv: bump,
    uniformMatrix3fv: bump,
    uniformMatrix4fv: bump,
  };
}

function createDrawStubs(telem: WebGL2Telemetry) {
  return {
    drawArrays: (_mode: number, _first: number, count: number) => {
      telem.drawArraysCalls++;
      telem.totalVerticesDrawn += count;
    },
    drawArraysInstanced: (
      _mode: number,
      _first: number,
      count: number,
      instanceCount: number,
    ) => {
      telem.drawArraysInstancedCalls++;
      telem.totalInstancesDrawn += instanceCount;
      telem.totalVerticesDrawn += count * instanceCount;
    },
    drawElements: (
      _mode: number,
      count: number,
      _type: number,
      _offset: number,
    ) => {
      telem.drawElementsCalls++;
      telem.totalVerticesDrawn += count;
    },
    drawElementsInstanced: (
      _mode: number,
      count: number,
      _type: number,
      _offset: number,
      instanceCount: number,
    ) => {
      telem.drawElementsInstancedCalls++;
      telem.totalInstancesDrawn += instanceCount;
      telem.totalVerticesDrawn += count * instanceCount;
    },
  };
}

function createStateStubs(telem: WebGL2Telemetry) {
  return {
    enable: () => {
      telem.stateChanges++;
    },
    disable: () => {
      telem.stateChanges++;
    },
    blendFunc: () => {
      telem.stateChanges++;
    },
    blendFuncSeparate: () => {
      telem.stateChanges++;
    },
    blendEquation: () => {
      telem.stateChanges++;
    },
    depthMask: () => {},
    depthFunc: () => {},
    viewport: () => {},
    scissor: () => {},
    clear: () => {},
    clearColor: () => {},
    clearDepth: () => {},
    isContextLost: () => false,
    getError: () => 0,
    getExtension: () => null,
  };
}

function getWebGL2Constants() {
  return {
    ARRAY_BUFFER: 0x8892,
    ELEMENT_ARRAY_BUFFER: 0x8893,
    STATIC_DRAW: 0x88e4,
    DYNAMIC_DRAW: 0x88e8,
    STREAM_DRAW: 0x88e0,
    FLOAT: 0x1406,
    UNSIGNED_SHORT: 0x1403,
    UNSIGNED_INT: 0x1405,
    UNSIGNED_BYTE: 0x1401,
    BYTE: 0x1400,
    SHORT: 0x1402,
    INT: 0x1404,
    TRIANGLES: 0x0004,
    TRIANGLE_STRIP: 0x0005,
    POINTS: 0x0000,
    LINES: 0x0001,
    LINE_STRIP: 0x0003,
    VERTEX_SHADER: 0x8b31,
    FRAGMENT_SHADER: 0x8b30,
    COMPILE_STATUS: 0x8b81,
    LINK_STATUS: 0x8b82,
    TEXTURE_2D: 0x0de1,
    TEXTURE0: 0x84c0,
    TEXTURE1: 0x84c1,
    TEXTURE2: 0x84c2,
    TEXTURE3: 0x84c3,
    TEXTURE4: 0x84c4,
    TEXTURE5: 0x84c5,
    TEXTURE6: 0x84c6,
    TEXTURE7: 0x84c7,
    NEAREST: 0x2600,
    LINEAR: 0x2601,
    CLAMP_TO_EDGE: 0x812f,
    REPEAT: 0x2901,
    TEXTURE_MIN_FILTER: 0x2801,
    TEXTURE_MAG_FILTER: 0x2800,
    TEXTURE_WRAP_S: 0x2802,
    TEXTURE_WRAP_T: 0x2803,
    RED_INTEGER: 0x8d94,
    R8UI: 0x8232,
    RGBA: 0x1908,
    RGBA8: 0x8058,
    BLEND: 0x0be2,
    DEPTH_TEST: 0x0b71,
    ONE: 1,
    ZERO: 0,
    SRC_ALPHA: 0x0302,
    ONE_MINUS_SRC_ALPHA: 0x0303,
    COLOR_BUFFER_BIT: 0x4000,
    DEPTH_BUFFER_BIT: 0x0100,
    UNPACK_ALIGNMENT: 0x0cf5,
    UNPACK_ROW_LENGTH: 0x0cf2,
  };
}

export function createInstrumentedWebGL2Context(): InstrumentedWebGL2 {
  const telem = createEmptyTelemetry();
  const gl = {
    ...getWebGL2Constants(),
    drawingBufferWidth: 1920,
    drawingBufferHeight: 1080,
    canvas: { width: 1920, height: 1080 },
    ...createProgramStubs(telem),
    ...createBufferStubs(telem),
    ...createTextureStubs(telem),
    ...createUniformStubs(telem),
    ...createDrawStubs(telem),
    ...createStateStubs(telem),
  } as unknown as WebGL2RenderingContext;

  return {
    gl,
    getTelemetry: () => ({ ...telem }),
    resetTelemetry: () => {
      Object.assign(telem, createEmptyTelemetry());
    },
    diffTelemetry: (b: WebGL2Telemetry) => ({
      bufferSubDataCalls: telem.bufferSubDataCalls - b.bufferSubDataCalls,
      bufferSubDataBytes: telem.bufferSubDataBytes - b.bufferSubDataBytes,
      bufferDataCalls: telem.bufferDataCalls - b.bufferDataCalls,
      bufferDataBytes: telem.bufferDataBytes - b.bufferDataBytes,
      texSubImage2DCalls: telem.texSubImage2DCalls - b.texSubImage2DCalls,
      texSubImage2DPixels: telem.texSubImage2DPixels - b.texSubImage2DPixels,
      texSubImage2DBytes: telem.texSubImage2DBytes - b.texSubImage2DBytes,
      texImage2DCalls: telem.texImage2DCalls - b.texImage2DCalls,
      texImage2DBytes: telem.texImage2DBytes - b.texImage2DBytes,
      drawArraysCalls: telem.drawArraysCalls - b.drawArraysCalls,
      drawArraysInstancedCalls:
        telem.drawArraysInstancedCalls - b.drawArraysInstancedCalls,
      drawElementsCalls: telem.drawElementsCalls - b.drawElementsCalls,
      drawElementsInstancedCalls:
        telem.drawElementsInstancedCalls - b.drawElementsInstancedCalls,
      totalVerticesDrawn: telem.totalVerticesDrawn - b.totalVerticesDrawn,
      totalInstancesDrawn: telem.totalInstancesDrawn - b.totalInstancesDrawn,
      uniformUploadCalls: telem.uniformUploadCalls - b.uniformUploadCalls,
      stateChanges: telem.stateChanges - b.stateChanges,
    }),
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Benchmark Harness & Statistics
// ───────────────────────────────────────────────────────────────────────────

export interface BenchmarkResult {
  name: string;
  suite: string;
  iterations: number;
  totalMs: number;
  meanMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  opsPerSec: number;
  heapDeltaMB: number;
  telemetry: WebGL2Telemetry;
}

export interface BenchmarkOptions {
  suite:
    | "all"
    | "webgl2"
    | "pipeline"
    | "lighting"
    | "railroad"
    | "shockwave"
    | "preview";
  iterations: number;
  warmup: number;
  quiet?: boolean;
}

function computePercentile(sorted: number[], p: number): number {
  const index = Math.min(Math.floor(sorted.length * p), sorted.length - 1);
  return sorted[index] ?? 0;
}

export function runBenchmark(
  name: string,
  suite: string,
  fn: () => void,
  iterations: number,
  warmup: number,
  instGl?: InstrumentedWebGL2,
): BenchmarkResult {
  for (let i = 0; i < warmup; i++) fn();

  if (instGl) instGl.resetTelemetry();
  const startHeap = process.memoryUsage().heapUsed;
  const samples: number[] = new Array(iterations);
  const t0 = performance.now();

  for (let i = 0; i < iterations; i++) {
    const s0 = performance.now();
    fn();
    samples[i] = performance.now() - s0;
  }

  const totalMs = performance.now() - t0;
  const heapDeltaMB =
    (process.memoryUsage().heapUsed - startHeap) / (1024 * 1024);
  samples.sort((a, b) => a - b);

  return {
    name,
    suite,
    iterations,
    totalMs,
    meanMs: totalMs / iterations,
    p50Ms: computePercentile(samples, 0.5),
    p95Ms: computePercentile(samples, 0.95),
    p99Ms: computePercentile(samples, 0.99),
    opsPerSec: (iterations / Math.max(totalMs, 0.0001)) * 1000,
    heapDeltaMB,
    telemetry: instGl ? instGl.getTelemetry() : createEmptyTelemetry(),
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Sub-Suite 1: Generic WebGL2 Low-Level Operations
// ───────────────────────────────────────────────────────────────────────────

export function runGenericWebGL2Suite(
  opts: BenchmarkOptions,
): BenchmarkResult[] {
  const results: BenchmarkResult[] = [];
  const instGl = createInstrumentedWebGL2Context();
  const gl = instGl.gl;
  const vbo = gl.createBuffer()!;
  const tex = gl.createTexture()!;
  const vao = gl.createVertexArray()!;
  const prog = gl.createProgram()!;
  const uMat = gl.getUniformLocation(prog, "uMat")!;

  const subBuf64K = new Float32Array(16384).fill(1.5);
  results.push(
    runBenchmark(
      "Generic VBO Streaming (64KB sub-buffer chunks)",
      "webgl2",
      () => {
        gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, subBuf64K);
      },
      opts.iterations,
      opts.warmup,
      instGl,
    ),
  );

  results.push(
    runBenchmark(
      "Generic VBO Allocation Churn (bufferData realloc)",
      "webgl2",
      () => {
        gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
        gl.bufferData(gl.ARRAY_BUFFER, 65536, gl.DYNAMIC_DRAW);
      },
      opts.iterations,
      opts.warmup,
      instGl,
    ),
  );

  const tilePixels = new Uint8Array(256 * 256 * 4);
  results.push(
    runBenchmark(
      "Generic Dirty Texture Blit (256x256 texSubImage2D)",
      "webgl2",
      () => {
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texSubImage2D(
          gl.TEXTURE_2D,
          0,
          0,
          0,
          256,
          256,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          tilePixels,
        );
      },
      opts.iterations,
      opts.warmup,
      instGl,
    ),
  );

  results.push(
    runBenchmark(
      "Generic Instanced Draw Dispatch (1,000 instances)",
      "webgl2",
      () => {
        gl.bindVertexArray(vao);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, 1000);
      },
      opts.iterations,
      opts.warmup,
      instGl,
    ),
  );

  const mat3 = new Float32Array(9);
  results.push(
    runBenchmark(
      "Generic State & Uniform Switching",
      "webgl2",
      () => {
        gl.useProgram(prog);
        gl.uniformMatrix3fv(uMat, false, mat3);
        gl.uniform4f(uMat, 1.0, 0.5, 0.2, 1.0);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.bindVertexArray(vao);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      },
      opts.iterations,
      opts.warmup,
      instGl,
    ),
  );

  return results;
}

// ───────────────────────────────────────────────────────────────────────────
// Sub-Suite 2: Generic Multi-Pass Pipeline Architecture
// ───────────────────────────────────────────────────────────────────────────

export interface PipelinePass {
  name: string;
  cullAndPack(count: number): number;
  upload(gl: WebGL2RenderingContext): void;
  draw(gl: WebGL2RenderingContext, camMatrix: Float32Array): void;
}

function createGenericMockPasses(gl: WebGL2RenderingContext): PipelinePass[] {
  const vbo = gl.createBuffer()!;
  const vao = gl.createVertexArray()!;
  const tex = gl.createTexture()!;
  const packedFloats = new Float32Array(2048 * 8);

  const dummyTexBytes = new Uint8Array(64 * 64 * 4);

  const terrainPass: PipelinePass = {
    name: "TerrainBackgroundPass",
    cullAndPack: () => 1,
    upload: (g) => {
      g.bindTexture(g.TEXTURE_2D, tex);
      g.texSubImage2D(
        g.TEXTURE_2D,
        0,
        0,
        0,
        64,
        64,
        g.RGBA,
        g.UNSIGNED_BYTE,
        dummyTexBytes,
      );
    },
    draw: (g) => {
      g.bindVertexArray(vao);
      g.drawArrays(g.TRIANGLES, 0, 6);
    },
  };

  const dynamicEntityPass: PipelinePass = {
    name: "DynamicEntityPass",
    cullAndPack: (count) => {
      const active = Math.min(count, 2048);
      for (let i = 0; i < active * 8; i++) packedFloats[i] = i * 0.1;
      return active;
    },
    upload: (g) => {
      g.bindBuffer(g.ARRAY_BUFFER, vbo);
      g.bufferSubData(g.ARRAY_BUFFER, 0, packedFloats);
    },
    draw: (g) => {
      g.bindVertexArray(vao);
      g.drawArraysInstanced(g.TRIANGLES, 0, 6, 500);
    },
  };

  const particlePass: PipelinePass = {
    name: "ParticleFxPass",
    cullAndPack: () => 120,
    upload: (g) => {
      g.bindBuffer(g.ARRAY_BUFFER, vbo);
      g.bufferSubData(g.ARRAY_BUFFER, 0, packedFloats, 0, 120 * 8);
    },
    draw: (g) => {
      g.bindVertexArray(vao);
      g.drawArraysInstanced(g.TRIANGLES, 0, 18, 120);
    },
  };

  return [terrainPass, dynamicEntityPass, particlePass];
}

export function runGenericPipelineSuite(
  opts: BenchmarkOptions,
): BenchmarkResult[] {
  const results: BenchmarkResult[] = [];
  const instGl = createInstrumentedWebGL2Context();
  const passes = createGenericMockPasses(instGl.gl);
  const camMatrix = new Float32Array(9);

  results.push(
    runBenchmark(
      "Generic Multi-Pass Pipeline Composite Frame",
      "pipeline",
      () => {
        for (const pass of passes) {
          pass.cullAndPack(500);
          pass.upload(instGl.gl);
          pass.draw(instGl.gl, camMatrix);
        }
      },
      opts.iterations,
      opts.warmup,
      instGl,
    ),
  );

  const packBuffer = new Float32Array(2000 * 8);
  results.push(
    runBenchmark(
      "Generic Pass Culling & Instance Buffer Packing",
      "pipeline",
      () => {
        let valid = 0;
        for (let i = 0; i < 2000; i++) {
          if (i % 3 !== 0) {
            const off = valid * 8;
            packBuffer[off + 0] = i;
            packBuffer[off + 1] = i * 2;
            packBuffer[off + 2] = 1.0;
            valid++;
          }
        }
      },
      opts.iterations,
      opts.warmup,
      instGl,
    ),
  );

  return results;
}

// ───────────────────────────────────────────────────────────────────────────
// Sub-Suite 3: PointLightPass Dynamic Light Batching
// ───────────────────────────────────────────────────────────────────────────

function createDummyUnitState(
  id: number,
  type: string,
  pos: number,
  lastPos: number,
): UnitState {
  return {
    id,
    unitType: type,
    ownerID: 1,
    lastOwnerID: null,
    pos,
    lastPos,
    isActive: true,
    reachedTarget: false,
    retreating: false,
    targetable: true,
    waitTicks: 0,
    markedForDeletion: false,
    health: null,
    underConstruction: false,
    targetUnitId: null,
    targetTile: null,
    troops: 10,
    missileTimerQueue: [],
    level: 1,
    veterancy: 0,
    hasTrainStation: false,
    trainType: null,
    loaded: null,
    constructionStartTick: null,
    samUpgradeStartTick: null,
    samUpgradeStartRange: null,
    samUpgradeTargetLevel: null,
    samUpgradeDuration: null,
  };
}

function buildLightUnitMap(
  count: number,
  withSmoothedNukes: boolean,
): Map<number, UnitState> {
  const units = new Map<number, UnitState>();
  const types = [
    UT_CITY,
    UT_FACTORY,
    UT_DEFENSE_POST,
    UT_SAM_LAUNCHER,
    UT_WARSHIP,
  ];
  for (let i = 0; i < count; i++) {
    const type =
      withSmoothedNukes && i % 5 === 0 ? UT_ATOM_BOMB : types[i % types.length];
    const pos = (i * 7) % 500000;
    const lastPos = withSmoothedNukes && type === UT_ATOM_BOMB ? pos - 5 : pos;
    units.set(i, createDummyUnitState(i, type, pos, lastPos));
  }
  return units;
}

export function setupPointLightFixture(
  gl: WebGL2RenderingContext,
): PointLightPassType {
  const unitTypes = [
    UT_CITY,
    UT_PORT,
    UT_FACTORY,
    UT_DEFENSE_POST,
    UT_SAM_LAUNCHER,
    UT_MISSILE_SILO,
    UT_ATOM_BOMB,
    UT_HYDROGEN_BOMB,
    UT_MIRV,
    UT_WARSHIP,
  ];
  const header: RendererConfig = {
    mapWidth: 1000,
    mapHeight: 500,
    unitTypes,
    players: [],
    maxPlayers: 100,
  };
  const palette = new Float32Array(100 * 4).fill(1.0);
  const settings = createRenderSettings();
  const config = {
    msPerTick: () => 100,
  } as unknown as Config;
  return new PointLightPass(gl, header, palette, settings, config);
}

export function runPointLightPassSuite(
  opts: BenchmarkOptions,
): BenchmarkResult[] {
  const results: BenchmarkResult[] = [];
  const instGl = createInstrumentedWebGL2Context();
  const pass = setupPointLightFixture(instGl.gl);
  const units500 = buildLightUnitMap(500, false);
  const units2500 = buildLightUnitMap(2500, false);
  const nukeUnits = buildLightUnitMap(300, true);
  const camMatrix = new Float32Array(9);

  results.push(
    runBenchmark(
      "500 Units VBO Dynamic Packing",
      "lighting",
      () => pass.updateLights(units500),
      opts.iterations,
      opts.warmup,
      instGl,
    ),
  );
  results.push(
    runBenchmark(
      "2,500 Units Heavy Dynamic Batching",
      "lighting",
      () => pass.updateLights(units2500),
      Math.max(10, Math.floor(opts.iterations / 2)),
      opts.warmup,
      instGl,
    ),
  );
  pass.updateLights(nukeUnits);
  results.push(
    runBenchmark(
      "Nuke Smoothing Sub-Buffer Lerp & Draw",
      "lighting",
      () => pass.draw(camMatrix),
      opts.iterations,
      opts.warmup,
      instGl,
    ),
  );
  pass.dispose();
  return results;
}

// ───────────────────────────────────────────────────────────────────────────
// Sub-Suite 4: RailroadPass Dirty-BBox Texture Upload Batching
// ───────────────────────────────────────────────────────────────────────────

export function setupRailroadFixture(
  instGl: InstrumentedWebGL2,
  mapW: number,
  mapH: number,
): RailroadPassType {
  const gl = instGl.gl;
  const tileTex = gl.createTexture()!;
  const paletteTex = gl.createTexture()!;
  const effectTex = gl.createTexture()!;
  const terrainBytes = new Uint8Array(mapW * mapH);
  const settings = createRenderSettings();
  return new RailroadPass(
    gl,
    mapW,
    mapH,
    tileTex,
    paletteTex,
    effectTex,
    terrainBytes,
    settings,
  );
}

function createGhostRailData(
  centerTile: number,
  length: number,
  mapW: number,
): GhostPreviewData {
  const path: TileRef[] = [];
  for (let i = 0; i < length; i++) {
    path.push((centerTile + i + (i % 2 === 0 ? mapW : 0)) as TileRef);
  }
  return {
    ghostType: UnitType.Factory,
    tileX: centerTile % mapW,
    tileY: Math.floor(centerTile / mapW),
    snapToPlacement: false,
    radiusTileX: centerTile % mapW,
    radiusTileY: Math.floor(centerTile / mapW),
    canBuild: true,
    canUpgrade: false,
    cost: 50,
    multiplier: 1,
    showCost: true,
    canAfford: true,
    ghostRailPaths: [path],
    overlappingRailroads: [(centerTile + 1) as TileRef],
    ownerID: 1,
    upgradeTargetTile: null,
    rangeRadius: 10,
    rangeWarning: false,
  };
}

export function runRailroadPassSuite(
  opts: BenchmarkOptions,
): BenchmarkResult[] {
  const results: BenchmarkResult[] = [];
  const instGl = createInstrumentedWebGL2Context();
  const mapW = 1000;
  const mapH = 500;
  const pass = setupRailroadFixture(instGl, mapW, mapH);
  const ghostData = createGhostRailData(250 * mapW + 500, 40, mapW);
  const camMatrix = new Float32Array(9);

  results.push(
    runBenchmark(
      "Ghost Preview Orientation & BBox Calc",
      "railroad",
      () => pass.updateGhostPreview(ghostData),
      opts.iterations,
      opts.warmup,
      instGl,
    ),
  );
  let dirtyTick = 0;
  results.push(
    runBenchmark(
      "Dirty-BBox texSubImage2D Flush & Draw",
      "railroad",
      () => {
        dirtyTick++;
        const dynamicGhost = createGhostRailData(
          (250 + (dirtyTick % 5)) * mapW + 500,
          40,
          mapW,
        );
        pass.updateGhostPreview(dynamicGhost);
        pass.draw(camMatrix, 2.0);
      },
      opts.iterations,
      opts.warmup,
      instGl,
    ),
  );
  let step = 0;
  results.push(
    runBenchmark(
      "Incremental Rail Drag & Tile Clearing",
      "railroad",
      () => {
        step = (step + 1) % 50;
        const liveGhost = createGhostRailData(
          (200 + step) * mapW + (400 + step),
          30,
          mapW,
        );
        pass.updateGhostPreview(liveGhost);
        pass.draw(camMatrix, 2.0);
      },
      opts.iterations,
      opts.warmup,
      instGl,
    ),
  );
  return results;
}

// ───────────────────────────────────────────────────────────────────────────
// Sub-Suite 5: FxShockwavePass Octagon Mesh & ALU Packing
// ───────────────────────────────────────────────────────────────────────────

export function setupShockwaveFixture(
  instGl: InstrumentedWebGL2,
): FxShockwavePassType {
  return new FxShockwavePass(instGl.gl, createRenderSettings());
}

function populateShockwaves(pass: FxShockwavePassType, count: number): void {
  pass.clear();
  const palette = [
    [1, 0.2, 0.2],
    [0.2, 1, 0.2],
    [0.2, 0.2, 1],
    [1, 1, 0],
  ] as const;

  for (let i = 0; i < count; i++) {
    if (i % 2 === 0) {
      pass.pushNukeShockwave(100 + i * 2, 200 + i * 2, 35, {
        type: i % 4 === 0 ? "sparkles" : "embers",
        colors: palette,
        speed: 1.2,
        transitionSpeed: 0.8,
        thickness: 5.0,
        density: 120,
        maxRadius: 60,
      });
    } else {
      pass.pushSAMShockwave(300 + i * 2, 400 + i * 2);
    }
  }
}

export function runFxShockwavePassSuite(
  opts: BenchmarkOptions,
): BenchmarkResult[] {
  const results: BenchmarkResult[] = [];
  const instGl = createInstrumentedWebGL2Context();
  const pass = setupShockwaveFixture(instGl);
  const camMatrix = new Float32Array(9);
  populateShockwaves(pass, 150);

  results.push(
    runBenchmark(
      "22-Float Instance ALU Layout Packing",
      "shockwave",
      () => pass.tick(),
      opts.iterations,
      opts.warmup,
      instGl,
    ),
  );
  results.push(
    runBenchmark(
      "Instanced Octagon bufferSubData & Draw",
      "shockwave",
      () => pass.draw(camMatrix),
      opts.iterations,
      opts.warmup,
      instGl,
    ),
  );
  results.push(
    runBenchmark(
      "Continuous Spawn/Prune Shockwave Churn",
      "shockwave",
      () => {
        pass.pushSAMShockwave(500, 500);
        pass.tick();
        pass.draw(camMatrix);
      },
      opts.iterations,
      opts.warmup,
      instGl,
    ),
  );
  pass.dispose();
  return results;
}

// ───────────────────────────────────────────────────────────────────────────
// Sub-Suite 6: BuildPreviewController & Port Placement Snapping
// ───────────────────────────────────────────────────────────────────────────

export interface BuildPreviewFixture {
  controller: BuildPreviewController;
  cursorLoop: () => void;
  setCoords: (x: number, y: number) => void;
  setGhost: (data: GhostPreviewData | null) => void;
  dispatchedPreviews: number;
}

function createMapRendererStub(onPreview: () => void): MapRenderer {
  return {
    updateGhostPreview: (_data: GhostPreviewData | null) => {
      onPreview();
    },
    updateNukeTrajectory: () => {},
  } as unknown as MapRenderer;
}

function createTestPlayerUpdate(
  smallID: number,
  clientID: string,
): PlayerUpdate {
  return {
    type: GameUpdateType.Player,
    clientID,
    name: "tester",
    displayName: "tester",
    clanTag: null,
    nationFlag: null,
    id: `player-${smallID}`,
    smallID,
    playerType: PlayerType.Human,
    isAlive: true,
    isDisconnected: false,
    tilesOwned: 100,
    gold: 10000n,
    tradeGold: 0n,
    trainGold: 0n,
    piracyGold: 0n,
    goldEarned: 10000n,
    troops: 500,
    isTraitor: false,
    traitorRemainingTicks: 0,
    inDoomsdayClock: false,
    isDecaying: false,
    markedDoomsdayClockTick: 0,
    betrayals: 0,
    hasSpawned: true,
    spawnTile: 600,
    lastDeleteUnitTick: 0,
    allies: [],
    targets: [],
    embargoes: new Set<string>(),
    outgoingAttacks: [],
    incomingAttacks: [],
    outgoingAllianceRequests: [],
    alliances: [],
  };
}

function createEmptyGameUpdate(tick: number): GameUpdateViewData {
  const updates = Object.fromEntries(
    Object.values(GameUpdateType)
      .filter((v): v is number => typeof v === "number")
      .map((k) => [k, []]),
  ) as unknown as GameUpdateViewData["updates"];
  return {
    tick,
    updates,
    packedTileUpdates: new Uint32Array(0),
  };
}

export async function setupBuildPreviewFixture(): Promise<BuildPreviewFixture> {
  const game = await setup("world");
  const gameView = new GameView(
    {} as unknown as ConstructorParameters<typeof GameView>[0],
    game.config(),
    {
      nations: [],
      additionalNations: [],
      gameMap: game.map(),
      miniGameMap: game.miniMap(),
    },
    "human-client",
    "tester",
    null,
    "game-id",
    [],
  );
  const gu = createEmptyGameUpdate(1);
  gu.updates[GameUpdateType.Player] = [
    createTestPlayerUpdate(1, "human-client"),
  ];
  gameView.update(gu);

  let curX = 600;
  let curY = 300;
  let previews = 0;
  const transform = {
    screenToWorldCoordinates: (x: number, y: number) => ({
      x: Math.floor(x),
      y: Math.floor(y),
    }),
    screenToWorldCoordinatesFloat: () => ({ x: curX, y: curY }),
  } as unknown as TransformHandler;

  const controller = new BuildPreviewController(
    gameView,
    new EventBus(),
    {
      attackRatio: 1,
      ghostStructure: null,
      rocketDirectionUp: true,
      upgradeMultiplier: 1,
    },
    transform,
    createMapRendererStub(() => previews++),
    new UserSettings(),
  );

  const ctrlWithInternals = controller as unknown as {
    cursorLoop(): void;
    lastGhostData: GhostPreviewData | null;
  };

  return {
    controller,
    cursorLoop: () => ctrlWithInternals.cursorLoop(),
    setCoords: (x: number, y: number) => {
      curX = x;
      curY = y;
    },
    setGhost: (data: GhostPreviewData | null) => {
      ctrlWithInternals.lastGhostData = data;
    },
    get dispatchedPreviews() {
      return previews;
    },
  };
}

function makeGhostForPort(
  tile: TileRef,
  snap: boolean,
  targetTile: TileRef,
): GhostPreviewData {
  return {
    ghostType: UnitType.Port,
    tileX: targetTile % 2000,
    tileY: Math.floor(targetTile / 2000),
    snapToPlacement: snap,
    radiusTileX: targetTile % 2000,
    radiusTileY: Math.floor(targetTile / 2000),
    canBuild: true,
    canUpgrade: false,
    cost: 100,
    multiplier: 1,
    showCost: true,
    canAfford: true,
    ghostRailPaths: [],
    overlappingRailroads: [],
    ownerID: 1,
    upgradeTargetTile: null,
    rangeRadius: 18,
    rangeWarning: false,
  };
}

export async function runBuildPreviewSuite(
  opts: BenchmarkOptions,
): Promise<BenchmarkResult[]> {
  const results: BenchmarkResult[] = [];
  const fix = await setupBuildPreviewFixture();
  const baseTile = (300 * 2000 + 600) as TileRef;
  const ghost = makeGhostForPort(baseTile, false, baseTile);
  fix.setGhost(ghost);
  fix.cursorLoop(); // Prime initial cache

  results.push(
    runBenchmark(
      "Stationary Cursor Idle Diffing Bypass",
      "preview",
      () => fix.cursorLoop(),
      opts.iterations * 2,
      opts.warmup,
    ),
  );
  let moveTick = 0;
  results.push(
    runBenchmark(
      "Active Continuous Drag Sub-Tile Lerp",
      "preview",
      () => {
        moveTick++;
        fix.setCoords(
          600 + Math.sin(moveTick * 0.05) * 20,
          300 + Math.cos(moveTick * 0.05) * 20,
        );
        fix.cursorLoop();
      },
      opts.iterations,
      opts.warmup,
    ),
  );
  let snapTick = 0;
  results.push(
    runBenchmark(
      "Port Placement Snapping / Coast Boundary",
      "preview",
      () => {
        snapTick++;
        const isCoastSnap = snapTick % 2 === 0;
        const targetTile = (baseTile + (isCoastSnap ? 2000 : 0)) as TileRef;
        fix.setGhost(makeGhostForPort(baseTile, isCoastSnap, targetTile));
        fix.cursorLoop();
      },
      opts.iterations,
      opts.warmup,
    ),
  );
  return results;
}

// ───────────────────────────────────────────────────────────────────────────
// Output Formatting & Reporting
// ───────────────────────────────────────────────────────────────────────────

function fmtNumber(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function fmtLatency(ms: number): string {
  if (ms < 0.001) return `${(ms * 1000).toFixed(1)}µs`;
  if (ms < 1.0) return `${ms.toFixed(3)}ms`;
  return `${ms.toFixed(2)}ms`;
}

function printAsciiTable(headers: string[], rows: string[][]): void {
  const colWidths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)),
  );
  const sep = `+-${colWidths.map((w) => "-".repeat(w)).join("-+-")}-+`;
  const formatRow = (cells: string[]) =>
    `| ${cells.map((c, i) => (c ?? "").padEnd(colWidths[i])).join(" | ")} |`;

  console.log(sep);
  console.log(formatRow(headers));
  console.log(sep);
  for (const row of rows) console.log(formatRow(row));
  console.log(sep);
}

export function printBenchmarkSummary(results: BenchmarkResult[]): void {
  console.log("\n=== Client Render Pipeline & WebGL2 Performance Summary ===");
  const headers = [
    "Benchmark Scenario",
    "Suite",
    "p50 CPU",
    "p95 CPU",
    "Proj Frame",
    "Budget (16.7ms)",
    "Throughput",
    "WebGL Calls",
    "GPU Upload",
    "Heap Churn",
  ];
  // ANGLE/Chromium IPC + driver boundary cost floor (~4µs per WebGL draw/upload command)
  const DRIVER_OVERHEAD_MS = 0.004;

  const rows = results.map((r) => {
    const totalGpuBytes =
      r.telemetry.bufferSubDataBytes +
      r.telemetry.bufferDataBytes +
      r.telemetry.texSubImage2DBytes +
      r.telemetry.texImage2DBytes;
    const draws =
      r.telemetry.drawArraysInstancedCalls +
      r.telemetry.drawArraysCalls +
      r.telemetry.drawElementsInstancedCalls +
      r.telemetry.drawElementsCalls;
    const uploads =
      r.telemetry.bufferSubDataCalls +
      r.telemetry.bufferDataCalls +
      r.telemetry.texSubImage2DCalls +
      r.telemetry.texImage2DCalls;

    // Projected real-world frame time = CPU time + (total GL API calls / iterations) * driver IPC cost
    const totalGlCalls = draws + uploads;
    const callsPerIter = r.iterations > 0 ? totalGlCalls / r.iterations : 0;
    const projectedFrameMs = r.p50Ms + callsPerIter * DRIVER_OVERHEAD_MS;
    const budgetPct = (projectedFrameMs / 16.667) * 100;

    return [
      r.name,
      r.suite,
      fmtLatency(r.p50Ms),
      fmtLatency(r.p95Ms),
      fmtLatency(projectedFrameMs),
      `${budgetPct.toFixed(1)}%`,
      `${fmtNumber(r.opsPerSec)} op/s`,
      `${totalGlCalls} (${callsPerIter.toFixed(1)}/op)`,
      `${(totalGpuBytes / 1024).toFixed(1)} KB`,
      `${r.heapDeltaMB >= 0 ? "+" : ""}${r.heapDeltaMB.toFixed(2)} MB`,
    ];
  });
  printAsciiTable(headers, rows);
}

// ───────────────────────────────────────────────────────────────────────────
// CLI Argument Parsing & Runner
// ───────────────────────────────────────────────────────────────────────────

export function parseCliOptions(argv: string[]): BenchmarkOptions {
  const opts: BenchmarkOptions = {
    suite: "all",
    iterations: 400,
    warmup: 40,
    quiet: false,
  };
  const validSuites = [
    "all",
    "webgl2",
    "pipeline",
    "lighting",
    "railroad",
    "shockwave",
    "preview",
  ];
  for (const arg of argv) {
    if (arg.startsWith("--suite=")) {
      const s = arg.split("=")[1];
      if (validSuites.includes(s)) {
        opts.suite = s as BenchmarkOptions["suite"];
      }
    } else if (arg.startsWith("--iterations=")) {
      opts.iterations = parseInt(arg.split("=")[1], 10);
    } else if (arg.startsWith("--warmup=")) {
      opts.warmup = parseInt(arg.split("=")[1], 10);
    } else if (arg === "--json") {
      opts.quiet = true;
    }
  }
  return opts;
}

export async function runAllSuites(
  opts: BenchmarkOptions,
): Promise<BenchmarkResult[]> {
  const results: BenchmarkResult[] = [];
  if (opts.suite === "all" || opts.suite === "webgl2") {
    results.push(...runGenericWebGL2Suite(opts));
  }
  if (opts.suite === "all" || opts.suite === "pipeline") {
    results.push(...runGenericPipelineSuite(opts));
  }
  if (opts.suite === "all" || opts.suite === "lighting") {
    results.push(...runPointLightPassSuite(opts));
  }
  if (opts.suite === "all" || opts.suite === "railroad") {
    results.push(...runRailroadPassSuite(opts));
  }
  if (opts.suite === "all" || opts.suite === "shockwave") {
    results.push(...runFxShockwavePassSuite(opts));
  }
  if (opts.suite === "all" || opts.suite === "preview") {
    results.push(...(await runBuildPreviewSuite(opts)));
  }
  return results;
}

// ───────────────────────────────────────────────────────────────────────────
// Vitest Suite & Standalone Runner
// ───────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";

describe("ClientRenderPipelinePerf — WebGL2 & Pipeline Performance Suite", () => {
  it("executes all WebGL2 and interactive pipeline benchmark suites", async () => {
    const opts: BenchmarkOptions = {
      suite: "all",
      iterations: 20,
      warmup: 5,
      quiet: false,
    };
    const results = await runAllSuites(opts);
    printBenchmarkSummary(results);

    expect(results.length).toBeGreaterThanOrEqual(18);
    for (const r of results) {
      expect(r.p50Ms).toBeLessThan(10.0);
    }
  });
});
