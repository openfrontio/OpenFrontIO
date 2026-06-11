/**
 * CoordinateGridPass — procedural grid overlay with cell labels.
 *
 * Draws white grid lines at cell boundaries and alphanumeric labels
 * (A1, B2, ...) at the top-left of each cell. Grid computation matches
 * the upstream game's CoordinateGridLayer.
 */

import type { RenderSettings } from "../RenderSettings";
import { createMapQuad, createProgram } from "../utils/GlUtils";

import gridFragSrc from "../shaders/grid/grid.frag.glsl?raw";
import overlayVertSrc from "../shaders/map-overlay/overlay.vert.glsl?raw";

const BASE_CELL_COUNT = 10;
const MAX_COLUMNS = 50;
const MIN_ROWS = 2;

const GLYPH_W = 24;
const GLYPH_H = 36;
const CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export class CoordinateGridPass {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private glyphTex: WebGLTexture;

  private uCamera: WebGLUniformLocation;
  private uMapSize: WebGLUniformLocation;
  private uCellSize: WebGLUniformLocation;
  private uZoom: WebGLUniformLocation;
  private uFontSize: WebGLUniformLocation;
  private uOpacity: WebGLUniformLocation;

  private mapW: number;
  private mapH: number;
  private cellSize: number;
  private settings: RenderSettings;

  constructor(
    gl: WebGL2RenderingContext,
    mapW: number,
    mapH: number,
    settings: RenderSettings,
  ) {
    this.gl = gl;
    this.mapW = mapW;
    this.mapH = mapH;
    this.cellSize = computeCellSize(mapW, mapH);
    this.settings = settings;

    this.glyphTex = this.createGlyphAtlas();

    this.program = createProgram(gl, overlayVertSrc, gridFragSrc);
    this.uCamera = gl.getUniformLocation(this.program, "uCamera")!;
    this.uMapSize = gl.getUniformLocation(this.program, "uMapSize")!;
    this.uCellSize = gl.getUniformLocation(this.program, "uCellSize")!;
    this.uZoom = gl.getUniformLocation(this.program, "uZoom")!;
    this.uFontSize = gl.getUniformLocation(this.program, "uFontSize")!;
    this.uOpacity = gl.getUniformLocation(this.program, "uOpacity")!;

    gl.useProgram(this.program);
    gl.uniform1i(gl.getUniformLocation(this.program, "uGlyphTex"), 0);

    this.vao = createMapQuad(gl, mapW, mapH);
  }

  draw(cameraMatrix: Float32Array, zoom: number): void {
    const gl = this.gl;

    gl.useProgram(this.program);
    gl.uniformMatrix3fv(this.uCamera, false, cameraMatrix);
    gl.uniform2f(this.uMapSize, this.mapW, this.mapH);
    gl.uniform1f(this.uCellSize, this.cellSize);
    gl.uniform1f(this.uZoom, zoom);
    gl.uniform1f(this.uFontSize, this.settings.altView.gridFontSize);
    gl.uniform1f(this.uOpacity, this.settings.mapOverlay.coordinateGridOpacity);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.glyphTex);

    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.program);
    gl.deleteVertexArray(this.vao);
    gl.deleteTexture(this.glyphTex);
  }

  /** Render A-Z, 0-9 glyphs into a single-row texture atlas. */
  private createGlyphAtlas(): WebGLTexture {
    const canvas = document.createElement("canvas");
    canvas.width = CHARS.length * GLYPH_W;
    canvas.height = GLYPH_H;

    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "black";
    ctx.lineWidth = 4;
    ctx.fillStyle = "white";
    ctx.font = `bold ${GLYPH_H - 8}px monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    for (let i = 0; i < CHARS.length; i++) {
      ctx.strokeText(CHARS[i], i * GLYPH_W + GLYPH_W / 2, GLYPH_H / 2);
      ctx.fillText(CHARS[i], i * GLYPH_W + GLYPH_W / 2, GLYPH_H / 2);
    }

    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    return tex;
  }
}

/** Compute cell size matching upstream CoordinateGridLayer.computeGrid(). */
function computeCellSize(mapW: number, mapH: number): number {
  const raw = Math.min(mapW, mapH) / BASE_CELL_COUNT;
  let rows = Math.max(1, Math.round(mapH / raw));
  let cols = Math.max(1, Math.round(mapW / raw));

  if (cols > MAX_COLUMNS) {
    const maxRows = Math.floor((MAX_COLUMNS * mapH) / mapW);
    rows = Math.max(MIN_ROWS, Math.min(rows, maxRows));
    cols = MAX_COLUMNS;
  }

  return Math.min(mapW / cols, mapH / rows);
}
