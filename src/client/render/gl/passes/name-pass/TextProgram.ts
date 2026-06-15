/**
 * TextProgram — MSDF text rendering (player names + troop counts).
 *
 * Supports two MSDF fonts, switchable per draw via settings.name.classicFont:
 *   - default: the overpass-bold atlas.
 *   - classic: the Arial (Arimo) atlas — same MSDF format, installed via
 *     setArialFont.
 * Each font carries its own metrics (em size, baseline, atlas dimensions,
 * distance range); the active set is pushed to the shader per draw. The sibling
 * icon/status passes are kept aligned by NamePass via their own setFont().
 *
 * Owns: shader program, uniform locations, both atlas textures. Glyph-metric /
 * cursor / string / player-data textures are passed in and bound at draw time
 * but not owned here.
 */

import { assetUrl } from "src/core/AssetUrls";
import type { RenderSettings } from "../../RenderSettings";
import nameFragSrc from "../../shaders/name/name.frag.glsl?raw";
import nameVertSrc from "../../shaders/name/name.vert.glsl?raw";
import { createProgram, shaderSrc } from "../../utils/GlUtils";
import type { ParsedAtlas } from "./Types";
import { LINES_PER_PLAYER, MAX_CHARS } from "./Types";

const atlasUrl = assetUrl("atlases/msdf-atlas.png");
const arialAtlasUrl = assetUrl("atlases/arial-atlas.png");

export interface TextProgramTextures {
  glyphMetrics: WebGLTexture;
  cursor: WebGLTexture;
  strings: WebGLTexture;
  playerData: WebGLTexture;
}

/** Per-font GPU resources + metrics. */
interface FontGpu {
  atlasTex: WebGLTexture | null;
  metricsTex: WebGLTexture | null;
  fontSize: number;
  base: number;
  scaleW: number;
  scaleH: number;
  distanceRange: number;
}

export class TextProgram {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private textures: TextProgramTextures;

  private msdf: FontGpu;
  private arial: FontGpu;

  // Uniform locations
  private uCamera: WebGLUniformLocation;
  private uTime: WebGLUniformLocation;
  private uFontSize: WebGLUniformLocation;
  private uBase: WebGLUniformLocation;
  private uAtlasScaleW: WebGLUniformLocation;
  private uAtlasScaleH: WebGLUniformLocation;
  private uDistRange: WebGLUniformLocation;
  private uLerpSpeed: WebGLUniformLocation;
  private uCullThreshold: WebGLUniformLocation;
  private uNameScaleFactor: WebGLUniformLocation;
  private uNameScaleCap: WebGLUniformLocation;
  private uTroopSizeMultiplier: WebGLUniformLocation;
  private uHighlightOwnerID: WebGLUniformLocation;
  private uFadeOwnerID: WebGLUniformLocation;
  private uHoverFadeAlpha: WebGLUniformLocation;
  private uOutlineWidth: WebGLUniformLocation;
  private uNightAmbient: WebGLUniformLocation;
  private uOutlineColor: WebGLUniformLocation;
  private uOutlineUsePlayerColor: WebGLUniformLocation;
  private uFillUsePlayerColor: WebGLUniformLocation;
  private uHoverGlowWidth: WebGLUniformLocation;
  private uHoverGlowAlpha: WebGLUniformLocation;

  constructor(
    gl: WebGL2RenderingContext,
    atlas: ParsedAtlas,
    textures: TextProgramTextures,
  ) {
    this.gl = gl;
    this.textures = textures;

    this.msdf = {
      atlasTex: null,
      metricsTex: textures.glyphMetrics,
      fontSize: atlas.fontSize,
      base: atlas.base,
      scaleW: atlas.scaleW,
      scaleH: atlas.scaleH,
      distanceRange: atlas.distanceRange,
    };
    this.arial = {
      atlasTex: null,
      metricsTex: null,
      fontSize: atlas.fontSize,
      base: atlas.base,
      scaleW: atlas.scaleW,
      scaleH: atlas.scaleH,
      distanceRange: atlas.distanceRange,
    };

    this.program = createProgram(
      gl,
      shaderSrc(nameVertSrc, { MAX_CHARS, LINES_PER_PLAYER }),
      nameFragSrc,
    );

    // Texture unit bindings
    gl.useProgram(this.program);
    gl.uniform1i(gl.getUniformLocation(this.program, "uAtlas"), 0);
    gl.uniform1i(gl.getUniformLocation(this.program, "uGlyphMetrics"), 1);
    gl.uniform1i(gl.getUniformLocation(this.program, "uCursorX"), 2);
    gl.uniform1i(gl.getUniformLocation(this.program, "uStrings"), 3);
    gl.uniform1i(gl.getUniformLocation(this.program, "uPlayerData"), 4);

    // Dynamic uniform locations
    this.uCamera = gl.getUniformLocation(this.program, "uCamera")!;
    this.uTime = gl.getUniformLocation(this.program, "uTime")!;
    this.uFontSize = gl.getUniformLocation(this.program, "uFontSize")!;
    this.uBase = gl.getUniformLocation(this.program, "uBase")!;
    this.uAtlasScaleW = gl.getUniformLocation(this.program, "uAtlasScaleW")!;
    this.uAtlasScaleH = gl.getUniformLocation(this.program, "uAtlasScaleH")!;
    this.uDistRange = gl.getUniformLocation(this.program, "uDistRange")!;
    this.uLerpSpeed = gl.getUniformLocation(this.program, "uLerpSpeed")!;
    this.uCullThreshold = gl.getUniformLocation(
      this.program,
      "uCullThreshold",
    )!;
    this.uNameScaleFactor = gl.getUniformLocation(
      this.program,
      "uNameScaleFactor",
    )!;
    this.uNameScaleCap = gl.getUniformLocation(this.program, "uNameScaleCap")!;
    this.uTroopSizeMultiplier = gl.getUniformLocation(
      this.program,
      "uTroopSizeMultiplier",
    )!;
    this.uHighlightOwnerID = gl.getUniformLocation(
      this.program,
      "uHighlightOwnerID",
    )!;
    this.uFadeOwnerID = gl.getUniformLocation(this.program, "uFadeOwnerID")!;
    this.uHoverFadeAlpha = gl.getUniformLocation(
      this.program,
      "uHoverFadeAlpha",
    )!;
    this.uOutlineWidth = gl.getUniformLocation(this.program, "uOutlineWidth")!;
    this.uNightAmbient = gl.getUniformLocation(this.program, "uNightAmbient")!;
    this.uOutlineColor = gl.getUniformLocation(this.program, "uOutlineColor")!;
    this.uOutlineUsePlayerColor = gl.getUniformLocation(
      this.program,
      "uOutlineUsePlayerColor",
    )!;
    this.uFillUsePlayerColor = gl.getUniformLocation(
      this.program,
      "uFillUsePlayerColor",
    )!;
    this.uHoverGlowWidth = gl.getUniformLocation(
      this.program,
      "uHoverGlowWidth",
    )!;
    this.uHoverGlowAlpha = gl.getUniformLocation(
      this.program,
      "uHoverGlowAlpha",
    )!;

    this.loadAtlas(atlasUrl, this.msdf);
  }

  /** True when the atlas for the requested font is uploaded and drawable. */
  isReady(classic: boolean): boolean {
    return (classic ? this.arial.atlasTex : this.msdf.atlasTex) !== null;
  }

  /** Install the classic (Arial/Arimo) MSDF atlas: metrics + async-loaded image. */
  setArialFont(metricsTex: WebGLTexture, atlas: ParsedAtlas): void {
    this.arial.metricsTex = metricsTex;
    this.arial.fontSize = atlas.fontSize;
    this.arial.base = atlas.base;
    this.arial.scaleW = atlas.scaleW;
    this.arial.scaleH = atlas.scaleH;
    this.arial.distanceRange = atlas.distanceRange;
    this.loadAtlas(arialAtlasUrl, this.arial);
  }

  private loadAtlas(url: string, font: FontGpu): void {
    const gl = this.gl;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const tex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      font.atlasTex = tex;
    };
    img.src = url;
  }

  draw(
    cameraMatrix: Float32Array,
    settings: RenderSettings,
    vao: WebGLVertexArrayObject,
    maxPlayers: number,
    ambient: number,
    highlightOwnerID: number,
    fadeOwnerID: number,
    classic: boolean,
  ): void {
    if (!this.isReady(classic)) return;

    const gl = this.gl;
    const ns = settings.name;
    const font = classic ? this.arial : this.msdf;
    gl.useProgram(this.program);

    gl.uniformMatrix3fv(this.uCamera, false, cameraMatrix);
    gl.uniform1f(this.uTime, performance.now() / 1000);
    gl.uniform1f(this.uFontSize, font.fontSize);
    gl.uniform1f(this.uBase, font.base);
    gl.uniform1f(this.uAtlasScaleW, font.scaleW);
    gl.uniform1f(this.uAtlasScaleH, font.scaleH);
    gl.uniform1f(this.uDistRange, font.distanceRange);
    gl.uniform1f(this.uLerpSpeed, ns.lerpSpeed);
    gl.uniform1f(this.uCullThreshold, ns.cullThreshold);
    gl.uniform1f(this.uNameScaleFactor, ns.nameScaleFactor);
    gl.uniform1f(this.uNameScaleCap, ns.nameScaleCap);
    gl.uniform1f(this.uTroopSizeMultiplier, ns.troopSizeMultiplier);
    gl.uniform1f(this.uHighlightOwnerID, highlightOwnerID);
    gl.uniform1f(this.uFadeOwnerID, fadeOwnerID);
    gl.uniform1f(this.uHoverFadeAlpha, ns.hoverFadeAlpha);
    gl.uniform1f(this.uOutlineWidth, ns.outlineWidth);
    gl.uniform1f(this.uNightAmbient, ambient);
    gl.uniform3f(this.uOutlineColor, ns.outlineR, ns.outlineG, ns.outlineB);
    gl.uniform1f(
      this.uOutlineUsePlayerColor,
      ns.outlineUsePlayerColor ? 1.0 : 0.0,
    );
    gl.uniform1f(this.uFillUsePlayerColor, ns.fillUsePlayerColor ? 1.0 : 0.0);
    gl.uniform1f(this.uHoverGlowWidth, ns.hoverGlowWidth);
    gl.uniform1f(this.uHoverGlowAlpha, ns.hoverGlowAlpha);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, font.atlasTex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, font.metricsTex);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.textures.cursor);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.textures.strings);
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, this.textures.playerData);

    gl.bindVertexArray(vao);
    gl.drawArraysInstanced(
      gl.TRIANGLES,
      0,
      6,
      maxPlayers * LINES_PER_PLAYER * MAX_CHARS,
    );
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.program);
    if (this.msdf.atlasTex) gl.deleteTexture(this.msdf.atlasTex);
    if (this.arial.atlasTex) gl.deleteTexture(this.arial.atlasTex);
  }
}
