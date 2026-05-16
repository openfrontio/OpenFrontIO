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

import type { RenderSettings } from "../render-settings";
import { createFullscreenQuad, createProgram } from "../utils/gl-utils";

import compositeFragSrc from "../shaders/day-night/composite.frag.glsl?raw";
import fullscreenVertSrc from "../shaders/shared/fullscreen.vert.glsl?raw";

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

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

  getAmbient(tick: number): number {
    const dn = this.settings.dayNight;

    if (dn.mode === "light") return dn.dayAmbient;
    if (dn.mode === "dark") return dn.nightAmbient;

    // Normalize phase to [0, 1), 0 = noon
    const phase = (((tick / dn.cycleTicks + dn.startPhase) % 1) + 1) % 1;

    // Clamp holds so they never exceed the full cycle
    const noonHold = Math.min(dn.noonHold, 1);
    const nightHold = Math.min(dn.nightHold, Math.max(0, 1 - noonHold));
    const halfTransition = (1 - noonHold - nightHold) / 2;

    // Region boundaries (all in [0, 1))
    const duskStart = noonHold / 2;
    const duskEnd = duskStart + halfTransition; // = 0.5 - nightHold/2
    const nightEnd = duskEnd + nightHold; // = 0.5 + nightHold/2
    const dawnEnd = nightEnd + halfTransition; // = 1   - noonHold/2

    let t: number;
    if (phase < duskStart || phase >= dawnEnd) {
      t = 1; // noon hold
    } else if (phase < duskEnd) {
      t = smoothstep(duskEnd, duskStart, phase); // day → night
    } else if (phase < nightEnd) {
      t = 0; // midnight hold
    } else {
      t = smoothstep(nightEnd, dawnEnd, phase); // night → day
    }

    return dn.nightAmbient + (dn.dayAmbient - dn.nightAmbient) * t;
  }

  // -------------------------------------------------------------------------
  // Composite: scene * (ambient + lightmap) → screen
  // -------------------------------------------------------------------------

  /** Pure combiner — receives captured scene + lightmap textures, outputs to screen. */
  draw(tick: number, sceneTex: WebGLTexture, lightmapTex: WebGLTexture): void {
    const gl = this.gl;
    gl.disable(gl.BLEND);

    gl.useProgram(this.compositeProg);
    gl.uniform1f(this.uCompositeAmbient, this.getAmbient(tick));

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
