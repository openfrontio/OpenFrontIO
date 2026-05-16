/**
 * TrailPass — boat trail lines.
 *
 * Simple dedicated pass: for each tile with a non-zero trail owner,
 * output the owner's territory color at configurable alpha.
 * Always draws at full brightness (after night composite).
 */

import type { RenderSettings } from "../render-settings";
import { getPaletteSize } from "../utils/color-utils";
import { createMapQuad, createProgram, shaderSrc } from "../utils/gl-utils";
import { TILE_DEFINES } from "../utils/tile-codec";

import overlayVertSrc from "../shaders/map-overlay/overlay.vert.glsl?raw";
import trailFragSrc from "../shaders/map-overlay/trail.frag.glsl?raw";

export class TrailPass {
  private gl: WebGL2RenderingContext;
  private settings: RenderSettings;
  private mapW: number;
  private mapH: number;

  private program: WebGLProgram;
  private uCamera: WebGLUniformLocation;
  private uMapSize: WebGLUniformLocation;
  private uTrailAlpha: WebGLUniformLocation;
  private uAltView: WebGLUniformLocation;

  private vao: WebGLVertexArrayObject;
  private trailTex: WebGLTexture;
  private paletteTex: WebGLTexture;
  private affiliationTex: WebGLTexture | null = null;
  private altView = false;

  constructor(
    gl: WebGL2RenderingContext,
    mapW: number,
    mapH: number,
    trailTex: WebGLTexture,
    paletteTex: WebGLTexture,
    settings: RenderSettings,
  ) {
    this.gl = gl;
    this.settings = settings;
    this.mapW = mapW;
    this.mapH = mapH;
    this.trailTex = trailTex;
    this.paletteTex = paletteTex;

    this.program = createProgram(
      gl,
      overlayVertSrc,
      shaderSrc(trailFragSrc, {
        PALETTE_SIZE: getPaletteSize(),
        ...TILE_DEFINES,
      }),
    );
    this.uCamera = gl.getUniformLocation(this.program, "uCamera")!;
    this.uMapSize = gl.getUniformLocation(this.program, "uMapSize")!;
    this.uTrailAlpha = gl.getUniformLocation(this.program, "uTrailAlpha")!;
    this.uAltView = gl.getUniformLocation(this.program, "uAltView")!;

    gl.useProgram(this.program);
    gl.uniform1i(gl.getUniformLocation(this.program, "uTrailTex"), 0);
    gl.uniform1i(gl.getUniformLocation(this.program, "uPalette"), 1);
    gl.uniform1i(gl.getUniformLocation(this.program, "uAffiliation"), 2);

    this.vao = createMapQuad(gl, mapW, mapH);
  }

  setAltView(active: boolean): void {
    this.altView = active;
  }
  setAffiliationTex(tex: WebGLTexture): void {
    this.affiliationTex = tex;
  }

  /** Draw trail overlay. Blending must be enabled by caller. */
  draw(cameraMatrix: Float32Array): void {
    const gl = this.gl;

    gl.useProgram(this.program);
    gl.uniformMatrix3fv(this.uCamera, false, cameraMatrix);
    gl.uniform2f(this.uMapSize, this.mapW, this.mapH);
    gl.uniform1f(this.uTrailAlpha, this.settings.mapOverlay.trailAlpha);
    gl.uniform1i(this.uAltView, this.altView ? 1 : 0);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.trailTex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.paletteTex);
    if (this.affiliationTex) {
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, this.affiliationTex);
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
