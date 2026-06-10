/**
 * NightCompositePass — scene capture + day/night composite.
 *
 * Owns the scene capture FBO: terrain + territory render into it when
 * day/night is enabled. Composites the captured scene with a blurred
 * lightmap: output = scene * min(ambient + lightmap, 1.2).
 *
 * At full daytime (ambient ≈ 1.0) the composite is a visual identity —
 * multiplication by ~1.0 — so the pass runs continuously with no threshold.
 */

import type { RenderSettings } from "../RenderSettings";
import { createFullscreenQuad, createProgram } from "../utils/GlUtils";

import compositeFragSrc from "../shaders/day-night/composite.frag.glsl?raw";
import fullscreenVertSrc from "../shaders/shared/fullscreen.vert.glsl?raw";

export class NightCompositePass {
  private gl: WebGL2RenderingContext;
  private settings: RenderSettings;

  // Composite program
  private compositeProg: WebGLProgram;
  private uCompositeAmbient: WebGLUniformLocation;
  private quadVao: WebGLVertexArrayObject;

  constructor(gl: WebGL2RenderingContext, settings: RenderSettings) {
    this.gl = gl;
    this.settings = settings;

    // --- Composite program ---
    this.compositeProg = createProgram(gl, fullscreenVertSrc, compositeFragSrc);
    this.uCompositeAmbient = gl.getUniformLocation(
      this.compositeProg,
      "uAmbient",
    )!;
    gl.useProgram(this.compositeProg);
    gl.uniform1i(gl.getUniformLocation(this.compositeProg, "uSceneTex"), 0);
    gl.uniform1i(gl.getUniformLocation(this.compositeProg, "uLightTex"), 1);

    // --- Fullscreen quad ---
    this.quadVao = createFullscreenQuad(gl);
  }

  // -------------------------------------------------------------------------
  // Ambient
  // -------------------------------------------------------------------------

  getAmbient(): number {
    return this.settings.lighting.ambient;
  }

  // -------------------------------------------------------------------------
  // Composite: scene * (ambient + lightmap) → screen
  // -------------------------------------------------------------------------

  /** Pure combiner — receives captured scene + lightmap textures, outputs to screen. */
  draw(sceneTex: WebGLTexture, lightmapTex: WebGLTexture): void {
    const gl = this.gl;
    gl.disable(gl.BLEND);

    gl.useProgram(this.compositeProg);
    gl.uniform1f(this.uCompositeAmbient, this.getAmbient());

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sceneTex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, lightmapTex);

    gl.bindVertexArray(this.quadVao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.compositeProg);
    gl.deleteVertexArray(this.quadVao);
  }
}
