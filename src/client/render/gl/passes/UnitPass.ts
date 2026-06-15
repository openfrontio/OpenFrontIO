/**
 * UnitPass — GPU-rendered mobile unit sprites.
 *
 * Renders all mobile (non-structure) units: boats, nukes, shells, SAM
 * missiles, and MIRV warheads. All unit types are rotationally symmetric
 * — no rotation needed. Sprites are tiny grayscale PNGs colorized on the
 * GPU using the standard 3-band gray replacement (180/130/70). MIRV
 * Warhead uses a programmatic 3×3 white square (colorized to border
 * color); Shell is a single white pixel.
 *
 * Two instanced draw calls per frame — ground units and missiles are
 * split into separate buffers for correct layer ordering:
 *   Ground/sea (boats, trains) → rendered below structures
 *   Missiles (nukes, shells, SAM, MIRV warheads) → rendered above structures
 *
 * Atlas layout (12 columns × 13px cells, pre-built by generate-sprite-atlases.mjs):
 *   Col 0: Transport (5×5)
 *   Col 1: Trade Ship (5×5)
 *   Col 2: Warship (11×11)
 *   Col 3: Atom Bomb (7×7)
 *   Col 4: Hydrogen Bomb (9×9)
 *   Col 5: MIRV (13×13, grayscale colorized)
 *   Col 6: SAM Missile (3×3)
 *   Col 7: Shell (1×1 white pixel)
 *   Col 8: MIRV Warhead (3×3 white square)
 *   Col 9: Train Engine (5×5)
 *   Col 10: Train Carriage (5×5)
 *   Col 11: Train Carriage Loaded (5×5)
 *
 * Data flow:
 *   FrameSnapshot.units → filter by typeToAtlasIdx → instance VBO → GPU
 *   Shells emit 2 instances (pos + lastPos) to match live game's 2-pixel trail.
 */

import { assetUrl } from "src/core/AssetUrls";
import type { Config } from "src/core/configuration/Config";
import type { RendererConfig, UnitState } from "../../types";
import {
  SMOOTHED_NUKE_TYPES,
  TrainType,
  UT_ATOM_BOMB,
  UT_HYDROGEN_BOMB,
  UT_MIRV,
  UT_MIRV_WARHEAD,
  UT_SAM_MISSILE,
  UT_SHELL,
  UT_TRADE_SHIP,
  UT_TRAIN,
  UT_TRANSPORT,
  UT_WARSHIP,
} from "../../types";
import { DynamicInstanceBuffer } from "../DynamicBuffer";
import type { RenderSettings } from "../RenderSettings";
import unitFragSrc from "../shaders/unit/unit.frag.glsl?raw";
import unitVertSrc from "../shaders/unit/unit.vert.glsl?raw";
import { getPaletteSize } from "../utils/ColorUtils";
import { createProgram, shaderSrc } from "../utils/GlUtils";

const unitAtlasUrl = assetUrl("atlases/unit-atlas.png");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Unit types in atlas column order. Index = atlas column.
 *  TrainEngine/TrainCarriage/TrainCarriageLoaded are synthetic names —
 *  they don't match header.unitTypes directly. Train resolution is
 *  handled specially in updateUnits() via trainType + loaded fields.
 */
const UNIT_ORDER = [
  UT_TRANSPORT,
  UT_TRADE_SHIP,
  UT_WARSHIP,
  UT_ATOM_BOMB,
  UT_HYDROGEN_BOMB,
  UT_MIRV,
  UT_SAM_MISSILE,
  UT_SHELL,
  UT_MIRV_WARHEAD,
  "TrainEngine",
  "TrainCarriage",
  "TrainCarriageLoaded",
] as const;

const ATLAS_COLS = UNIT_ORDER.length;

/** Atlas column of the hydrogen bomb — drives the GPU glow halo. */
const HYDROGEN_BOMB_COL = UNIT_ORDER.indexOf(UT_HYDROGEN_BOMB);

// ---------------------------------------------------------------------------
// Instance data layout
// ---------------------------------------------------------------------------

/**
 * Per-instance data (16 bytes):
 *   float x, y, ownerID   — 12 bytes (3 floats)
 *   uint8 atlasIdx         —  1 byte  (atlas column 0–11)
 *   uint8 flags            —  1 byte  (0 = normal, 1 = flicker, 2 = angry, 3 = trade-friendly, 4 = retreating, 5 = flicker-untargetable)
 *   uint8 flickerHash      —  1 byte  (per-instance flicker phase offset)
 *   1 byte padding         — aligns to 4-byte boundary
 */
const FLOATS_PER_INSTANCE = 4;
const BYTES_PER_INSTANCE = FLOATS_PER_INSTANCE * 4;

/** Flag values — passed as uint8, received as float in shader via normalized attribute */
const FLAG_NORMAL = 0;
const FLAG_FLICKER = 1;
const FLAG_ANGRY = 2;
const FLAG_TRADE_FRIENDLY = 3;
const FLAG_RETREATING = 4;
const FLAG_FLICKER_UNTARGETABLE = 5;

/** Atlas column indices for train sub-types (resolved from trainType + loaded) */
const TRAIN_ENGINE_COL = UNIT_ORDER.indexOf("TrainEngine");
const TRAIN_CARRIAGE_COL = UNIT_ORDER.indexOf("TrainCarriage");
const TRAIN_CARRIAGE_LOADED_COL = UNIT_ORDER.indexOf("TrainCarriageLoaded");

/** Nuke + warhead types — rendered with flickering hot colors */
const FLICKER_TYPES: ReadonlySet<string> = new Set([
  UT_ATOM_BOMB,
  UT_HYDROGEN_BOMB,
  UT_MIRV,
  UT_MIRV_WARHEAD,
  UT_SAM_MISSILE,
  UT_SHELL,
]);

/** Missile/projectile types — rendered on top of structures in the layer order.
 *  Ground/sea units (boats, trains) render below structures. */
const MISSILE_TYPES: ReadonlySet<string> = new Set([
  UT_ATOM_BOMB,
  UT_HYDROGEN_BOMB,
  UT_MIRV,
  UT_SAM_MISSILE,
  UT_SHELL,
  UT_MIRV_WARHEAD,
]);

/** Values per smoothing segment in the flat `smoothSegs` array:
 *  (instanceIdx, lastX, lastY, x, y). The push site and the read loop must
 *  agree on this width — it's the record size, not a tunable. */
const SMOOTH_SEG_STRIDE = 5;

/** Per-instance flicker phase offset, hashed from the tick position. Computed
 *  CPU-side (not from the shader's instance position) so per-frame position
 *  smoothing doesn't re-roll the flicker every frame. Matches the formula the
 *  vertex shader previously applied to its rendered position. */
export function flickerHashByte(x: number, y: number): number {
  const f = x * 0.1731 + y * 0.3179;
  return ((f - Math.floor(f)) * 255) | 0;
}

// ---------------------------------------------------------------------------
// Helper: create a VAO for instanced unit rendering
// ---------------------------------------------------------------------------

function createUnitVao(
  gl: WebGL2RenderingContext,
  quadBuf: WebGLBuffer,
  instanceBuf: WebGLBuffer,
): WebGLVertexArrayObject {
  const vao = gl.createVertexArray()!;
  gl.bindVertexArray(vao);

  // Attribute 0: unit quad [0,0]->[1,1]
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  // Attribute 1: per-instance vec3 (x, y, ownerID) — 3 floats at offset 0
  gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuf);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, BYTES_PER_INSTANCE, 0);
  gl.vertexAttribDivisor(1, 1);

  // Attribute 2: per-instance (atlasIdx, flags, flickerHash) — 3 uint8s at offset 12, converted to float
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 3, gl.UNSIGNED_BYTE, false, BYTES_PER_INSTANCE, 12);
  gl.vertexAttribDivisor(2, 1);

  gl.bindVertexArray(null);
  return vao;
}

// ---------------------------------------------------------------------------
// UnitPass
// ---------------------------------------------------------------------------

export class UnitPass {
  private gl: WebGL2RenderingContext;
  private settings: RenderSettings;
  private program: WebGLProgram;

  private uCamera: WebGLUniformLocation;
  private uTick: WebGLUniformLocation;
  private uUnitSize: WebGLUniformLocation;
  private uFlickerSpeed: WebGLUniformLocation;
  private uAngryColor: WebGLUniformLocation;
  private uAltView: WebGLUniformLocation;
  private uHBombGlowScale: WebGLUniformLocation;
  private uHBombGlowColor: WebGLUniformLocation;
  private uHBombGlowStrength: WebGLUniformLocation;
  private uHBombGlowInner: WebGLUniformLocation;
  private uUntargetableAlpha: WebGLUniformLocation;

  private affiliationTex: WebGLTexture | null = null;
  private altView = false;

  // Ground/sea units (boats, trains) — render below structures
  private groundVao: WebGLVertexArrayObject;
  private groundBuf: DynamicInstanceBuffer;
  private groundCount = 0;

  // Missiles/projectiles (nukes, shells, SAM) — render above structures
  private missileVao: WebGLVertexArrayObject;
  private missileBuf: DynamicInstanceBuffer;
  private missileCount = 0;

  // Per-frame nuke smoothing: flat SMOOTH_SEG_STRIDE-wide tuples
  // (instanceIdx, lastX, lastY, x, y) recorded each tick, lerped into the
  // missile buffer in drawMissiles.
  private smoothSegs: number[] = [];
  private lastUnitsUpdateMs = 0;
  /** Simulation tick duration in ms (Config.msPerTick). */
  private tickIntervalMs: number;

  private quadBuf: WebGLBuffer;
  private paletteTex: WebGLTexture;
  private atlasTex: WebGLTexture;

  /** Frame tick received from renderer — drives tick-based effects */
  private frameTick = 0;

  /** unitType string → atlas column (0-11) */
  private typeToAtlasCol = new Map<string, number>();
  private mapW: number;

  // Trade-friendly detection: enemy trade ships heading to a self/allied port
  private localPlayerID = 0;
  private friendlyOwners = new Set<number>();
  private structures: Map<number, UnitState> = new Map();

  constructor(
    gl: WebGL2RenderingContext,
    header: RendererConfig,
    paletteTex: WebGLTexture,
    settings: RenderSettings,
    config: Config,
  ) {
    this.gl = gl;
    this.settings = settings;
    this.mapW = header.mapWidth;
    this.paletteTex = paletteTex;
    this.tickIntervalMs = config.msPerTick();

    // Build unitType string → atlas column mapping
    for (let i = 0; i < header.unitTypes.length; i++) {
      const col = UNIT_ORDER.indexOf(
        header.unitTypes[i] as (typeof UNIT_ORDER)[number],
      );
      if (col >= 0) {
        this.typeToAtlasCol.set(header.unitTypes[i], col);
      }
    }

    // Compile shaders
    this.program = createProgram(
      gl,
      shaderSrc(unitVertSrc, { ATLAS_COLS, HYDROGEN_BOMB_COL }),
      shaderSrc(unitFragSrc, { PALETTE_SIZE: getPaletteSize(), ATLAS_COLS }),
    );
    this.uCamera = gl.getUniformLocation(this.program, "uCamera")!;
    this.uTick = gl.getUniformLocation(this.program, "uTick")!;
    this.uUnitSize = gl.getUniformLocation(this.program, "uUnitSize")!;
    this.uFlickerSpeed = gl.getUniformLocation(this.program, "uFlickerSpeed")!;
    this.uAngryColor = gl.getUniformLocation(this.program, "uAngryColor")!;

    this.uAltView = gl.getUniformLocation(this.program, "uAltView")!;
    this.uHBombGlowScale = gl.getUniformLocation(
      this.program,
      "uHBombGlowScale",
    )!;
    this.uHBombGlowColor = gl.getUniformLocation(
      this.program,
      "uHBombGlowColor",
    )!;
    this.uHBombGlowStrength = gl.getUniformLocation(
      this.program,
      "uHBombGlowStrength",
    )!;
    this.uHBombGlowInner = gl.getUniformLocation(
      this.program,
      "uHBombGlowInner",
    )!;
    this.uUntargetableAlpha = gl.getUniformLocation(
      this.program,
      "uUntargetableAlpha",
    )!;

    // Texture unit bindings
    gl.useProgram(this.program);
    gl.uniform1i(gl.getUniformLocation(this.program, "uPalette"), 0);
    gl.uniform1i(gl.getUniformLocation(this.program, "uAtlas"), 1);
    gl.uniform1i(gl.getUniformLocation(this.program, "uAffiliation"), 2);

    // Create placeholder atlas texture (1x1 gray pixel)
    this.atlasTex = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array([128, 128, 128, 255]),
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    // Start async atlas build
    this.loadAtlas();

    // --- Shared quad buffer ---
    this.quadBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([0, 0, 1, 0, 0, 1, 1, 0, 1, 1, 0, 1]),
      gl.STATIC_DRAW,
    );

    // --- Ground instance buffer + VAO ---
    const groundGlBuf = gl.createBuffer()!;
    this.groundBuf = new DynamicInstanceBuffer(
      gl,
      groundGlBuf,
      1024,
      FLOATS_PER_INSTANCE,
    );
    this.groundVao = createUnitVao(gl, this.quadBuf, groundGlBuf);

    // --- Missile instance buffer + VAO ---
    const missileGlBuf = gl.createBuffer()!;
    this.missileBuf = new DynamicInstanceBuffer(
      gl,
      missileGlBuf,
      512,
      FLOATS_PER_INSTANCE,
    );
    this.missileVao = createUnitVao(gl, this.quadBuf, missileGlBuf);
  }

  private async loadAtlas(): Promise<void> {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = unitAtlasUrl;
    await img.decode();
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  }

  private emitGround(
    x: number,
    y: number,
    ownerID: number,
    atlasIdx: number,
    flags: number,
  ): void {
    this.groundBuf.ensureCapacity(this.groundCount + 1);
    const off = this.groundCount * FLOATS_PER_INSTANCE;
    this.groundBuf.float32[off + 0] = x;
    this.groundBuf.float32[off + 1] = y;
    this.groundBuf.float32[off + 2] = ownerID;
    const byteOff = this.groundCount * BYTES_PER_INSTANCE;
    this.groundBuf.uint8[byteOff + 12] = atlasIdx;
    this.groundBuf.uint8[byteOff + 13] = flags;
    this.groundBuf.uint8[byteOff + 14] = flickerHashByte(x, y);
    this.groundCount++;
  }

  private emitMissile(
    x: number,
    y: number,
    ownerID: number,
    atlasIdx: number,
    flags: number,
  ): void {
    this.missileBuf.ensureCapacity(this.missileCount + 1);
    const off = this.missileCount * FLOATS_PER_INSTANCE;
    this.missileBuf.float32[off + 0] = x;
    this.missileBuf.float32[off + 1] = y;
    this.missileBuf.float32[off + 2] = ownerID;
    const byteOff = this.missileCount * BYTES_PER_INSTANCE;
    this.missileBuf.uint8[byteOff + 12] = atlasIdx;
    this.missileBuf.uint8[byteOff + 13] = flags;
    this.missileBuf.uint8[byteOff + 14] = flickerHashByte(x, y);
    this.missileCount++;
  }

  updateUnits(units: Map<number, UnitState>, tick: number): void {
    this.frameTick = tick;
    this.groundCount = 0;
    this.missileCount = 0;
    this.smoothSegs.length = 0;
    this.lastUnitsUpdateMs = performance.now();

    for (const unit of units.values()) {
      if (!unit.isActive) continue;

      let atlasIdx = this.typeToAtlasCol.get(unit.unitType);

      // Train sub-type resolution: "Train" isn't in UNIT_ORDER.
      // Resolve to engine/carriage/loaded carriage based on trainType + loaded fields.
      if (atlasIdx === undefined && unit.unitType === UT_TRAIN) {
        const tt = unit.trainType;
        if (tt === TrainType.Engine || tt === TrainType.TailEngine) {
          atlasIdx = TRAIN_ENGINE_COL;
        } else {
          atlasIdx = unit.loaded
            ? TRAIN_CARRIAGE_LOADED_COL
            : TRAIN_CARRIAGE_COL;
        }
      }

      if (atlasIdx === undefined) continue;

      const isRetreatingWarship =
        unit.unitType === UT_WARSHIP && unit.retreating;
      const isAngryWarship =
        unit.unitType === UT_WARSHIP && unit.targetUnitId !== null;
      const isFlicker = FLICKER_TYPES.has(unit.unitType);

      // Enemy trade ships heading to a self/allied port get FLAG_TRADE_FRIENDLY
      // so alt-view renders them yellow instead of red.
      let isTradeFriendly = false;
      if (
        unit.unitType === UT_TRADE_SHIP &&
        unit.targetUnitId !== null &&
        this.localPlayerID > 0
      ) {
        const targetPort = this.structures.get(unit.targetUnitId);
        if (targetPort) {
          const portOwner = targetPort.ownerID;
          // Only recolor enemy-owned ships: a self/allied ship already renders
          // green/yellow via its affiliation color (e.g. a captured trade ship
          // heading to our port is ours and must stay green, not yellow).
          isTradeFriendly =
            unit.ownerID !== this.localPlayerID &&
            !this.friendlyOwners.has(unit.ownerID) &&
            (portOwner === this.localPlayerID ||
              this.friendlyOwners.has(portOwner));
        }
      }

      let flags = FLAG_NORMAL;
      if (isTradeFriendly) {
        flags = FLAG_TRADE_FRIENDLY;
      } else if (isRetreatingWarship) {
        flags = FLAG_RETREATING;
      } else if (isAngryWarship) {
        flags = FLAG_ANGRY;
      } else if (isFlicker) {
        // Untargetable nukes render dimmed so players can tell SAMs can't hit them
        flags = unit.targetable ? FLAG_FLICKER : FLAG_FLICKER_UNTARGETABLE;
      }
      const isMissile = MISSILE_TYPES.has(unit.unitType);

      const x = unit.pos % this.mapW;
      const y = (unit.pos - x) / this.mapW;

      if (isMissile) {
        if (
          SMOOTHED_NUKE_TYPES.has(unit.unitType) &&
          unit.lastPos !== unit.pos
        ) {
          const lx = unit.lastPos % this.mapW;
          const ly = (unit.lastPos - lx) / this.mapW;
          this.smoothSegs.push(this.missileCount, lx, ly, x, y);
        }
        this.emitMissile(x, y, unit.ownerID, atlasIdx, flags);

        // Shells emit a second instance at lastPos (2-pixel trail effect)
        if (unit.unitType === UT_SHELL && unit.lastPos !== unit.pos) {
          const lx = unit.lastPos % this.mapW;
          const ly = (unit.lastPos - lx) / this.mapW;
          this.emitMissile(lx, ly, unit.ownerID, atlasIdx, flags);
        }
      } else {
        this.emitGround(x, y, unit.ownerID, atlasIdx, flags);
      }
    }

    const gl = this.gl;
    if (this.groundCount > 0) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.groundBuf.buffer);
      gl.bufferSubData(
        gl.ARRAY_BUFFER,
        0,
        this.groundBuf.float32,
        0,
        this.groundCount * FLOATS_PER_INSTANCE,
      );
    }
    if (this.missileCount > 0) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.missileBuf.buffer);
      gl.bufferSubData(
        gl.ARRAY_BUFFER,
        0,
        this.missileBuf.float32,
        0,
        this.missileCount * FLOATS_PER_INSTANCE,
      );
    }
  }

  setAltView(active: boolean): void {
    this.altView = active;
  }
  setAffiliationTex(tex: WebGLTexture): void {
    this.affiliationTex = tex;
  }
  setLocalPlayer(id: number): void {
    this.localPlayerID = id;
  }
  setAllies(allies: Set<number>): void {
    this.friendlyOwners = allies;
  }
  setStructures(structs: Map<number, UnitState>): void {
    this.structures = structs;
  }

  /** Bind shared program state + uniforms (call before drawGround/drawMissiles). */
  private bindProgram(cameraMatrix: Float32Array): void {
    const gl = this.gl;
    gl.useProgram(this.program);

    const us = this.settings.unit;
    gl.uniformMatrix3fv(this.uCamera, false, cameraMatrix);
    gl.uniform1f(this.uTick, this.frameTick);
    gl.uniform1f(this.uUnitSize, us.unitSize);
    gl.uniform1f(this.uFlickerSpeed, us.flickerSpeed);
    gl.uniform3f(this.uAngryColor, us.angryR, us.angryG, us.angryB);
    gl.uniform1i(this.uAltView, this.altView ? 1 : 0);
    gl.uniform1f(this.uHBombGlowScale, us.hBombGlowScale);
    gl.uniform3f(
      this.uHBombGlowColor,
      us.hBombGlowR,
      us.hBombGlowG,
      us.hBombGlowB,
    );
    gl.uniform1f(this.uHBombGlowStrength, us.hBombGlowStrength);
    gl.uniform1f(this.uHBombGlowInner, us.hBombGlowInner);
    gl.uniform1f(this.uUntargetableAlpha, us.untargetableAlpha);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.paletteTex);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);

    if (this.affiliationTex) {
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, this.affiliationTex);
    }
  }

  /** Draw ground/sea units (boats, trains). Render below structures. */
  drawGround(cameraMatrix: Float32Array): void {
    if (this.groundCount === 0) return;
    this.bindProgram(cameraMatrix);
    const gl = this.gl;
    gl.bindVertexArray(this.groundVao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.groundCount);
  }

  /** Draw missiles/projectiles (nukes, shells, SAM, MIRV warheads). Render above structures. */
  drawMissiles(cameraMatrix: Float32Array): void {
    if (this.missileCount === 0) return;
    this.applyMissileSmoothing();
    this.bindProgram(cameraMatrix);
    const gl = this.gl;
    gl.bindVertexArray(this.missileVao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.missileCount);
  }

  /** Lerp smoothed nukes lastPos→pos by wall-clock progress through the
   *  current tick and re-upload the (small) missile instance buffer. */
  private applyMissileSmoothing(): void {
    const segs = this.smoothSegs;
    if (segs.length === 0) return;
    const alpha = Math.min(
      1,
      (performance.now() - this.lastUnitsUpdateMs) / this.tickIntervalMs,
    );
    const f32 = this.missileBuf.float32;
    for (let i = 0; i < segs.length; i += SMOOTH_SEG_STRIDE) {
      const off = segs[i] * FLOATS_PER_INSTANCE;
      f32[off + 0] = segs[i + 1] + (segs[i + 3] - segs[i + 1]) * alpha;
      f32[off + 1] = segs[i + 2] + (segs[i + 4] - segs[i + 2]) * alpha;
    }
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.missileBuf.buffer);
    gl.bufferSubData(
      gl.ARRAY_BUFFER,
      0,
      f32,
      0,
      this.missileCount * FLOATS_PER_INSTANCE,
    );
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.program);
    this.groundBuf.dispose();
    this.missileBuf.dispose();
    gl.deleteBuffer(this.quadBuf);
    gl.deleteVertexArray(this.groundVao);
    gl.deleteVertexArray(this.missileVao);
    gl.deleteTexture(this.atlasTex);
  }
}
