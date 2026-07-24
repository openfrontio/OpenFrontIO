/**
 * MapLayerPass — renders a single map-layer image between terrain and territory.
 *
 * Each layer is a full-size PNG (same dimensions as image.png) placed above
 * the terrain tiles but below player territory.  The fragment shader discards
 * pixels whose land/water type does not match the layer's "placement" and
 * (for nukeable layers) pixels that have been destroyed by a nuke.
 */

import layerFragSrc from "../shaders/map-layer/layer.frag.glsl?raw";
import layerVertSrc from "../shaders/map-layer/layer.vert.glsl?raw";
import {
  createMapQuad,
  createProgram,
  createTexture2D,
  shaderSrc,
} from "../utils/GlUtils";

export class MapLayerPass {
  private program: WebGLProgram;
  private layerTex: WebGLTexture;
  private destroyedTex: WebGLTexture;
  private vao: WebGLVertexArrayObject;
  private uCamera: WebGLUniformLocation;
  private uPlacement: WebGLUniformLocation;
  private uNukeable: WebGLUniformLocation;
  private uVisible: WebGLUniformLocation;

  /** CPU-side copy of the destroyed mask for context-restore re-uploads. */
  private destroyedData: Uint8Array;
  private _visible = true;

  constructor(
    private gl: WebGL2RenderingContext,
    /** Terrain-bytes R8UI texture (shared across all layer passes). */
    private terrainBytesTex: WebGLTexture,
    /** Layer RGBA image (ImageBitmap loaded from the layer PNG). */
    image: ImageBitmap,
    private mapW: number,
    private mapH: number,
    /** 0 = land layer, 1 = water layer. */
    private placement: 0 | 1,
    /** Whether the layer is destroyed by nukes. */
    private nukeable: boolean,
  ) {
    this.program = createProgram(
      gl,
      shaderSrc(layerVertSrc, { MAP_W: mapW, MAP_H: mapH }),
      shaderSrc(layerFragSrc, { MAP_W: mapW, MAP_H: mapH }),
    );
    this.uCamera = gl.getUniformLocation(this.program, "uCamera")!;
    this.uPlacement = gl.getUniformLocation(this.program, "uPlacement")!;
    this.uNukeable = gl.getUniformLocation(this.program, "uNukeable")!;
    this.uVisible = gl.getUniformLocation(this.program, "uVisible")!;

    // Layer RGBA texture from the ImageBitmap.
    this.layerTex = createTexture2D(gl, {
      width: image.width,
      height: image.height,
      internalFormat: gl.RGBA8,
      format: gl.RGBA,
      type: gl.UNSIGNED_BYTE,
      data: null,
      filter: gl.NEAREST,
    });
    gl.bindTexture(gl.TEXTURE_2D, this.layerTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, image);

    // Destroyed-mask texture (R8UI, one byte per tile). Starts all-zero.
    this.destroyedData = new Uint8Array(mapW * mapH);
    this.destroyedTex = createTexture2D(gl, {
      width: mapW,
      height: mapH,
      internalFormat: gl.R8UI,
      format: gl.RED_INTEGER,
      type: gl.UNSIGNED_BYTE,
      data: this.destroyedData,
      filter: gl.NEAREST,
    });

    this.vao = createMapQuad(gl, mapW, mapH);
  }

  // ------------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------------

  /** Show/hide this layer (driven by graphics settings). */
  setVisible(visible: boolean): void {
    this._visible = visible;
  }

  /**
   * Upload a per-tile destroyed mask.  Each element is 0 (intact) or 1
   * (destroyed by a nuke).  Only meaningful for nukeable layers.
   */
  updateDestroyedMask(data: Uint8Array): void {
    if (data.length !== this.mapW * this.mapH) return;
    this.destroyedData.set(data);
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.destroyedTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      this.mapW,
      this.mapH,
      gl.RED_INTEGER,
      gl.UNSIGNED_BYTE,
      this.destroyedData,
    );
  }

  /**
   * Mark a single tile as destroyed (for incremental nuke updates).
   * More efficient than re-uploading the full mask for each nuke.
   */
  markTileDestroyed(tileIndex: number): void {
    if (tileIndex < 0 || tileIndex >= this.mapW * this.mapH) return;
    if (this.destroyedData[tileIndex] === 1) return; // already destroyed
    this.destroyedData[tileIndex] = 1;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.destroyedTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    // Upload just the single byte.
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      tileIndex % this.mapW,
      Math.floor(tileIndex / this.mapW),
      1,
      1,
      gl.RED_INTEGER,
      gl.UNSIGNED_BYTE,
      new Uint8Array([1]),
    );
  }

  /** Re-upload all GPU resources (used after WebGL context restore). */
  restoreFrom(image: ImageBitmap): void {
    const gl = this.gl;
    // Re-create layer texture.
    gl.deleteTexture(this.layerTex);
    this.layerTex = createTexture2D(gl, {
      width: image.width,
      height: image.height,
      internalFormat: gl.RGBA8,
      format: gl.RGBA,
      type: gl.UNSIGNED_BYTE,
      data: null,
      filter: gl.NEAREST,
    });
    gl.bindTexture(gl.TEXTURE_2D, this.layerTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, image);
    // Re-upload destroyed mask.
    gl.deleteTexture(this.destroyedTex);
    this.destroyedTex = createTexture2D(gl, {
      width: this.mapW,
      height: this.mapH,
      internalFormat: gl.R8UI,
      format: gl.RED_INTEGER,
      type: gl.UNSIGNED_BYTE,
      data: this.destroyedData,
      filter: gl.NEAREST,
    });
  }

  // ------------------------------------------------------------------
  // Draw
  // ------------------------------------------------------------------

  draw(cam: Float32Array): void {
    const gl = this.gl;
    gl.useProgram(this.program);

    // Texture unit 0 — layer RGBA.
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.layerTex);
    // Texture unit 1 — terrain bytes (R8UI, shared).
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.terrainBytesTex);
    // Texture unit 2 — destroyed mask (R8UI).
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.destroyedTex);

    // Sampler bindings (match shader uniform locations).
    gl.uniform1i(gl.getUniformLocation(this.program, "uLayerTex")!, 0);
    gl.uniform1i(gl.getUniformLocation(this.program, "uTerrainBytes")!, 1);
    gl.uniform1i(gl.getUniformLocation(this.program, "uDestroyedMask")!, 2);

    gl.uniformMatrix3fv(this.uCamera, false, cam);
    gl.uniform1i(this.uPlacement, this.placement);
    gl.uniform1i(this.uNukeable, this.nukeable ? 1 : 0);
    gl.uniform1f(this.uVisible, this._visible ? 1.0 : 0.0);

    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
  }

  // ------------------------------------------------------------------
  // Cleanup
  // ------------------------------------------------------------------

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.program);
    gl.deleteTexture(this.layerTex);
    gl.deleteTexture(this.destroyedTex);
    gl.deleteVertexArray(this.vao);
  }
}
