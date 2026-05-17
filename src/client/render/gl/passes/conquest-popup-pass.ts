/**
 * ConquestPopupPass — MSDF-rendered floating text popups.
 *
 * Renders two kinds of popups using the same MSDF atlas as NamePass:
 * - Conquest popups: "+ 500" gold text at conquered player locations (static position, fade only)
 * - Bonus popups: "+ 45K" income text at port tiles (rises upward + fades)
 */

import type { BonusEvent, ConquestFx } from "../../types";
import type { RenderSettings } from "../render-settings";
import { createProgram } from "../utils/gl-utils";
import type { GlyphTables } from "./name-pass/atlas-data";
import { buildGlyphTables, parseAtlasData } from "./name-pass/atlas-data";
import { buildGlyphMetricsTex } from "./name-pass/data-textures";
import { layoutString } from "./name-pass/text-layout";
import { CHAR_RANGE, MAX_CHARS } from "./name-pass/types";

import { assetUrl } from "src/core/AssetUrls";
import fragSrc from "../shaders/conquest-popup/conquest-popup.frag.glsl?raw";
import vertSrc from "../shaders/conquest-popup/conquest-popup.vert.glsl?raw";

const atlasUrl = assetUrl("atlases/msdf-atlas.png");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// worldX, worldY, cursorX, charCode, alpha, colorR, colorG, colorB, scale, outlineWidth
const FLOATS_PER_INSTANCE = 10;
const BYTES_PER_INSTANCE = FLOATS_PER_INSTANCE * 4;
const CONQUEST_LIFETIME_MS = 2500;
/** Nominal game tick rate — 100ms per tick. */
const MS_PER_TICK = 100;
/** Tiles below conquered name location (matches upstream DynamicUILayer). */
const CONQUEST_Y_OFFSET = 8;
/** World-space font size for conquest popups. */
const CONQUEST_SCALE = 6;
const CONQUEST_OUTLINE_WIDTH = 2.0;

// ---------------------------------------------------------------------------
// Active popup tracking
// ---------------------------------------------------------------------------

interface ActivePopup {
  x: number;
  y: number;
  text: string;
  startMs: number;
  lifetimeMs: number;
  riseSpeed: number; // world units per second (0 = no rise)
  colorR: number;
  colorG: number;
  colorB: number;
  scale: number;
  outlineWidth: number;
}

function formatGold(gold: number): string {
  if (gold >= 1_000_000) return (gold / 1_000_000).toFixed(1) + "M";
  if (gold >= 1_000) return (gold / 1_000).toFixed(1) + "K";
  return gold.toString();
}

// ---------------------------------------------------------------------------
// ConquestPopupPass
// ---------------------------------------------------------------------------

export class ConquestPopupPass {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private maxInstances = 512;

  // Uniform locations
  private uCamera: WebGLUniformLocation;
  private uZoom: WebGLUniformLocation;
  private uMinScreenScale: WebGLUniformLocation;
  private uDistRange: WebGLUniformLocation;

  private vao: WebGLVertexArrayObject;
  private instanceBuf: WebGLBuffer;
  private instanceData: Float32Array;
  private instanceCount = 0;

  private glyphMetricsTex: WebGLTexture;
  private atlasTex: WebGLTexture | null = null;
  private atlasReady = false;

  // CPU-side glyph tables for layoutString
  private glyph: GlyphTables;
  private kernTable: Int8Array;

  // Reusable buffers for layoutString
  private charCodes = new Uint8Array(MAX_CHARS);
  private cursors = new Float32Array(MAX_CHARS);

  private distanceRange: number;
  private fontSize: number;
  private atlasScaleH: number;
  private base: number;

  // Active popups (both conquest and bonus, unified)
  private active: ActivePopup[] = [];

  // Settings reference
  private settings: RenderSettings;

  // Map width for tile→x/y conversion
  private mapW = 0;

  // Pluggable time source (same pattern as FxPass)
  private timeFn: () => number = () => performance.now();
  private now(): number {
    return this.timeFn();
  }

  constructor(gl: WebGL2RenderingContext, settings: RenderSettings) {
    this.gl = gl;
    this.settings = settings;

    // Parse atlas data (shared with NamePass/StructureLevelPass)
    const atlas = parseAtlasData();
    this.glyph = buildGlyphTables(atlas.chars);
    this.kernTable = new Int8Array(CHAR_RANGE * CHAR_RANGE);
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
    this.uMinScreenScale = gl.getUniformLocation(
      this.program,
      "uMinScreenScale",
    )!;
    this.uDistRange = gl.getUniformLocation(this.program, "uDistRange")!;

    // Glyph metrics data texture
    this.glyphMetricsTex = buildGlyphMetricsTex(gl, atlas);

    // Start async MSDF atlas load
    this.loadAtlas();

    // Instance buffer
    this.instanceData = new Float32Array(
      this.maxInstances * FLOATS_PER_INSTANCE,
    );
    this.instanceBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      this.instanceData.byteLength,
      gl.DYNAMIC_DRAW,
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

    // Per-instance attributes from instance buffer
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuf);
    // Attribute 1: vec4 (worldX, worldY, cursorX, charCode) at offset 0
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, BYTES_PER_INSTANCE, 0);
    gl.vertexAttribDivisor(1, 1);
    // Attribute 2: vec4 (alpha, colorR, colorG, colorB) at offset 16
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, BYTES_PER_INSTANCE, 16);
    gl.vertexAttribDivisor(2, 1);
    // Attribute 3: vec2 (scale, outlineWidth) at offset 32
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 2, gl.FLOAT, false, BYTES_PER_INSTANCE, 32);
    gl.vertexAttribDivisor(3, 1);

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

  setMapWidth(w: number): void {
    this.mapW = w;
  }

  // -------------------------------------------------------------------------
  // Event input
  // -------------------------------------------------------------------------

  applyConquestEvents(events: ConquestFx[]): void {
    const now = this.now();
    for (const evt of events) {
      const startMs = now - (evt.tickAge ?? 0) * MS_PER_TICK;
      if (now - startMs >= CONQUEST_LIFETIME_MS) continue;
      this.active.push({
        x: evt.x,
        y: evt.y + CONQUEST_Y_OFFSET,
        text: "+ " + formatGold(evt.gold),
        startMs,
        lifetimeMs: CONQUEST_LIFETIME_MS,
        riseSpeed: 0,
        colorR: 1,
        colorG: 1,
        colorB: 1,
        scale: CONQUEST_SCALE,
        outlineWidth: CONQUEST_OUTLINE_WIDTH,
      });
    }
  }

  applyBonusEvents(events: BonusEvent[]): void {
    if (this.mapW === 0) return;
    const now = this.now();
    const s = this.settings.bonusPopup;
    for (const evt of events) {
      if (evt.gold === 0) continue;
      const x = evt.tile % this.mapW;
      const y = Math.floor(evt.tile / this.mapW);
      const sign = evt.gold >= 0 ? "+" : "-";
      this.active.push({
        x,
        y: y + s.yOffset,
        text: sign + " " + formatGold(Math.abs(evt.gold)),
        startMs: now,
        lifetimeMs: s.lifetimeMs,
        riseSpeed: s.riseSpeed,
        colorR: s.colorR,
        colorG: s.colorG,
        colorB: s.colorB,
        scale: s.scale,
        outlineWidth: s.outlineWidth,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Tick — cull expired, rebuild instance buffer
  // -------------------------------------------------------------------------

  tick(): void {
    if (this.active.length === 0) return;
    const now = this.now();

    // Remove expired popups (swap-remove)
    for (let i = this.active.length - 1; i >= 0; i--) {
      if (now - this.active[i].startMs >= this.active[i].lifetimeMs) {
        this.active[i] = this.active[this.active.length - 1];
        this.active.pop();
      }
    }

    this.rebuildInstances(now);
  }

  private rebuildInstances(now: number): void {
    let count = 0;

    for (const popup of this.active) {
      const elapsed = now - popup.startMs;
      const alpha = Math.max(0, 1 - elapsed / popup.lifetimeMs);
      if (alpha <= 0) continue;

      // Rise animation: move upward over time
      const riseY =
        popup.riseSpeed > 0
          ? popup.y - (elapsed / 1000) * popup.riseSpeed
          : popup.y;

      layoutString(
        popup.text,
        this.glyph,
        this.kernTable,
        this.charCodes,
        this.cursors,
      );
      const len = Math.min(popup.text.length, MAX_CHARS);

      for (let i = 0; i < len; i++) {
        if (this.charCodes[i] === 0) continue;
        if (count >= this.maxInstances) {
          this.growBuffer();
        }

        const off = count * FLOATS_PER_INSTANCE;
        this.instanceData[off + 0] = popup.x;
        this.instanceData[off + 1] = riseY;
        this.instanceData[off + 2] = this.cursors[i];
        this.instanceData[off + 3] = this.charCodes[i];
        this.instanceData[off + 4] = alpha;
        this.instanceData[off + 5] = popup.colorR;
        this.instanceData[off + 6] = popup.colorG;
        this.instanceData[off + 7] = popup.colorB;
        this.instanceData[off + 8] = popup.scale;
        this.instanceData[off + 9] = popup.outlineWidth;
        count++;
      }
    }

    this.instanceCount = count;
  }

  private growBuffer(): void {
    this.maxInstances *= 2;
    const newData = new Float32Array(this.maxInstances * FLOATS_PER_INSTANCE);
    newData.set(this.instanceData);
    this.instanceData = newData;
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      this.instanceData.byteLength,
      gl.DYNAMIC_DRAW,
    );
  }

  // -------------------------------------------------------------------------
  // Draw
  // -------------------------------------------------------------------------

  draw(cameraMatrix: Float32Array, zoom: number): void {
    if (!this.atlasReady || this.instanceCount === 0) return;
    if (zoom < this.settings.bonusPopup.cullZoom) return;

    const gl = this.gl;
    gl.useProgram(this.program);
    gl.uniformMatrix3fv(this.uCamera, false, cameraMatrix);
    gl.uniform1f(this.uZoom, zoom);
    gl.uniform1f(this.uMinScreenScale, this.settings.bonusPopup.minScreenScale);
    gl.uniform1f(this.uDistRange, this.distanceRange);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTex!);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.glyphMetricsTex);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuf);
    gl.bufferSubData(
      gl.ARRAY_BUFFER,
      0,
      this.instanceData,
      0,
      this.instanceCount * FLOATS_PER_INSTANCE,
    );

    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.instanceCount);
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /** Override the time source. Default: performance.now (wall clock). */
  setTimeFn(fn: () => number): void {
    this.timeFn = fn;
  }

  clear(): void {
    this.active.length = 0;
    this.instanceCount = 0;
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.program);
    gl.deleteBuffer(this.instanceBuf);
    gl.deleteVertexArray(this.vao);
    gl.deleteTexture(this.glyphMetricsTex);
    if (this.atlasTex) gl.deleteTexture(this.atlasTex);
  }
}
