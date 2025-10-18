import { GameView } from "../../../core/game/GameView";
import { TransformHandler } from "../TransformHandler";
import { Layer } from "../layers/Layer";
import {
  defaultRecapCaptureConfig,
  RecapCaptureConfig,
} from "./RecapCaptureConfig";
import { RecapCaptureSurface } from "./RecapCaptureSurface";
import { RecapFrame, RecapFrameStore } from "./RecapFrameStore";

interface TransformSnapshot {
  scale: number;
  offsetX: number;
  offsetY: number;
}

export interface RecapCaptureStats {
  frameCount: number;
  approximateDurationMs: number;
  lastTickCaptured: number | null;
}

export class GameRecapCapture {
  private readonly config: RecapCaptureConfig;
  private readonly surface: RecapCaptureSurface;
  private readonly frameStore: RecapFrameStore;
  private lastCaptureTick: number | null = null;
  private captureInProgress = false;
  private viewport: { width: number; height: number } | null = null;
  private stopped = false;
  private resolvedMimeType: string | null = null;
  private pendingFinalCapture = false;
  private disableOverridesAfterCapture = false;
  private memoryUsageLogged = false;

  constructor(
    private readonly game: GameView,
    private readonly transformHandler: TransformHandler,
    private readonly layers: Layer[],
    config?: Partial<RecapCaptureConfig>,
  ) {
    this.config = { ...defaultRecapCaptureConfig, ...config };
    this.surface = new RecapCaptureSurface();
    this.frameStore = new RecapFrameStore(this.config.maxFrames);
  }

  start() {
    this.stopped = false;
    this.resolvedMimeType = null;
    this.frameStore.setLoopPauseMs(0);
    this.pendingFinalCapture = false;
    this.disableOverridesAfterCapture = false;
    this.memoryUsageLogged = false;
    this.setLayerCaptureOverrides(true);
    this.refreshViewportSize();
  }

  dispose() {
    this.stopped = true;
    this.pendingFinalCapture = false;
    this.surface.dispose();
    this.frameStore.clear();
    this.setLayerCaptureOverrides(false);
    this.disableOverridesAfterCapture = false;
    this.memoryUsageLogged = false;
  }

  onViewportResize() {
    this.refreshViewportSize();
  }

  getFrameStore(): RecapFrameStore {
    return this.frameStore;
  }

  getStats(): RecapCaptureStats {
    return {
      frameCount: this.frameStore.getFrameCount(),
      approximateDurationMs: this.frameStore.approximateDurationMs(),
      lastTickCaptured: this.lastCaptureTick,
    };
  }

  tick() {
    if (this.stopped) {
      return;
    }
    if (!this.viewport) {
      this.refreshViewportSize();
    }

    const tick = this.game.ticks();
    if (this.lastCaptureTick !== null && tick <= this.lastCaptureTick) {
      return;
    }

    if (tick % this.config.captureEveryNTicks !== 0) {
      return;
    }

    if (this.captureInProgress) {
      return;
    }
    this.queueCapture(tick);
  }

  isCapturing(): boolean {
    return this.captureInProgress;
  }

  stopCapturing(): void {
    if (this.stopped) {
      return;
    }
    this.stopped = true;
    this.frameStore.setLoopPauseMs(this.config.loopTailHoldMs);
    this.disableOverridesAfterCapture = true;
    if (this.captureInProgress) {
      this.pendingFinalCapture = true;
    } else {
      this.queueCapture(this.game.ticks());
    }
  }

  async exportAsWebM(targetFps: number = this.config.exportFps): Promise<{
    blob: Blob;
    filename: string;
  }> {
    const frames = this.frameStore.getFrames();
    if (frames.length === 0) {
      throw new Error("No recap frames available for export");
    }

    const mimeType = this.resolveExportMimeType();
    if (!mimeType) {
      throw new Error("No supported MediaRecorder mime type for WebM export");
    }

    const canvas = document.createElement("canvas");
    canvas.width = frames[0].width;
    canvas.height = frames[0].height;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Unable to acquire 2D context for export");
    }

    if (
      typeof canvas.captureStream !== "function" ||
      typeof MediaRecorder === "undefined"
    ) {
      throw new Error(
        "MediaRecorder canvas captureStream is not supported in this environment",
      );
    }

    const stream = canvas.captureStream(targetFps);
    const recorderOptions: MediaRecorderOptions = { mimeType };
    if (this.config.exportVideoBitsPerSecond) {
      recorderOptions.videoBitsPerSecond = this.config.exportVideoBitsPerSecond;
    }
    const recorder = new MediaRecorder(stream, recorderOptions);
    const chunks: BlobPart[] = [];
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data && event.data.size > 0) {
        chunks.push(event.data);
      }
    });

    const stopPromise = new Promise<Blob>((resolve, reject) => {
      const handleError = (event: Event) => {
        recorder.removeEventListener("error", handleError);
        recorder.removeEventListener("stop", handleStop);
        const error = (event as { error?: DOMException }).error;
        reject(error ?? new Error("MediaRecorder error"));
      };
      const handleStop = () => {
        recorder.removeEventListener("error", handleError);
        recorder.removeEventListener("stop", handleStop);
        resolve(new Blob(chunks, { type: mimeType }));
      };
      recorder.addEventListener("error", handleError);
      recorder.addEventListener("stop", handleStop);
    });

    const startPromise = new Promise<void>((resolve) => {
      const handleStart = () => {
        recorder.removeEventListener("start", handleStart);
        resolve();
      };
      recorder.addEventListener("start", handleStart);
    });

    const drawFrame = async (frame: RecapFrame) => {
      if (!frame.imageBitmap && typeof createImageBitmap === "function") {
        try {
          frame.imageBitmap = await createImageBitmap(frame.blob);
        } catch (error) {
          console.warn("Failed to create ImageBitmap for export frame", error);
        }
      }

      context.clearRect(0, 0, canvas.width, canvas.height);
      if (frame.imageBitmap) {
        context.drawImage(frame.imageBitmap, 0, 0, canvas.width, canvas.height);
      } else {
        const image = await this.blobToImage(frame.blob);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
      }
    };

    const framesToEncode =
      frames.length === 1 ? [...frames, frames[0]] : [...frames];
    const frameInterval = Math.max(1000 / targetFps, 16);

    await drawFrame(framesToEncode[0]);

    recorder.start();
    await startPromise;

    const canvasTrack = stream.getVideoTracks()[0] as
      | (MediaStreamTrack & { requestFrame?: () => void })
      | undefined;

    canvasTrack?.requestFrame?.();
    await this.wait(frameInterval);

    for (let index = 1; index < framesToEncode.length; index += 1) {
      const frame = framesToEncode[index];
      await drawFrame(frame);
      canvasTrack?.requestFrame?.();
      await this.wait(frameInterval);
    }

    if (typeof recorder.requestData === "function") {
      try {
        recorder.requestData();
      } catch (error) {
        console.warn("MediaRecorder requestData failed", error);
      }
    }

    await this.wait(frameInterval);
    recorder.stop();
    stream.getTracks().forEach((track) => track.stop());

    const blob = await stopPromise;
    if (blob.size < 2048) {
      throw new Error("Recap export produced an unexpectedly small recording");
    }
    const filename = `openfront-recap-${Date.now()}.webm`;
    return { blob, filename };
  }

  private async performCapture(tick: number) {
    this.refreshViewportSize();
    if (!this.viewport) {
      return;
    }

    const handlerInternals = this
      .transformHandler as unknown as TransformSnapshot & {
      _boundingRect?: DOMRect;
      centerAll(fit?: number): void;
      override(x?: number, y?: number, scale?: number): void;
    };

    const originalTransform = this.snapshotTransform();
    const originalBoundingRect = handlerInternals._boundingRect;

    const captureRect =
      typeof DOMRect === "function"
        ? new DOMRect(0, 0, this.viewport.width, this.viewport.height)
        : ({
            x: 0,
            y: 0,
            width: this.viewport.width,
            height: this.viewport.height,
            top: 0,
            right: this.viewport.width,
            bottom: this.viewport.height,
            left: 0,
          } as DOMRect);
    handlerInternals._boundingRect = captureRect;
    this.transformHandler.centerAll(1);

    try {
      const result = await this.surface.capture({
        layers: this.layers,
        game: this.game,
        transformHandler: this.transformHandler,
        viewport: this.viewport,
        backgroundColor: null,
        mimeType: this.config.imageMimeType,
        imageQuality: this.config.imageQuality,
      });

      if (!result.imageBitmap && typeof createImageBitmap === "function") {
        try {
          result.imageBitmap = await createImageBitmap(result.blob);
        } catch (error) {
          console.warn(
            "Failed to create ImageBitmap for captured frame",
            error,
          );
        }
      }

      this.frameStore.addFrame({
        tick,
        capturedAt: Date.now(),
        blob: result.blob,
        width: result.width,
        height: result.height,
        imageBitmap: result.imageBitmap,
      });
      if (!this.memoryUsageLogged) {
        const bytes = this.frameStore.getApproximateBlobBytes();
        const mebibytes = bytes / (1024 * 1024);
        console.info("[RecapCapture] First frame stored", {
          frames: this.frameStore.getFrameCount(),
          resolution: `${result.width}x${result.height}`,
          approxBlobMiB: Number(mebibytes.toFixed(2)),
        });
        this.memoryUsageLogged = true;
      }
      this.lastCaptureTick = tick;
    } catch (error) {
      console.error("GameRecapCapture failed to capture frame", error);
    } finally {
      if (originalBoundingRect) {
        handlerInternals._boundingRect = originalBoundingRect;
      } else {
        delete handlerInternals._boundingRect;
      }
      handlerInternals.override(
        originalTransform.offsetX,
        originalTransform.offsetY,
        originalTransform.scale,
      );
    }
  }

  private queueCapture(tick: number) {
    this.captureInProgress = true;
    const runCapture = () => {
      void this.performCapture(tick).finally(() => {
        this.captureInProgress = false;
        if (this.pendingFinalCapture) {
          this.pendingFinalCapture = false;
          this.queueCapture(this.game.ticks());
        } else if (this.disableOverridesAfterCapture) {
          this.disableOverridesAfterCapture = false;
          this.setLayerCaptureOverrides(false);
        }
      });
    };

    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => runCapture());
    } else {
      setTimeout(runCapture, 0);
    }
  }

  private setLayerCaptureOverrides(enabled: boolean) {
    for (const layer of this.layers) {
      const candidate = layer as {
        setCaptureRenderEnabled?: (
          capture: boolean,
          mode?: "normal" | "shape",
        ) => void;
      };
      candidate.setCaptureRenderEnabled?.(
        enabled,
        enabled ? "shape" : "normal",
      );
    }
  }

  private snapshotTransform(): TransformSnapshot {
    const handler = this.transformHandler as unknown as TransformSnapshot;
    return {
      scale: handler.scale,
      offsetX: handler.offsetX,
      offsetY: handler.offsetY,
    };
  }

  private async blobToImage(blob: Blob): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const image = new Image();
      image.onload = () => {
        URL.revokeObjectURL(url);
        resolve(image);
      };
      image.onerror = (error) => {
        URL.revokeObjectURL(url);
        reject(error);
      };
      image.src = url;
    });
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  private resolveExportMimeType(): string | null {
    if (this.resolvedMimeType !== null) {
      return this.resolvedMimeType;
    }
    if (typeof MediaRecorder === "undefined") {
      return null;
    }
    const mimeType = this.config.exportMimeTypes.find((type) =>
      MediaRecorder.isTypeSupported(type),
    );
    if (!mimeType) {
      return null;
    }
    this.resolvedMimeType = mimeType;
    return mimeType;
  }

  private refreshViewportSize() {
    const rect = this.transformHandler.boundingRect();
    const mapWidth = this.game.width();
    const mapHeight = this.game.height();
    if (!rect || mapWidth === 0 || mapHeight === 0) {
      return;
    }

    const targetWidth = this.config.targetWidth ?? rect.width;
    const targetHeight = this.config.targetHeight ?? rect.height;

    const scale = Math.min(targetWidth / mapWidth, targetHeight / mapHeight);
    if (!Number.isFinite(scale) || scale <= 0) {
      return;
    }

    const width = Math.max(1, Math.round(mapWidth * scale));
    const height = Math.max(1, Math.round(mapHeight * scale));
    if (
      !this.viewport ||
      this.viewport.width !== width ||
      this.viewport.height !== height
    ) {
      this.viewport = { width, height };
    }
  }
}
