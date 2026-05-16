/**
 * TerrainPass — renders the static terrain map as a textured quad.
 *
 * The terrain never changes during a replay, so this texture is uploaded
 * exactly once and blitted every frame as the opaque background layer.
 *
 * Vertex shader transforms the map quad by the camera mat3.
 * Fragment shader samples the RGBA8 terrain texture with nearest-neighbour
 * filtering so each terrain cell stays pixel-crisp at every zoom level.
 */

import terrainFragSrc from "../shaders/terrain/terrain.frag.glsl?raw";
import terrainVertSrc from "../shaders/terrain/terrain.vert.glsl?raw";
import {
  createMapQuad,
  createProgram,
  createTexture2D,
  shaderSrc,
} from "../utils/gl-utils";

// ---------------------------------------------------------------------------
// TerrainPass
// ---------------------------------------------------------------------------

export class TerrainPass {
  private program: WebGLProgram;
  private tex: WebGLTexture;
  private vao: WebGLVertexArrayObject;
  private uCamera: WebGLUniformLocation;

  constructor(
    private gl: WebGL2RenderingContext,
    terrainRGBA: Uint8Array,
    mapW: number,
    mapH: number,
  ) {
    this.program = createProgram(
      gl,
      shaderSrc(terrainVertSrc, { MAP_W: mapW, MAP_H: mapH }),
      terrainFragSrc,
    );
    this.uCamera = gl.getUniformLocation(this.program, "uCamera")!;

    // Static RGBA8 terrain texture — uploaded once, never updated.
    this.tex = createTexture2D(gl, {
      width: mapW,
      height: mapH,
      internalFormat: gl.RGBA8,
      format: gl.RGBA,
      type: gl.UNSIGNED_BYTE,
      data: terrainRGBA,
      filter: gl.NEAREST, // pixel-crisp at all zoom levels
    });

    this.vao = createMapQuad(gl, mapW, mapH);
  }

  /** Render the terrain. Call with depth test disabled, no blending. */
  draw(cameraMatrix: Float32Array): void {
    const gl = this.gl;
    gl.useProgram(this.program);
    gl.uniformMatrix3fv(this.uCamera, false, cameraMatrix);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);

    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.program);
    gl.deleteTexture(this.tex);
    // VAO + buffer leak is acceptable on dispose (context is being destroyed)
  }
}
