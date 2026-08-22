/**
 * BuildQueuePass — warship build progress badge on ports.
 *
 * A port with queued warships shows a small ring at the top-right of its icon
 * that fills clockwise as the head of the queue is built. When more than one
 * ship is queued the queue length is drawn in the ring's center (MSDF digits,
 * same atlas as NamePass). Scales with the structure icons and hides with them
 * below the dots zoom threshold. Two instanced draws per frame (ring, digits).
 */

import type { Config } from "../../../../core/configuration/Config";
import { UnitType } from "../../../../core/game/Game";
import type { RendererConfig, UnitState } from "../../types";
import { UT_PORT } from "../../types";
import { DynamicInstanceBuffer } from "../DynamicBuffer";
import type { RenderSettings } from "../RenderSettings";
import { createProgram } from "../utils/GlUtils";
import type { GlyphTables } from "./name-pass/AtlasData";
import { buildGlyphTables, parseAtlasData } from "./name-pass/AtlasData";
import { buildGlyphMetricsTex } from "./name-pass/DataTextures";
import { layoutString } from "./name-pass/TextLayout";
import { CHAR_RANGE, MAX_CHARS } from "./name-pass/Types";

import { assetUrl } from "src/core/AssetUrls";
import countFragSrc from "../shaders/build-queue/count.frag.glsl?raw";
import countVertSrc from "../shaders/build-queue/count.vert.glsl?raw";
import ringFragSrc from "../shaders/build-queue/ring.frag.glsl?raw";
import ringVertSrc from "../shaders/build-queue/ring.vert.glsl?raw";

const atlasUrl = assetUrl("atlases/msdf-atlas.png");

const RING_FLOATS = 3; // worldX, worldY, progress
const COUNT_FLOATS = 4; // worldX, worldY, cursorX, charCode

/** Badge center offset from the icon center, in halfIconSize units (+x right, -y up). */
const BADGE_OFFSET_X = 0.95;
const BADGE_OFFSET_Y = -0.95;
/** Badge radius in halfIconSize units. */
const BADGE_RADIUS = 0.6;
/** Inner edge of the ring as a fraction of the badge radius. */
const RING_INNER = 0.68;
/** Digit em height in halfIconSize units. */
const COUNT_TEXT_SCALE = 0.62;
const COUNT_OUTLINE_WIDTH = 1.2;

export class BuildQueuePass {
  private gl: WebGL2RenderingContext;
  private settings: RenderSettings;
  private mapW: number;
  private buildTicks: number;

  // Ring program
  private ringProgram: WebGLProgram;
  private ringVao: WebGLVertexArrayObject;
  private ringBuf: DynamicInstanceBuffer;
  private ringCount = 0;
  private rCamera: WebGLUniformLocation;
  private rZoom: WebGLUniformLocation;
  private rIconSize: WebGLUniformLocation;
  private rDotsThreshold: WebGLUniformLocation;
  private rScaleFactor: WebGLUniformLocation;
  private rIconGrowZoom: WebGLUniformLocation;

  // Count program
  private countProgram: WebGLProgram;
  private countVao: WebGLVertexArrayObject;
  private countBuf: DynamicInstanceBuffer;
  private countInstances = 0;
  private cCamera: WebGLUniformLocation;
  private cZoom: WebGLUniformLocation;
  private cIconSize: WebGLUniformLocation;
  private cDotsThreshold: WebGLUniformLocation;
  private cScaleFactor: WebGLUniformLocation;
  private cIconGrowZoom: WebGLUniformLocation;

  private glyph: GlyphTables;
  private kernTable: Int8Array;
  private metricsTex: WebGLTexture;
  private atlasTex: WebGLTexture | null = null;
  private atlasReady = false;
  private charCodes = new Uint8Array(MAX_CHARS);
  private cursors = new Float32Array(MAX_CHARS);

  constructor(
    gl: WebGL2RenderingContext,
    header: RendererConfig,
    settings: RenderSettings,
    config: Config,
  ) {
    this.gl = gl;
    this.settings = settings;
    this.mapW = header.mapWidth;
    this.buildTicks =
      config.unitInfo(UnitType.Warship).constructionDuration ?? 0;

    const quad = new Float32Array([0, 0, 1, 0, 0, 1, 1, 0, 1, 1, 0, 1]);

    // --- Ring ---
    this.ringProgram = createProgram(gl, ringVertSrc, ringFragSrc);
    gl.useProgram(this.ringProgram);
    const ru = (n: string) => gl.getUniformLocation(this.ringProgram, n)!;
    this.rCamera = ru("uCamera");
    this.rZoom = ru("uZoom");
    this.rIconSize = ru("uIconSize");
    this.rDotsThreshold = ru("uDotsThreshold");
    this.rScaleFactor = ru("uScaleFactor");
    this.rIconGrowZoom = ru("uIconGrowZoom");
    gl.uniform2f(ru("uOffset"), BADGE_OFFSET_X, BADGE_OFFSET_Y);
    gl.uniform1f(ru("uRadius"), BADGE_RADIUS);
    gl.uniform1f(ru("uRingInner"), RING_INNER);
    gl.uniform3f(ru("uFillColor"), 1.0, 1.0, 1.0);
    gl.uniform3f(ru("uTrackColor"), 0.35, 0.35, 0.35);
    gl.uniform3f(ru("uBackColor"), 0.0, 0.0, 0.0);
    gl.uniform1f(ru("uBackAlpha"), 0.6);

    this.ringVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.ringVao);
    const ringQuad = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, ringQuad);
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const ringGlBuf = gl.createBuffer()!;
    this.ringBuf = new DynamicInstanceBuffer(gl, ringGlBuf, 256, RING_FLOATS);
    gl.bindBuffer(gl.ARRAY_BUFFER, ringGlBuf);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, RING_FLOATS * 4, 0);
    gl.vertexAttribDivisor(1, 1);
    gl.bindVertexArray(null);

    // --- Count digits ---
    const atlas = parseAtlasData();
    this.glyph = buildGlyphTables(atlas.chars);
    this.kernTable = new Int8Array(CHAR_RANGE * CHAR_RANGE); // digits don't kern
    this.metricsTex = buildGlyphMetricsTex(gl, atlas);

    this.countProgram = createProgram(gl, countVertSrc, countFragSrc);
    gl.useProgram(this.countProgram);
    const cu = (n: string) => gl.getUniformLocation(this.countProgram, n)!;
    gl.uniform1i(cu("uAtlas"), 0);
    gl.uniform1i(cu("uGlyphMetrics"), 1);
    gl.uniform1f(cu("uFontSize"), atlas.fontSize);
    gl.uniform1f(cu("uAtlasScaleH"), atlas.scaleH);
    gl.uniform1f(cu("uBase"), atlas.base);
    gl.uniform1f(cu("uDistRange"), atlas.distanceRange);
    gl.uniform2f(cu("uOffset"), BADGE_OFFSET_X, BADGE_OFFSET_Y);
    gl.uniform1f(cu("uTextScale"), COUNT_TEXT_SCALE);
    gl.uniform1f(cu("uOutlineWidth"), COUNT_OUTLINE_WIDTH);
    this.cCamera = cu("uCamera");
    this.cZoom = cu("uZoom");
    this.cIconSize = cu("uIconSize");
    this.cDotsThreshold = cu("uDotsThreshold");
    this.cScaleFactor = cu("uScaleFactor");
    this.cIconGrowZoom = cu("uIconGrowZoom");

    this.countVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.countVao);
    const countQuad = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, countQuad);
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const countGlBuf = gl.createBuffer()!;
    this.countBuf = new DynamicInstanceBuffer(
      gl,
      countGlBuf,
      512,
      COUNT_FLOATS,
    );
    gl.bindBuffer(gl.ARRAY_BUFFER, countGlBuf);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, COUNT_FLOATS * 4, 0);
    gl.vertexAttribDivisor(1, 1);
    gl.bindVertexArray(null);

    this.loadAtlas();
  }

  private loadAtlas(): void {
    const img = new Image();
    img.crossOrigin = "anonymous";
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

  /** Rebuild badge instances from the current structures. */
  updateStructures(structures: Map<number, UnitState>, gameTick: number): void {
    let rings = 0;
    let chars = 0;

    for (const unit of structures.values()) {
      if (!unit.isActive || unit.unitType !== UT_PORT) continue;
      if (unit.warshipQueueLength <= 0) continue;

      const x = unit.pos % this.mapW;
      const y = (unit.pos - x) / this.mapW;

      let progress = 0;
      if (unit.warshipBuildStartTick !== null && this.buildTicks > 0) {
        progress = Math.min(
          1,
          Math.max(
            0,
            (gameTick - unit.warshipBuildStartTick) / this.buildTicks,
          ),
        );
      }
      this.ringBuf.ensureCapacity(rings + 1);
      const ringData = this.ringBuf.float32;
      const ro = rings * RING_FLOATS;
      ringData[ro] = x;
      ringData[ro + 1] = y;
      ringData[ro + 2] = progress;
      rings++;

      if (unit.warshipQueueLength < 2) continue;
      const text = unit.warshipQueueLength.toString();
      layoutString(
        text,
        this.glyph,
        this.kernTable,
        this.charCodes,
        this.cursors,
      );
      const len = Math.min(text.length, MAX_CHARS);
      for (let i = 0; i < len; i++) {
        this.countBuf.ensureCapacity(chars + 1);
        const countData = this.countBuf.float32;
        const co = chars * COUNT_FLOATS;
        countData[co] = x;
        countData[co + 1] = y;
        countData[co + 2] = this.cursors[i];
        countData[co + 3] = this.charCodes[i];
        chars++;
      }
    }

    this.ringCount = rings;
    this.countInstances = chars;

    const gl = this.gl;
    if (rings > 0) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.ringBuf.buffer);
      gl.bufferSubData(
        gl.ARRAY_BUFFER,
        0,
        this.ringBuf.float32,
        0,
        rings * RING_FLOATS,
      );
    }
    if (chars > 0) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.countBuf.buffer);
      gl.bufferSubData(
        gl.ARRAY_BUFFER,
        0,
        this.countBuf.float32,
        0,
        chars * COUNT_FLOATS,
      );
    }
  }

  draw(cameraMatrix: Float32Array, zoom: number): void {
    if (this.ringCount === 0) return;
    const gl = this.gl;
    const ss = this.settings.structure;

    gl.useProgram(this.ringProgram);
    gl.uniformMatrix3fv(this.rCamera, false, cameraMatrix);
    gl.uniform1f(this.rZoom, zoom);
    gl.uniform1f(this.rIconSize, ss.iconSize);
    gl.uniform1f(this.rDotsThreshold, ss.dotsZoomThreshold);
    gl.uniform1f(this.rScaleFactor, ss.iconScaleFactorZoomedOut);
    gl.uniform1f(this.rIconGrowZoom, ss.iconGrowZoom);
    gl.bindVertexArray(this.ringVao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.ringCount);

    if (this.countInstances === 0 || !this.atlasReady) {
      gl.bindVertexArray(null);
      return;
    }

    gl.useProgram(this.countProgram);
    gl.uniformMatrix3fv(this.cCamera, false, cameraMatrix);
    gl.uniform1f(this.cZoom, zoom);
    gl.uniform1f(this.cIconSize, ss.iconSize);
    gl.uniform1f(this.cDotsThreshold, ss.dotsZoomThreshold);
    gl.uniform1f(this.cScaleFactor, ss.iconScaleFactorZoomedOut);
    gl.uniform1f(this.cIconGrowZoom, ss.iconGrowZoom);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTex!);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.metricsTex);
    gl.bindVertexArray(this.countVao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.countInstances);
    gl.bindVertexArray(null);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.ringProgram);
    gl.deleteProgram(this.countProgram);
    gl.deleteVertexArray(this.ringVao);
    gl.deleteVertexArray(this.countVao);
    gl.deleteBuffer(this.ringBuf.buffer);
    gl.deleteBuffer(this.countBuf.buffer);
    gl.deleteTexture(this.metricsTex);
    if (this.atlasTex) gl.deleteTexture(this.atlasTex);
  }
}
