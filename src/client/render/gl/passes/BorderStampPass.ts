/**
 * BorderStampPass — territory borders + defense checkerboard.
 *
 * Always draws at full brightness (after the optional night composite).
 * Reads pre-computed border flags and defense proximity
 * from the BorderComputePass RGBA8 buffer.
 */

import type { RenderSettings } from "../RenderSettings";
import { getPaletteSize } from "../utils/ColorUtils";
import { createMapQuad, createProgram, shaderSrc } from "../utils/GlUtils";
import { TILE_DEFINES } from "../utils/TileCodec";

import borderStampFragSrc from "../shaders/day-night/border-stamp.frag.glsl?raw";
import borderStampVertSrc from "../shaders/day-night/border-stamp.vert.glsl?raw";

export class BorderStampPass {
  private gl: WebGL2RenderingContext;
  private settings: RenderSettings;
  private mapW: number;
  private mapH: number;

  private program: WebGLProgram;
  private uCam: WebGLUniformLocation;
  private uMapSize: WebGLUniformLocation;
  private uHighlightBrighten: WebGLUniformLocation;
  private uDefenseCheckerDarken: WebGLUniformLocation;
  private uEmbargoTintRatio: WebGLUniformLocation;
  private uFriendlyTintRatio: WebGLUniformLocation;
  private uEmbargoTint: WebGLUniformLocation;
  private uFriendlyTint: WebGLUniformLocation;
  private uAltView: WebGLUniformLocation;

  private vao: WebGLVertexArrayObject;
  private tileTex: WebGLTexture;
  private paletteTex: WebGLTexture;
  private borderTex: WebGLTexture;
  private defenseCoverageTex: WebGLTexture | null = null;
  private affiliationTex: WebGLTexture | null = null;
  private altView = false;

  constructor(
    gl: WebGL2RenderingContext,
    mapW: number,
    mapH: number,
    tileTex: WebGLTexture,
    paletteTex: WebGLTexture,
    borderTex: WebGLTexture,
    settings: RenderSettings,
  ) {
    this.gl = gl;
    this.settings = settings;
    this.mapW = mapW;
    this.mapH = mapH;
    this.tileTex = tileTex;
    this.paletteTex = paletteTex;
    this.borderTex = borderTex;

    this.program = createProgram(
      gl,
      borderStampVertSrc,
      shaderSrc(borderStampFragSrc, {
        PALETTE_SIZE: getPaletteSize(),
        ...TILE_DEFINES,
      }),
    );
    this.uCam = gl.getUniformLocation(this.program, "uCamera")!;
    this.uMapSize = gl.getUniformLocation(this.program, "uMapSize")!;
    this.uHighlightBrighten = gl.getUniformLocation(
      this.program,
      "uHighlightBrighten",
    )!;
    this.uDefenseCheckerDarken = gl.getUniformLocation(
      this.program,
      "uDefenseCheckerDarken",
    )!;
    this.uEmbargoTintRatio = gl.getUniformLocation(
      this.program,
      "uEmbargoTintRatio",
    )!;
    this.uFriendlyTintRatio = gl.getUniformLocation(
      this.program,
      "uFriendlyTintRatio",
    )!;
    this.uEmbargoTint = gl.getUniformLocation(this.program, "uEmbargoTint")!;
    this.uFriendlyTint = gl.getUniformLocation(this.program, "uFriendlyTint")!;
    this.uAltView = gl.getUniformLocation(this.program, "uAltView")!;

    gl.useProgram(this.program);
    gl.uniform1i(gl.getUniformLocation(this.program, "uTileTex"), 0);
    gl.uniform1i(gl.getUniformLocation(this.program, "uPalette"), 1);
    gl.uniform1i(gl.getUniformLocation(this.program, "uBorderTex"), 2);
    gl.uniform1i(gl.getUniformLocation(this.program, "uAffiliation"), 3);
    gl.uniform1i(gl.getUniformLocation(this.program, "uDefenseCoverageTex"), 4);

    this.vao = createMapQuad(gl, mapW, mapH);
  }

  setAltView(active: boolean): void {
    this.altView = active;
  }
  setAffiliationTex(tex: WebGLTexture): void {
    this.affiliationTex = tex;
  }
  setDefenseCoverageTex(tex: WebGLTexture): void {
    this.defenseCoverageTex = tex;
  }

  /** Draw borders + defense checkerboard. Blending must be enabled. */
  draw(cameraMatrix: Float32Array): void {
    const gl = this.gl;
    const mo = this.settings.mapOverlay;

    gl.useProgram(this.program);
    gl.uniformMatrix3fv(this.uCam, false, cameraMatrix);
    gl.uniform2f(this.uMapSize, this.mapW, this.mapH);
    gl.uniform1f(this.uHighlightBrighten, mo.highlightBrighten);
    gl.uniform1f(this.uDefenseCheckerDarken, mo.defenseCheckerDarken);
    gl.uniform1f(this.uEmbargoTintRatio, mo.embargoTintRatio);
    gl.uniform1f(this.uFriendlyTintRatio, mo.friendlyTintRatio);
    gl.uniform3f(
      this.uEmbargoTint,
      mo.embargoTintR,
      mo.embargoTintG,
      mo.embargoTintB,
    );
    gl.uniform3f(
      this.uFriendlyTint,
      mo.friendlyTintR,
      mo.friendlyTintG,
      mo.friendlyTintB,
    );
    gl.uniform1i(this.uAltView, this.altView ? 1 : 0);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tileTex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.paletteTex);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.borderTex);
    if (this.affiliationTex) {
      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_2D, this.affiliationTex);
    }
    if (this.defenseCoverageTex) {
      gl.activeTexture(gl.TEXTURE4);
      gl.bindTexture(gl.TEXTURE_2D, this.defenseCoverageTex);
    }

    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.program);
    gl.deleteVertexArray(this.vao);
  }
}
