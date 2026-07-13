/**
 * SmallPlayerGlowPass — a soft, breathing red aura around "small" players'
 * territory. Tile-space bloom (extract mask -> separable blur -> additive
 * composite), so it's camera-independent and cheap; mirrors FalloutBloomPass.
 * A no-op unless the highlight set is non-empty.
 */

import { UserSettings } from "../../../../core/game/UserSettings";
import type { RenderSettings } from "../RenderSettings";
import blurFragSrc from "../shaders/shared/blur.frag.glsl?raw";
import fullscreenNoUvVertSrc from "../shaders/shared/fullscreen-no-uv.vert.glsl?raw";
import fullscreenVertSrc from "../shaders/shared/fullscreen.vert.glsl?raw";
import compositeVertSrc from "../shaders/shared/map-quad.vert.glsl?raw";
import compositeFragSrc from "../shaders/small-player-glow/composite.frag.glsl?raw";
import extractFragSrc from "../shaders/small-player-glow/extract.frag.glsl?raw";
import { getPaletteSize } from "../utils/ColorUtils";
import {
  createFullscreenQuad,
  createMapQuad,
  createProgram,
  createRenderTarget,
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
  private dirty = false; // aura needs rebuilding (set changed)
  private animTime = 0;
  private lastTime = 0;
  private lastPasses = 1; // last width the aura was blurred at (to detect change)
  private readonly userSettings = new UserSettings();

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

    // ceil (not floor) so a partial tile block at the map's right/bottom edge
    // still gets a bloom cell — otherwise an edge player on a map whose size
    // isn't a multiple of the scale gets no glow.
    const bw = Math.max(1, Math.ceil(mapW / BLOOM_TILE_SCALE));
    const bh = Math.max(1, Math.ceil(mapH / BLOOM_TILE_SCALE));
    this.targetA = createRenderTarget(gl, bw, bh);
    this.targetB = createRenderTarget(gl, bw, bh);
    this.mapVao = createMapQuad(gl, mapW, mapH);
    this.quadVao = createFullscreenQuad(gl);
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
    this.dirty = true;
  }

  // Strength (0 = off, 1 = default width) -> blur iterations; each iteration
  // widens the Gaussian aura. Non-linear so the slider ramps gently low and
  // grows fast toward the top: 500% ≈ 82 passes (very wide). Clamped for perf.
  private passesFor(strength: number): number {
    return Math.min(96, Math.max(1, Math.round(strength ** 2.74)));
  }

  // One separable-blur axis: sample `src`, write the blurred result into `dst`.
  private blurAxis(
    src: RenderTarget,
    dst: RenderTarget,
    dx: number,
    dy: number,
  ): void {
    const gl = this.gl;
    toTarget(gl, dst, () => {
      gl.uniform2f(this.uBlurDir, dx, dy);
      gl.bindTexture(gl.TEXTURE_2D, src.tex);
      gl.bindVertexArray(this.quadVao);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    });
  }

  draw(cameraMatrix: Float32Array): void {
    // Read the user Strength every frame (not tick-gated) so the slider is
    // live even while the sim is paused (e.g. the settings modal is open).
    const strength = this.userSettings.highlightGlowStrength();
    if (!this.active || strength <= 0) return;

    const gl = this.gl;
    const s = this.settings;
    const canvas = gl.canvas as HTMLCanvasElement;
    const a = this.targetA;
    const b = this.targetB;

    const now = performance.now();
    if (this.lastTime > 0) {
      // Clamp the delta so a long gap (grace period, or a backgrounded tab
      // pausing rAF) doesn't leap the pulse to a random phase on resume.
      this.animTime += Math.min(now - this.lastTime, 100) * s.pulseSpeed;
    }
    this.lastTime = now;
    const pulse = 0.5 + 0.5 * Math.sin(this.animTime);
    const passes = this.passesFor(strength);
    if (passes !== this.lastPasses) {
      this.dirty = true; // width changed -> rebuild the aura this frame
      this.lastPasses = passes;
    }

    // Rebuild the blurred aura only when the set changed (~1/s); its inputs
    // don't move faster than that. The composite below still runs every frame.
    if (this.dirty) {
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

      // Separable blur, iterated `passes` times to widen the aura (more
      // iterations = wider Gaussian). Each pass: horizontal A->B, vertical B->A.
      gl.useProgram(this.blurProg);
      gl.activeTexture(gl.TEXTURE0);
      for (let k = 0; k < passes; k++) {
        this.blurAxis(a, b, 1 / a.w, 0); // horizontal A->B
        this.blurAxis(b, a, 0, 1 / b.h); // vertical B->A
      }
      this.dirty = false;
    }

    // Composite the cached aura over the map every frame. Premultiplied-over
    // (not pure additive) so the glow keeps its color over bright terrain
    // instead of washing out to white.
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    toScreen(gl, canvas.width, canvas.height, () => {
      gl.useProgram(this.compositeProg);
      gl.uniformMatrix3fv(this.uCompositeCam, false, cameraMatrix);
      gl.uniform2f(this.uCompositeMapSize, this.mapW, this.mapH);
      gl.uniform3fv(this.uGlowColor, s.color);
      // Widening spreads the mask thinner, so scale intensity up to keep the
      // glow about as bright (wider, not darker), capped by the shader's alpha.
      gl.uniform1f(this.uIntensity, s.alpha * pulse * Math.sqrt(passes));
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
