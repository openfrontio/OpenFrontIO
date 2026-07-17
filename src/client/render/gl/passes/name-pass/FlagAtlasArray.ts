/**
 * FlagAtlasArray — runtime TEXTURE_2D_ARRAY of player icon images.
 *
 * Replaces the build-time flag atlas. One instance holds flags (3:2 cells);
 * a second instance holds crown cosmetics (square cells). Layers are assigned
 * on demand as players arrive, keyed by URL so identical images share a layer
 * (every "Mercia" bot costs one slot, not one per player). Images are fetched
 * async and drawn into a fixed-size cell so all layers have the same
 * dimensions.
 *
 * When a layer becomes ready, `onLayerReady(url, layer)` fires so the owning
 * pass can flip slots from -1 to the assigned layer.
 *
 * Layers are not reclaimed. When the initial capacity fills, the array doubles
 * (existing layers are copied GPU-side); at the hardware layer cap further
 * requests render no icon.
 */

export const FLAG_CELL_W = 128;
export const FLAG_CELL_H = 85;

/** Initial unique-flag capacity. Real working set is ~50–200. */
export const MAX_FLAG_LAYERS = 512;

interface PendingEntry {
  layer: number;
  ready: boolean;
}

export class FlagAtlasArray {
  private gl: WebGL2RenderingContext;
  private tex: WebGLTexture;
  private layerCount: number;
  private readonly hwMaxLayers: number;
  private nextLayer = 0;

  private entries = new Map<string, PendingEntry>();
  private onLayerReady: (url: string, layer: number) => void;

  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  constructor(
    gl: WebGL2RenderingContext,
    onLayerReady: (url: string, layer: number) => void,
    private cellW: number = FLAG_CELL_W,
    private cellH: number = FLAG_CELL_H,
    initialLayers: number = MAX_FLAG_LAYERS,
  ) {
    this.gl = gl;
    this.onLayerReady = onLayerReady;

    this.hwMaxLayers = gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS) as number;
    this.layerCount = Math.min(initialLayers, this.hwMaxLayers);
    this.tex = this.allocTexture(this.layerCount);

    this.canvas = document.createElement("canvas");
    this.canvas.width = this.cellW;
    this.canvas.height = this.cellH;
    this.ctx = this.canvas.getContext("2d", { willReadFrequently: false })!;
  }

  /** Allocate the immutable texture array; leaves it bound to TEXTURE_2D_ARRAY. */
  private allocTexture(layerCount: number): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
    gl.texStorage3D(
      gl.TEXTURE_2D_ARRAY,
      mipLevels(this.cellW, this.cellH),
      gl.RGBA8,
      this.cellW,
      this.cellH,
      layerCount,
    );
    gl.texParameteri(
      gl.TEXTURE_2D_ARRAY,
      gl.TEXTURE_MIN_FILTER,
      gl.LINEAR_MIPMAP_LINEAR,
    );
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  /**
   * Double the layer capacity, copying existing layers into the new texture
   * GPU-side (texStorage3D is immutable, so growth means a new allocation).
   * Returns false at the hardware layer cap. Draw calls pick up the new
   * texture automatically — owners bind `this.texture` every frame.
   */
  private grow(): boolean {
    const newCount = Math.min(this.layerCount * 2, this.hwMaxLayers);
    if (newCount <= this.layerCount) return false;

    const gl = this.gl;
    const newTex = this.allocTexture(newCount);

    const fb = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, fb);
    for (let layer = 0; layer < this.nextLayer; layer++) {
      gl.framebufferTextureLayer(
        gl.READ_FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        this.tex,
        0,
        layer,
      );
      gl.copyTexSubImage3D(
        gl.TEXTURE_2D_ARRAY,
        0,
        0,
        0,
        layer,
        0,
        0,
        this.cellW,
        this.cellH,
      );
    }
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.deleteFramebuffer(fb);
    gl.generateMipmap(gl.TEXTURE_2D_ARRAY);

    gl.deleteTexture(this.tex);
    this.tex = newTex;
    this.layerCount = newCount;
    return true;
  }

  get texture(): WebGLTexture {
    return this.tex;
  }

  /** Layer index for an already-loaded URL, or -1 if pending/missing/unassigned. */
  getLayer(url: string): number {
    const e = this.entries.get(url);
    return e && e.ready ? e.layer : -1;
  }

  /**
   * Request a flag. Returns immediately; `onLayerReady` fires once the image is
   * loaded and uploaded. Subsequent calls for the same URL are no-ops.
   */
  request(url: string): void {
    if (this.entries.has(url)) return;
    if (this.nextLayer >= this.layerCount && !this.grow()) {
      return; // hardware layer cap → no icon
    }

    const layer = this.nextLayer++;
    const entry: PendingEntry = { layer, ready: false };
    this.entries.set(url, entry);

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      // Draw into a fixed-size cell to normalize the image to layer dimensions.
      // Center via aspect-fit so mismatched images don't stretch.
      this.ctx.clearRect(0, 0, this.cellW, this.cellH);
      const srcAspect = img.width / img.height;
      const dstAspect = this.cellW / this.cellH;
      let dw: number, dh: number;
      if (srcAspect > dstAspect) {
        dw = this.cellW;
        dh = this.cellW / srcAspect;
      } else {
        dh = this.cellH;
        dw = this.cellH * srcAspect;
      }
      const dx = (this.cellW - dw) * 0.5;
      const dy = (this.cellH - dh) * 0.5;
      this.ctx.drawImage(img, dx, dy, dw, dh);

      const gl = this.gl;
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.tex);
      gl.texSubImage3D(
        gl.TEXTURE_2D_ARRAY,
        0,
        0,
        0,
        layer,
        this.cellW,
        this.cellH,
        1,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        this.canvas,
      );
      gl.generateMipmap(gl.TEXTURE_2D_ARRAY);

      entry.ready = true;
      this.onLayerReady(url, layer);
    };
    img.onerror = () => {
      // Leave entry as not-ready forever; layer is consumed but harmless.
      console.warn("Icon image failed to load:", url);
    };
    img.src = url;
  }

  dispose(): void {
    this.gl.deleteTexture(this.tex);
    this.entries.clear();
  }
}

function mipLevels(w: number, h: number): number {
  return Math.floor(Math.log2(Math.max(w, h))) + 1;
}
