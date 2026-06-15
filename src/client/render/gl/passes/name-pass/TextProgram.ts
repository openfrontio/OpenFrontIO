/**
 * TextProgram — text rendering for player names + troop counts.
 *
 * Supports two fonts, switchable per draw via settings.name.classicFont:
 *   - MSDF: the overpass-bold atlas (default), loaded async from CDN.
 *   - classic: an Arial bitmap coverage atlas built at runtime (set via
 *     setArialFont), drawn fill-only (no synthesized outline).
 * Both fonts share the em size (48) and baseline (36), so name sizing and the
 * sibling icon/status passes are unaffected by the choice.
 *
 * Owns: shader program, uniform locations, the MSDF atlas texture and the
 * Arial atlas texture. Glyph-metric / cursor / string / player-data textures
 * are passed in and bound at draw time but not owned here.
 */

import { assetUrl } from "src/core/AssetUrls";
import type { RenderSettings } from "../../RenderSettings";
import nameFragSrc from "../../shaders/name/name.frag.glsl?raw";
import nameVertSrc from "../../shaders/name/name.vert.glsl?raw";
import { createProgram, shaderSrc } from "../../utils/GlUtils";
import type { ParsedAtlas } from "./Types";
import { LINES_PER_PLAYER, MAX_CHARS } from "./Types";

const atlasUrl = assetUrl("atlases/msdf-atlas.png");

export interface TextProgramTextures {
  glyphMetrics: WebGLTexture;
  cursor: WebGLTexture;
  strings: WebGLTexture;
  playerData: WebGLTexture;
}

export class TextProgram {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private textures: TextProgramTextures;

  // MSDF atlas (async-loaded)
  private atlasTex: WebGLTexture | null = null;
  private atlasReady = false;
  private msdfScaleW: number;
  private msdfScaleH: number;
  private distanceRange: number;

  // Arial bitmap atlas (built at runtime, set via setArialFont)
  private arialAtlasTex: WebGLTexture | null = null;
  private arialMetricsTex: WebGLTexture | null = null;
  private arialScaleW = 0;
  private arialScaleH = 0;

  // Uniform locations
  private uCamera: WebGLUniformLocation;
  private uTime: WebGLUniformLocation;
  private uDistRange: WebGLUniformLocation;
  private uAtlasScaleW: WebGLUniformLocation;
  private uAtlasScaleH: WebGLUniformLocation;
  private uClassic: WebGLUniformLocation;
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
    this.distanceRange = atlas.distanceRange;
    this.msdfScaleW = atlas.scaleW;
    this.msdfScaleH = atlas.scaleH;

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

    // Static uniforms — em size + baseline are shared by both fonts.
    gl.uniform1f(
      gl.getUniformLocation(this.program, "uFontSize")!,
      atlas.fontSize,
    );
    gl.uniform1f(gl.getUniformLocation(this.program, "uBase")!, atlas.base);

    // Dynamic uniform locations
    this.uCamera = gl.getUniformLocation(this.program, "uCamera")!;
    this.uTime = gl.getUniformLocation(this.program, "uTime")!;
    this.uDistRange = gl.getUniformLocation(this.program, "uDistRange")!;
    this.uAtlasScaleW = gl.getUniformLocation(this.program, "uAtlasScaleW")!;
    this.uAtlasScaleH = gl.getUniformLocation(this.program, "uAtlasScaleH")!;
    this.uClassic = gl.getUniformLocation(this.program, "uClassic")!;
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

    this.loadAtlas();
  }

  /** True when the atlas for the requested font is uploaded and drawable. */
  isReady(classic: boolean): boolean {
    return classic ? this.arialAtlasTex !== null : this.atlasReady;
  }

  /**
   * Install the runtime-built Arial bitmap atlas (coverage mask) + metrics.
   * The atlas is supersampled (rendered renderScale× finer than the em metrics),
   * so the uAtlasScale uniforms carry atlas-pixels-per-em = realPixels/renderScale.
   */
  setArialFont(
    canvas: HTMLCanvasElement,
    metricsTex: WebGLTexture,
    scaleW: number,
    scaleH: number,
    renderScale: number,
  ): void {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    this.arialAtlasTex = tex;
    this.arialMetricsTex = metricsTex;
    this.arialScaleW = scaleW / renderScale;
    this.arialScaleH = scaleH / renderScale;
  }

  private loadAtlas(): void {
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
      this.atlasTex = tex;
      this.atlasReady = true;
    };
    img.src = atlasUrl;
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
    gl.useProgram(this.program);

    const atlasTex = classic ? this.arialAtlasTex! : this.atlasTex!;
    const metricsTex = classic
      ? this.arialMetricsTex!
      : this.textures.glyphMetrics;
    const scaleW = classic ? this.arialScaleW : this.msdfScaleW;
    const scaleH = classic ? this.arialScaleH : this.msdfScaleH;
    const distRange = classic ? 0 : this.distanceRange;

    gl.uniformMatrix3fv(this.uCamera, false, cameraMatrix);
    gl.uniform1f(this.uTime, performance.now() / 1000);
    gl.uniform1f(this.uDistRange, distRange);
    gl.uniform1f(this.uAtlasScaleW, scaleW);
    gl.uniform1f(this.uAtlasScaleH, scaleH);
    gl.uniform1i(this.uClassic, classic ? 1 : 0);
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
    gl.bindTexture(gl.TEXTURE_2D, atlasTex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, metricsTex);
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
    if (this.atlasTex) gl.deleteTexture(this.atlasTex);
    if (this.arialAtlasTex) gl.deleteTexture(this.arialAtlasTex);
  }
}
