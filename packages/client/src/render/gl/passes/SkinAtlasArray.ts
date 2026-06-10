/**
 * SkinAtlasArray — fixed-size TEXTURE_2D_ARRAY of territory skin PNGs.
 *
 * The player set is locked at game start, so the unique skin URL count is
 * known up front. The atlas allocates exactly that many `SKIN_DIM × SKIN_DIM`
 * layers once and never resizes. Each layer is filled in asynchronously as
 * its PNG decodes; `onLayerReady(url, layer)` fires per layer so callers can
 * patch their per-player layer table.
 *
 * If `urls` is empty the atlas binds a 1×1×1 placeholder so the shader's
 * `uSkinAtlas` sampler still has something to read from (the shader's
 * skinLayer table will be all zeros, so it never actually samples).
 *
 * Sampler wrap is CLAMP_TO_EDGE — the shader treats UVs outside [0,1] as
 * transparent so the image appears as a single stamp centered at the anchor.
 */

/** Per-side dimension for every atlas layer. Larger images are downscaled. */
export const SKIN_DIM = 1024;

export class SkinAtlasArray {
  private gl: WebGL2RenderingContext;
  private tex: WebGLTexture;
  /** url → layer index. Layers are assigned in iteration order at construction. */
  private layers = new Map<string, number>();
  private onLayerReady: (url: string, layer: number) => void;

  /**
   * @param urls Unique skin URLs needed for this game. If empty, the atlas is
   *   a 1×1×1 placeholder. Order determines layer assignment.
   */
  constructor(
    gl: WebGL2RenderingContext,
    urls: readonly string[],
    onLayerReady: (url: string, layer: number) => void,
  ) {
    this.gl = gl;
    this.onLayerReady = onLayerReady;

    if (urls.length === 0) {
      this.tex = this.makeTex(1, 1, 1);
      return;
    }

    this.tex = this.makeTex(SKIN_DIM, SKIN_DIM, urls.length);
    urls.forEach((url, layer) => {
      this.layers.set(url, layer);
      this.load(url, layer);
    });
  }

  get texture(): WebGLTexture {
    return this.tex;
  }

  /** Layer index for a URL, or -1 if this URL wasn't registered at construction. */
  getLayer(url: string): number {
    return this.layers.get(url) ?? -1;
  }

  private load(url: string, layer: number): void {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      this.uploadImage(img, layer);
      this.onLayerReady(url, layer);
    };
    img.onerror = () => {
      console.warn("Skin image failed to load:", url);
    };
    img.src = url;
  }

  /**
   * Draw image centered in a SKIN_DIM×SKIN_DIM canvas, downscale if larger,
   * keep native size if smaller. The shader samples cell-center as the spawn
   * anchor (UV 0.5), so centering keeps the image aligned with the spawn tile.
   */
  private uploadImage(img: HTMLImageElement, layer: number): void {
    const canvas = document.createElement("canvas");
    canvas.width = SKIN_DIM;
    canvas.height = SKIN_DIM;
    const ctx = canvas.getContext("2d", { willReadFrequently: false })!;
    const scale = Math.min(
      1,
      SKIN_DIM / img.naturalWidth,
      SKIN_DIM / img.naturalHeight,
    );
    const drawW = (img.naturalWidth * scale) | 0;
    const drawH = (img.naturalHeight * scale) | 0;
    const offX = ((SKIN_DIM - drawW) / 2) | 0;
    const offY = ((SKIN_DIM - drawH) / 2) | 0;
    ctx.drawImage(img, offX, offY, drawW, drawH);

    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.tex);
    gl.texSubImage3D(
      gl.TEXTURE_2D_ARRAY,
      0,
      0,
      0,
      layer,
      SKIN_DIM,
      SKIN_DIM,
      1,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      canvas,
    );
    gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
  }

  private makeTex(w: number, h: number, layerCount: number): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
    gl.texStorage3D(
      gl.TEXTURE_2D_ARRAY,
      mipLevels(w, h),
      gl.RGBA8,
      w,
      h,
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

  dispose(): void {
    this.gl.deleteTexture(this.tex);
    this.layers.clear();
  }
}

function mipLevels(w: number, h: number): number {
  return Math.floor(Math.log2(Math.max(w, h))) + 1;
}
