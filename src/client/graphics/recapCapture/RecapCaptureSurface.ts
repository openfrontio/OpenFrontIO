import { GameView } from "../../../core/game/GameView";
import { TransformHandler } from "../TransformHandler";
import { Layer } from "../layers/Layer";

export interface CaptureViewport {
  width: number;
  height: number;
}

export interface CaptureResult {
  blob: Blob;
  imageBitmap?: ImageBitmap;
  width: number;
  height: number;
}

export interface CaptureOptions {
  layers: Layer[];
  game: GameView;
  transformHandler: TransformHandler;
  viewport: CaptureViewport;
  backgroundColor?: string | null;
  mimeType: string;
  imageQuality?: number;
  afterDraw?: (
    context: CanvasRenderingContext2D,
    worldTransform: DOMMatrix,
  ) => void;
}

export class RecapCaptureSurface {
  private canvas: HTMLCanvasElement;
  private context: CanvasRenderingContext2D;
  private captureInFlight = false;

  constructor() {
    this.canvas = document.createElement("canvas");
    this.canvas.style.position = "fixed";
    this.canvas.style.pointerEvents = "none";
    this.canvas.style.opacity = "0";
    this.canvas.style.width = "0px";
    this.canvas.style.height = "0px";
    if (typeof document !== "undefined" && document.body) {
      document.body.appendChild(this.canvas);
    }
    const ctx = this.canvas.getContext("2d");
    if (!ctx) {
      throw new Error("RecapCaptureSurface failed to get 2D context");
    }
    this.context = ctx;
  }

  async capture(options: CaptureOptions): Promise<CaptureResult> {
    if (this.captureInFlight) {
      throw new Error("capture already in progress");
    }
    this.captureInFlight = true;
    try {
      this.ensureSize(options.viewport.width, options.viewport.height);
      this.context.setTransform(1, 0, 0, 1, 0, 0);
      this.context.imageSmoothingEnabled = false;
      this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
      if (options.backgroundColor) {
        this.context.fillStyle = options.backgroundColor;
        this.context.fillRect(0, 0, this.canvas.width, this.canvas.height);
      }

      const restoreTransformIfNeeded = (
        needsTransform: boolean,
        active: boolean,
      ) => {
        if (needsTransform && !active) {
          this.context.save();
          options.transformHandler.handleTransform(this.context);
          return true;
        }
        if (!needsTransform && active) {
          this.context.restore();
          return false;
        }
        return active;
      };

      let transformActive = false;
      for (const layer of options.layers) {
        if (typeof layer.renderLayer !== "function") {
          continue;
        }
        const needsTransform = layer.shouldTransform?.() ?? false;
        transformActive = restoreTransformIfNeeded(
          needsTransform,
          transformActive,
        );
        try {
          layer.renderLayer(this.context);
        } catch (error) {
          console.error(
            "RecapCaptureSurface failed to render layer",
            layer,
            error,
          );
        }
      }
      const worldTransform = this.context.getTransform();
      if (transformActive) {
        this.context.restore();
      }

      options.afterDraw?.(this.context, worldTransform);

      const blob = await this.toBlob(options.mimeType, options.imageQuality);
      let imageBitmap: ImageBitmap | undefined;
      if (typeof createImageBitmap === "function") {
        try {
          imageBitmap = await createImageBitmap(blob);
        } catch (error) {
          console.warn(
            "RecapCaptureSurface could not create ImageBitmap",
            error,
          );
        }
      }

      return {
        blob,
        imageBitmap,
        width: this.canvas.width,
        height: this.canvas.height,
      };
    } finally {
      this.captureInFlight = false;
    }
  }

  dispose() {
    this.canvas.remove();
  }

  private ensureSize(width: number, height: number) {
    const safeWidth = Math.max(1, Math.round(width));
    const safeHeight = Math.max(1, Math.round(height));
    if (this.canvas.width !== safeWidth || this.canvas.height !== safeHeight) {
      this.canvas.width = safeWidth;
      this.canvas.height = safeHeight;
    }
  }

  private toBlob(mimeType: string, quality?: number): Promise<Blob> {
    return new Promise((resolve, reject) => {
      this.canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error("Failed to encode recap frame"));
            return;
          }
          resolve(blob);
        },
        mimeType,
        quality,
      );
    });
  }
}
