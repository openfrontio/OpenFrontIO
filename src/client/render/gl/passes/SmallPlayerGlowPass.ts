/**
 * SmallPlayerGlowPass — a soft, breathing red aura around "small" players'
 * territory. Tile-space bloom (extract mask -> separable blur -> additive
 * composite), so it's camera-independent and cheap; mirrors FalloutBloomPass.
 * A no-op unless the highlight set is non-empty.
 */

import type { RenderSettings } from "../RenderSettings";
import blurFragSrc from "../shaders/shared/blur.frag.glsl?raw";
import fullscreenNoUvVertSrc from "../shaders/shared/fullscreen-no-uv.vert.glsl?raw";
import fullscreenVertSrc from "../shaders/shared/fullscreen.vert.glsl?raw";
import compositeFragSrc from "../shaders/small-player-glow/composite.frag.glsl?raw";
import compositeVertSrc from "../shaders/small-player-glow/composite.vert.glsl?raw";
import extractFragSrc from "../shaders/small-player-glow/extract.frag.glsl?raw";
import { getPaletteSize } from "../utils/ColorUtils";
import {
  createFullscreenQuad,
  createMapQuad,
  createProgram,
  createTexture2D,
  type RenderTarget,
  shaderSrc,
  toScreen,
  toTarget,
} from "../utils/GlUtils";
import { TILE_DEFINES } from "../utils/TileCodec";

const SET_TEX_WIDTH = getPaletteSize(); // 1 px per owner smallID
const BLOOM_TILE_SCALE = 4; // bloom buffers run at 1/scale tile resolution

export class SmallPlayerGlowPass {
  private gl: WebGL2RenderingContext;
  private settings: RenderSettings["smallPlayerGlow"];
  private mapW: number;
  private mapH: number;
  private tileTex: WebGLTexture;

  private extractProg: WebGLProgram;
  private blurProg: WebGLProgram;
  private compositeProg: WebGLProgram;

  private uExtractMapSize: WebGLUniformLocation;
  private uBlurDir: WebGLUniformLocation;
  private uCompositeCam: WebGLUniformLocation;
  private uCompositeMapSize: WebGLUniformLocation;
  private uGlowColor: WebGLUniformLocation;
  private uIntensity: WebGLUniformLocation;

  private setTex: WebGLTexture;
  private targetA: RenderTarget;
  private targetB: RenderTarget;
  private mapVao: WebGLVertexArrayObject;
  private quadVao: WebGLVertexArrayObject;

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
    this.settings = settings;
    this.mapW = mapW;
    this.mapH = mapH;
    this.tileTex = tileTex;

    this.extractProg = createProgram(
      gl,
      fullscreenNoUvVertSrc,
      shaderSrc(extractFragSrc, {
        ...TILE_DEFINES,
        TILE_SCALE: BLOOM_TILE_SCALE,
      }),
    );
    this.uExtractMapSize = gl.getUniformLocation(this.extractProg, "uMapSize")!;
    gl.useProgram(this.extractProg);
    gl.uniform1i(gl.getUniformLocation(this.extractProg, "uTileTex"), 0);
    gl.uniform1i(gl.getUniformLocation(this.extractProg, "uHighlightSet"), 1);

    this.blurProg = createProgram(gl, fullscreenVertSrc, blurFragSrc);
    this.uBlurDir = gl.getUniformLocation(this.blurProg, "uDir")!;
    gl.useProgram(this.blurProg);
    gl.uniform1i(gl.getUniformLocation(this.blurProg, "uTex"), 0);

    this.compositeProg = createProgram(gl, compositeVertSrc, compositeFragSrc);
    this.uCompositeCam = gl.getUniformLocation(this.compositeProg, "uCamera")!;
    this.uCompositeMapSize = gl.getUniformLocation(
      this.compositeProg,
      "uMapSize",
    )!;
    this.uGlowColor = gl.getUniformLocation(this.compositeProg, "uGlowColor")!;
    this.uIntensity = gl.getUniformLocation(this.compositeProg, "uIntensity")!;
    gl.useProgram(this.compositeProg);
    gl.uniform1i(gl.getUniformLocation(this.compositeProg, "uTex"), 0);

    this.setTex = createTexture2D(gl, {
      width: SET_TEX_WIDTH,
      height: 1,
      internalFormat: gl.R8UI,
      format: gl.RED_INTEGER,
      type: gl.UNSIGNED_BYTE,
      data: null,
      filter: gl.NEAREST,
    });

    const bw = Math.max(1, Math.floor(mapW / BLOOM_TILE_SCALE));
    const bh = Math.max(1, Math.floor(mapH / BLOOM_TILE_SCALE));
    this.targetA = this.createTarget(bw, bh);
    this.targetB = this.createTarget(bw, bh);
    this.mapVao = createMapQuad(gl, mapW, mapH);
    this.quadVao = createFullscreenQuad(gl);
  }

  private createTarget(w: number, h: number): RenderTarget {
    const gl = this.gl;
    const tex = createTexture2D(gl, {
      width: w,
      height: h,
      internalFormat: gl.RGBA8,
      format: gl.RGBA,
      type: gl.UNSIGNED_BYTE,
      data: null,
      filter: gl.LINEAR,
    });
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      tex,
      0,
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { fbo, tex, w, h };
  }

  /** Push the highlight set (1 byte per owner smallID), or null to disable. */
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
    const canvas = gl.canvas as HTMLCanvasElement;
    const a = this.targetA;
    const b = this.targetB;

    const now = performance.now();
    if (this.lastTime > 0) {
      this.animTime += (now - this.lastTime) * s.pulseSpeed;
    }
    this.lastTime = now;
    const pulse = 0.5 + 0.5 * Math.sin(this.animTime);

    gl.disable(gl.BLEND);

    // Extract the small-player mask at sub-tile resolution.
    gl.useProgram(this.extractProg);
    gl.uniform2f(this.uExtractMapSize, this.mapW, this.mapH);
    toTarget(gl, a, () => {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.tileTex);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.setTex);
      gl.bindVertexArray(this.quadVao);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    });

    // Separable blur: horizontal into B, vertical back into A.
    gl.useProgram(this.blurProg);
    gl.activeTexture(gl.TEXTURE0);
    toTarget(gl, b, () => {
      gl.uniform2f(this.uBlurDir, 1 / a.w, 0);
      gl.bindTexture(gl.TEXTURE_2D, a.tex);
      gl.bindVertexArray(this.quadVao);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    });
    toTarget(gl, a, () => {
      gl.uniform2f(this.uBlurDir, 0, 1 / b.h);
      gl.bindTexture(gl.TEXTURE_2D, b.tex);
      gl.bindVertexArray(this.quadVao);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    });

    // Composite the blurred aura over the map (premultiplied, additive).
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    toScreen(gl, canvas.width, canvas.height, () => {
      gl.useProgram(this.compositeProg);
      gl.uniformMatrix3fv(this.uCompositeCam, false, cameraMatrix);
      gl.uniform2f(this.uCompositeMapSize, this.mapW, this.mapH);
      gl.uniform3fv(this.uGlowColor, s.color);
      gl.uniform1f(this.uIntensity, s.alpha * pulse);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, a.tex);
      gl.bindVertexArray(this.mapVao);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    });
    gl.bindVertexArray(null);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); // restore overlay default
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.extractProg);
    gl.deleteProgram(this.blurProg);
    gl.deleteProgram(this.compositeProg);
    gl.deleteTexture(this.setTex);
    gl.deleteTexture(this.targetA.tex);
    gl.deleteTexture(this.targetB.tex);
    gl.deleteFramebuffer(this.targetA.fbo);
    gl.deleteFramebuffer(this.targetB.fbo);
    gl.deleteVertexArray(this.mapVao);
    gl.deleteVertexArray(this.quadVao);
    // tileTex owned by GPUResources
  }
}
