/**
 * DebugProgram — wireframe bounding boxes for name/flag layout debugging.
 *
 * Owns: shader program, uniform locations.
 * The shared playerDataTex is passed in but not owned/deleted.
 */

import type { RenderSettings } from "../../RenderSettings";
import debugBoxFragSrc from "../../shaders/name/debug-box.frag.glsl?raw";
import debugBoxVertSrc from "../../shaders/name/debug-box.vert.glsl?raw";
import { createProgram } from "../../utils/GlUtils";
import type { ParsedAtlas } from "./Types";

// Must match FLAG_CELL_W / FLAG_CELL_H in FlagAtlasArray.ts.
const FLAG_CELL_W = 128;
const FLAG_CELL_H = 85;

export class DebugProgram {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private playerDataTex: WebGLTexture;
  private maxPlayers: number;

  private uCamera: WebGLUniformLocation;
  private uTime: WebGLUniformLocation;
  private uLerpSpeed: WebGLUniformLocation;
  private uCullThreshold: WebGLUniformLocation;
  private uNameScaleFactor: WebGLUniformLocation;
  private uNameScaleCap: WebGLUniformLocation;

  constructor(
    gl: WebGL2RenderingContext,
    atlas: ParsedAtlas,
    playerDataTex: WebGLTexture,
    maxPlayers: number,
  ) {
    this.gl = gl;
    this.playerDataTex = playerDataTex;
    this.maxPlayers = maxPlayers;

    this.program = createProgram(gl, debugBoxVertSrc, debugBoxFragSrc);
    gl.useProgram(this.program);
    gl.uniform1i(gl.getUniformLocation(this.program, "uPlayerData"), 0);
    gl.uniform1f(
      gl.getUniformLocation(this.program, "uFontSize")!,
      atlas.fontSize,
    );
    gl.uniform1f(gl.getUniformLocation(this.program, "uFontBase")!, atlas.base);
    gl.uniform1f(
      gl.getUniformLocation(this.program, "uFlagCellW")!,
      FLAG_CELL_W,
    );
    gl.uniform1f(
      gl.getUniformLocation(this.program, "uFlagCellH")!,
      FLAG_CELL_H,
    );

    this.uCamera = gl.getUniformLocation(this.program, "uCamera")!;
    this.uTime = gl.getUniformLocation(this.program, "uTime")!;
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
  }

  draw(
    cameraMatrix: Float32Array,
    settings: RenderSettings,
    vao: WebGLVertexArrayObject,
  ): void {
    const gl = this.gl;
    const ns = settings.name;
    gl.useProgram(this.program);

    gl.uniformMatrix3fv(this.uCamera, false, cameraMatrix);
    gl.uniform1f(this.uTime, performance.now() / 1000);
    gl.uniform1f(this.uLerpSpeed, ns.lerpSpeed);
    gl.uniform1f(this.uCullThreshold, ns.cullThreshold);
    gl.uniform1f(this.uNameScaleFactor, ns.nameScaleFactor);
    gl.uniform1f(this.uNameScaleCap, ns.nameScaleCap);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.playerDataTex);

    gl.bindVertexArray(vao);
    // 3 instances per player: name box, flag box, center dot
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.maxPlayers * 3);
  }

  dispose(): void {
    this.gl.deleteProgram(this.program);
  }
}
