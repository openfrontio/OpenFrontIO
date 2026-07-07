/**
 * SmallPlayerGlowPass — a pulsing glow that radiates from the territory of
 * "small" players (the highlight set pushed each tick). One map-covering quad;
 * the fragment shader searches a small tile neighborhood so scattered fragments
 * each radiate their own halo and merge into a clean glow.
 *
 * Active only while the highlight set is non-empty (the lobby toggle is on and
 * the game is past halftime) — otherwise draw() is a no-op and costs nothing.
 */

import type { RenderSettings } from "../RenderSettings";
import glowFragSrc from "../shaders/small-player-glow/small-player-glow.frag.glsl?raw";
import glowVertSrc from "../shaders/small-player-glow/small-player-glow.vert.glsl?raw";
import {
  createFullscreenQuad,
  createProgram,
  createTexture2D,
  shaderSrc,
} from "../utils/GlUtils";
import { TILE_DEFINES } from "../utils/TileCodec";

// 1 px per owner smallID; matches PALETTE_SIZE (OWNER_MASK max + 1).
const SET_TEX_WIDTH = 4096;

export class SmallPlayerGlowPass {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private settings: RenderSettings["smallPlayerGlow"];

  private setTex: WebGLTexture;
  private mapW: number;
  private mapH: number;
  private tileTex: WebGLTexture;

  private uCamera: WebGLUniformLocation;
  private uMapSize: WebGLUniformLocation;
  private uRadius: WebGLUniformLocation;
  private uGlowColor: WebGLUniformLocation;
  private uGlowAlpha: WebGLUniformLocation;
  private uPulse: WebGLUniformLocation;

  private active = false;
  private animTime = 0;
  private lastTime = 0;

  constructor(
    gl: WebGL2RenderingContext,
    mapW: number,
    mapH: number,
    tileTex: WebGLTexture,
    settings: RenderSettings["smallPlayerGlow"],
  ) {
    this.gl = gl;
    this.mapW = mapW;
    this.mapH = mapH;
    this.tileTex = tileTex;
    this.settings = settings;

    this.program = createProgram(
      gl,
      glowVertSrc,
      shaderSrc(glowFragSrc, { ...TILE_DEFINES }),
    );

    this.uCamera = gl.getUniformLocation(this.program, "uCamera")!;
    this.uMapSize = gl.getUniformLocation(this.program, "uMapSize")!;
    this.uRadius = gl.getUniformLocation(this.program, "uRadius")!;
    this.uGlowColor = gl.getUniformLocation(this.program, "uGlowColor")!;
    this.uGlowAlpha = gl.getUniformLocation(this.program, "uGlowAlpha")!;
    this.uPulse = gl.getUniformLocation(this.program, "uPulse")!;

    gl.useProgram(this.program);
    gl.uniform1i(gl.getUniformLocation(this.program, "uTileTex"), 0);
    gl.uniform1i(gl.getUniformLocation(this.program, "uHighlightSet"), 1);

    this.setTex = createTexture2D(gl, {
      width: SET_TEX_WIDTH,
      height: 1,
      internalFormat: gl.R8UI,
      format: gl.RED_INTEGER,
      type: gl.UNSIGNED_BYTE,
      data: null,
      filter: gl.NEAREST,
    });

    this.vao = createFullscreenQuad(gl);
  }

  /**
   * Push the highlight set: 1 byte per owner smallID (1 = glow), or null to
   * turn the glow off. Uploaded immediately, so the caller may reuse the array.
   */
  update(set: Uint8Array | null): void {
    if (set === null) {
      this.active = false;
      return;
    }
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.setTex);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      Math.min(set.length, SET_TEX_WIDTH),
      1,
      gl.RED_INTEGER,
      gl.UNSIGNED_BYTE,
      set,
    );
    this.active = true;
  }

  draw(cameraMatrix: Float32Array): void {
    if (!this.active) return;

    const gl = this.gl;
    const s = this.settings;
    const now = performance.now();
    if (this.lastTime > 0) {
      this.animTime += (now - this.lastTime) * s.pulseSpeed;
    }
    this.lastTime = now;
    const pulse = 0.5 + 0.5 * Math.sin(this.animTime);

    gl.useProgram(this.program);
    gl.uniformMatrix3fv(this.uCamera, false, cameraMatrix);
    gl.uniform2f(this.uMapSize, this.mapW, this.mapH);
    gl.uniform1i(this.uRadius, Math.round(s.radius));
    gl.uniform3f(this.uGlowColor, s.color[0], s.color[1], s.color[2]);
    gl.uniform1f(this.uGlowAlpha, s.alpha);
    gl.uniform1f(this.uPulse, pulse);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tileTex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.setTex);

    // Additive blend for the glow; restore the overlay default afterwards so
    // subsequent overlay passes render normally.
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.program);
    gl.deleteTexture(this.setTex);
    gl.deleteVertexArray(this.vao);
    // tileTex owned by GPUResources
  }
}
