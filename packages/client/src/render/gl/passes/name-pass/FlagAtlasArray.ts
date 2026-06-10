/**
 * FlagAtlasArray — runtime TEXTURE_2D_ARRAY of player flag images.
 *
 * Replaces the build-time flag atlas. Layers are assigned on demand as players
 * arrive, keyed by URL so identical flags share a layer (every "Mercia" bot
 * costs one slot, not one per player). Images are fetched async and drawn into
 * a fixed-size cell so all layers have the same dimensions.
 *
 * When a layer becomes ready, `onLayerReady(url, layer)` fires so the owning
 * pass can flip slots from -1 to the assigned layer.
 *
 * Layers are not reclaimed; if the cap is hit, further requests return -1 and
 * render no icon.
 */

const FLAG_CELL_W = 128;
const FLAG_CELL_H = 85;

/** Hard cap on unique flags per game. Real working set is ~50–200. */
export const MAX_FLAG_LAYERS = 512;

interface PendingEntry {
  layer: number;
  ready: boolean;
}

export class FlagAtlasArray {
  private gl: WebGL2RenderingContext;
  private tex: WebGLTexture;
  private layerCount: number;
  private nextLayer = 0;

  private entries = new Map<string, PendingEntry>();
  private onLayerReady: (url: string, layer: number) => void;

  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  constructor(
    gl: WebGL2RenderingContext,
    onLayerReady: (url: string, layer: number) => void,
  ) {
    this.gl = gl;
    this.onLayerReady = onLayerReady;

    const maxLayers = gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS) as number;
    this.layerCount = Math.min(MAX_FLAG_LAYERS, maxLayers);

    this.tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.tex);
    gl.texStorage3D(
      gl.TEXTURE_2D_ARRAY,
      mipLevels(FLAG_CELL_W, FLAG_CELL_H),
      gl.RGBA8,
      FLAG_CELL_W,
      FLAG_CELL_H,
      this.layerCount,
    );
    gl.texParameteri(
      gl.TEXTURE_2D_ARRAY,
      gl.TEXTURE_MIN_FILTER,
      gl.LINEAR_MIPMAP_LINEAR,
    );
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    this.canvas = document.createElement("canvas");
    this.canvas.width = FLAG_CELL_W;
    this.canvas.height = FLAG_CELL_H;
    this.ctx = this.canvas.getContext("2d", { willReadFrequently: false })!;
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
    if (this.nextLayer >= this.layerCount) return; // hit cap → no icon

    const layer = this.nextLayer++;
    const entry: PendingEntry = { layer, ready: false };
    this.entries.set(url, entry);

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      // Draw into a fixed-size cell to normalize the image to layer dimensions.
      // Center via aspect-fit so non-3:2 flags don't stretch.
      this.ctx.clearRect(0, 0, FLAG_CELL_W, FLAG_CELL_H);
      const srcAspect = img.width / img.height;
      const dstAspect = FLAG_CELL_W / FLAG_CELL_H;
      let dw: number, dh: number;
      if (srcAspect > dstAspect) {
        dw = FLAG_CELL_W;
        dh = FLAG_CELL_W / srcAspect;
      } else {
        dh = FLAG_CELL_H;
        dw = FLAG_CELL_H * srcAspect;
      }
      const dx = (FLAG_CELL_W - dw) * 0.5;
      const dy = (FLAG_CELL_H - dh) * 0.5;
      this.ctx.drawImage(img, dx, dy, dw, dh);

      const gl = this.gl;
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.tex);
      gl.texSubImage3D(
        gl.TEXTURE_2D_ARRAY,
        0,
        0,
        0,
        layer,
        FLAG_CELL_W,
        FLAG_CELL_H,
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
      console.warn("Flag image failed to load:", url);
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
