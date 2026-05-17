/**
 * StructureLevelPass — MSDF-rendered level numbers above structures.
 *
 * Renders level digits for structures with level > 1 using the same MSDF
 * atlas and glyph infrastructure as NamePass. One instanced draw call per frame.
 *
 * Only visible when zoom > dotsThreshold (matching structure icon visibility).
 */

import type { RendererConfig, UnitState } from "../../types";
import {
  STRUCTURE_TYPES,
  UT_CITY,
  UT_DEFENSE_POST,
  UT_FACTORY,
  UT_MISSILE_SILO,
  UT_PORT,
  UT_SAM_LAUNCHER,
} from "../../types";
import { DynamicInstanceBuffer } from "../dynamic-buffer";
import type { RenderSettings } from "../render-settings";
import { createProgram } from "../utils/gl-utils";
import type { GlyphTables } from "./name-pass/atlas-data";
import { buildGlyphTables, parseAtlasData } from "./name-pass/atlas-data";
import { buildGlyphMetricsTex } from "./name-pass/data-textures";
import { layoutString } from "./name-pass/text-layout";
import { CHAR_RANGE, MAX_CHARS } from "./name-pass/types";

import { assetUrl } from "src/core/AssetUrls";
import fragSrc from "../shaders/structure-level/structure-level.frag.glsl?raw";
import vertSrc from "../shaders/structure-level/structure-level.vert.glsl?raw";

const atlasUrl = assetUrl("atlases/msdf-atlas.png");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Atlas column order — must match StructurePass. */
const STRUCTURE_ORDER = [
  UT_CITY,
  UT_PORT,
  UT_FACTORY,
  UT_DEFENSE_POST,
  UT_SAM_LAUNCHER,
  UT_MISSILE_SILO,
] as const;

/** Max characters per level label (handles up to "99"). */
const MAX_LEVEL_CHARS = 4;
const FLOATS_PER_INSTANCE = 5; // worldX, worldY, cursorX, charCode, atlasIdx
const BYTES_PER_INSTANCE = FLOATS_PER_INSTANCE * 4;

// ---------------------------------------------------------------------------
// StructureLevelPass
// ---------------------------------------------------------------------------

export class StructureLevelPass {
  private gl: WebGL2RenderingContext;
  private settings: RenderSettings;
  private program: WebGLProgram;
  // Uniform locations
  private uCamera: WebGLUniformLocation;
  private uZoom: WebGLUniformLocation;
  private uIconSize: WebGLUniformLocation;
  private uDotsThreshold: WebGLUniformLocation;
  private uScaleFactor: WebGLUniformLocation;
  private uDistRange: WebGLUniformLocation;
  private uOutlineWidth: WebGLUniformLocation;
  private uLevelScale: WebGLUniformLocation;
  private uHighlightMask: WebGLUniformLocation;
  private uHighlightDimAlpha: WebGLUniformLocation;

  private vao: WebGLVertexArrayObject;
  private instanceBuf: DynamicInstanceBuffer;
  private instanceCount = 0;

  private glyphMetricsTex: WebGLTexture;
  private atlasTex: WebGLTexture | null = null;
  private atlasReady = false;

  // CPU-side glyph tables for layoutString
  private glyph: GlyphTables;
  private kernTable: Int8Array;
  private mapW: number;

  // Reusable buffers for layoutString
  private charCodes = new Uint8Array(MAX_CHARS);
  private cursors = new Float32Array(MAX_CHARS);

  private distanceRange: number;
  private fontSize: number;
  private atlasScaleH: number;
  private base: number;

  /** unitType string → atlas column index (0–5). */
  private typeToAtlasCol = new Map<string, number>();
  /** Build-button hover highlight bitmask (0 = off). */
  private highlightMask = 0;

  constructor(
    gl: WebGL2RenderingContext,
    header: RendererConfig,
    settings: RenderSettings,
  ) {
    this.gl = gl;
    this.settings = settings;
    this.mapW = header.mapWidth;

    // Build unitType string → atlas column mapping
    for (let i = 0; i < header.unitTypes.length; i++) {
      const col = STRUCTURE_ORDER.indexOf(
        header.unitTypes[i] as (typeof STRUCTURE_ORDER)[number],
      );
      if (col >= 0) this.typeToAtlasCol.set(header.unitTypes[i], col);
    }

    // Parse atlas data (same source as NamePass)
    const atlas = parseAtlasData();
    this.glyph = buildGlyphTables(atlas.chars);
    this.kernTable = new Int8Array(CHAR_RANGE * CHAR_RANGE); // digits don't kern
    this.distanceRange = atlas.distanceRange;
    this.fontSize = atlas.fontSize;
    this.atlasScaleH = atlas.scaleH;
    this.base = atlas.base;

    // Compile shaders
    this.program = createProgram(gl, vertSrc, fragSrc);

    // Texture unit bindings
    gl.useProgram(this.program);
    gl.uniform1i(gl.getUniformLocation(this.program, "uAtlas"), 0);
    gl.uniform1i(gl.getUniformLocation(this.program, "uGlyphMetrics"), 1);

    // Static uniforms
    gl.uniform1f(
      gl.getUniformLocation(this.program, "uFontSize")!,
      this.fontSize,
    );
    gl.uniform1f(
      gl.getUniformLocation(this.program, "uAtlasScaleH")!,
      this.atlasScaleH,
    );
    gl.uniform1f(gl.getUniformLocation(this.program, "uBase")!, this.base);

    // Dynamic uniform locations
    this.uCamera = gl.getUniformLocation(this.program, "uCamera")!;
    this.uZoom = gl.getUniformLocation(this.program, "uZoom")!;
    this.uIconSize = gl.getUniformLocation(this.program, "uIconSize")!;
    this.uDotsThreshold = gl.getUniformLocation(
      this.program,
      "uDotsThreshold",
    )!;
    this.uScaleFactor = gl.getUniformLocation(this.program, "uScaleFactor")!;
    this.uDistRange = gl.getUniformLocation(this.program, "uDistRange")!;
    this.uOutlineWidth = gl.getUniformLocation(this.program, "uOutlineWidth")!;
    this.uLevelScale = gl.getUniformLocation(this.program, "uLevelScale")!;
    this.uHighlightMask = gl.getUniformLocation(
      this.program,
      "uHighlightMask",
    )!;
    this.uHighlightDimAlpha = gl.getUniformLocation(
      this.program,
      "uHighlightDimAlpha",
    )!;

    // Glyph metrics data texture
    this.glyphMetricsTex = buildGlyphMetricsTex(gl, atlas);

    // Start async MSDF atlas load
    this.loadAtlas();

    // Instance buffer
    const glBuf = gl.createBuffer()!;
    this.instanceBuf = new DynamicInstanceBuffer(
      gl,
      glBuf,
      4096,
      FLOATS_PER_INSTANCE,
    );

    // VAO
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);

    // Attribute 0: unit quad [0,1]²
    const quadBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([0, 0, 1, 0, 0, 1, 1, 0, 1, 1, 0, 1]),
      gl.STATIC_DRAW,
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    // Attribute 1: per-instance vec4 (worldX, worldY, cursorX, charCode)
    gl.bindBuffer(gl.ARRAY_BUFFER, glBuf);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, BYTES_PER_INSTANCE, 0);
    gl.vertexAttribDivisor(1, 1);

    // Attribute 2: per-instance float (atlasIdx)
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, BYTES_PER_INSTANCE, 16);
    gl.vertexAttribDivisor(2, 1);

    gl.bindVertexArray(null);
  }

  private loadAtlas(): void {
    const img = new Image();
    img.onload = () => {
      const gl = this.gl;
      const tex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      this.atlasTex = tex;
      this.atlasReady = true;
    };
    img.src = atlasUrl;
  }

  updateStructures(units: Map<number, UnitState>): void {
    let count = 0;

    for (const unit of units.values()) {
      if (!STRUCTURE_TYPES.has(unit.unitType)) continue;
      if (unit.level <= 1) continue;

      const levelStr = unit.level.toString();
      layoutString(
        levelStr,
        this.glyph,
        this.kernTable,
        this.charCodes,
        this.cursors,
      );

      const x = unit.pos % this.mapW;
      const y = (unit.pos - x) / this.mapW;
      const len = Math.min(levelStr.length, MAX_LEVEL_CHARS);
      const atlasIdx = this.typeToAtlasCol.get(unit.unitType) ?? 0;

      for (let i = 0; i < len; i++) {
        this.instanceBuf.ensureCapacity(count + 1);

        const off = count * FLOATS_PER_INSTANCE;
        const data = this.instanceBuf.float32;
        data[off + 0] = x;
        data[off + 1] = y;
        data[off + 2] = this.cursors[i];
        data[off + 3] = this.charCodes[i];
        data[off + 4] = atlasIdx;
        count++;
      }
    }

    this.instanceCount = count;

    if (count > 0) {
      const gl = this.gl;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuf.buffer);
      gl.bufferSubData(
        gl.ARRAY_BUFFER,
        0,
        this.instanceBuf.float32,
        0,
        count * FLOATS_PER_INSTANCE,
      );
    }
  }

  draw(cameraMatrix: Float32Array, zoom: number): void {
    if (!this.atlasReady || this.instanceCount === 0) return;

    const gl = this.gl;
    const ss = this.settings.structure;
    const sl = this.settings.structureLevel;

    gl.useProgram(this.program);
    gl.uniformMatrix3fv(this.uCamera, false, cameraMatrix);
    gl.uniform1f(this.uZoom, zoom);
    gl.uniform1f(this.uIconSize, ss.iconSize);
    gl.uniform1f(this.uDotsThreshold, ss.dotsZoomThreshold);
    gl.uniform1f(this.uScaleFactor, ss.iconScaleFactorZoomedOut);
    gl.uniform1f(this.uDistRange, this.distanceRange);
    gl.uniform1f(this.uOutlineWidth, sl.outlineWidth);
    gl.uniform1f(this.uLevelScale, sl.scale);
    gl.uniform1i(this.uHighlightMask, this.highlightMask);
    gl.uniform1f(this.uHighlightDimAlpha, ss.highlightDimAlpha);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTex!);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.glyphMetricsTex);

    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.instanceCount);
  }

  /** Highlight structures of the given types (null/empty = off). Dims all other types. */
  setHighlightTypes(unitTypes: string[] | null): void {
    let mask = 0;
    if (unitTypes) {
      for (const t of unitTypes) {
        const col = this.typeToAtlasCol.get(t);
        if (col !== undefined) mask |= 1 << col;
      }
    }
    this.highlightMask = mask;
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.program);
    this.instanceBuf.dispose();
    gl.deleteVertexArray(this.vao);
    gl.deleteTexture(this.glyphMetricsTex);
    if (this.atlasTex) gl.deleteTexture(this.atlasTex);
  }
}
