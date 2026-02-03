import { createCanvas } from "src/client/Utils";
import { Theme } from "../../../core/configuration/Config";
import { TileRef } from "../../../core/game/GameMap";
import { GameView } from "../../../core/game/GameView";
import { WorkerClient } from "../../../core/worker/WorkerClient";
import {
  InitRendererMessage,
  MarkAllDirtyMessage,
  MarkTileMessage,
  RefreshPaletteMessage,
  RefreshTerrainMessage,
  RenderFrameMessage,
  SetAlternativeViewMessage,
  SetHighlightedOwnerMessage,
  SetPaletteMessage,
  SetPatternsEnabledMessage,
  SetShaderSettingsMessage,
  TickRendererMessage,
  ViewSize,
  ViewTransform,
} from "../../../core/worker/WorkerMessages";

export interface Canvas2DCreateResult {
  renderer: Canvas2DRendererProxy | null;
  reason?: string;
}

export class Canvas2DRendererProxy {
  public readonly canvas: HTMLCanvasElement;
  private offscreenCanvas: OffscreenCanvas | null = null;
  private worker: WorkerClient | null = null;
  private ready = false;
  private failed = false;
  private initPromise: Promise<void> | null = null;
  private pendingMessages: Array<{ message: any; transferables?: any[] }> = [];

  private viewSize: ViewSize = { width: 1, height: 1 };
  private viewTransform: ViewTransform = { scale: 1, offsetX: 0, offsetY: 0 };
  private lastSentViewSize: ViewSize | null = null;
  private lastSentViewTransform: ViewTransform | null = null;

  private constructor(
    private readonly game: GameView,
    private readonly theme: Theme,
  ) {
    this.canvas = createCanvas();
    this.canvas.style.pointerEvents = "none";
    this.canvas.width = 1;
    this.canvas.height = 1;
  }

  static create(
    game: GameView,
    theme: Theme,
    worker: WorkerClient,
  ): Canvas2DCreateResult {
    if (typeof OffscreenCanvas === "undefined") {
      return {
        renderer: null,
        reason:
          "OffscreenCanvas not supported; Canvas2D worker renderer disabled.",
      };
    }
    if (
      typeof HTMLCanvasElement.prototype.transferControlToOffscreen !==
      "function"
    ) {
      return {
        renderer: null,
        reason:
          "transferControlToOffscreen not supported; Canvas2D worker renderer disabled.",
      };
    }

    const renderer = new Canvas2DRendererProxy(game, theme);
    renderer.worker = worker;
    renderer.startInit();
    return { renderer };
  }

  private startInit(): void {
    if (this.initPromise) return;
    this.initPromise = this.init().catch((err) => {
      this.failed = true;
      this.pendingMessages = [];
      console.error("Worker canvas2d renderer init failed:", err);
      throw err;
    });
  }

  private async init(): Promise<void> {
    if (!this.worker) {
      throw new Error("Worker not set");
    }

    this.offscreenCanvas = this.canvas.transferControlToOffscreen();

    const themeAny = this.theme as any;
    const darkMode = themeAny.darkShore !== undefined;

    const messageId = `init_renderer_canvas2d_${Date.now()}`;
    const initMessage: InitRendererMessage = {
      type: "init_renderer",
      id: messageId,
      offscreenCanvas: this.offscreenCanvas,
      darkMode: darkMode,
      backend: "canvas2d",
    };

    this.worker.postMessage(initMessage, [this.offscreenCanvas]);

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.worker?.removeMessageHandler(messageId);
        reject(new Error("Renderer initialization timeout"));
      }, 10000);

      const handler = (message: any) => {
        if (message.type === "renderer_ready" && message.id === messageId) {
          clearTimeout(timeout);
          this.worker?.removeMessageHandler(messageId);
          if (message.ok === false) {
            reject(
              new Error(message.error ?? "Renderer initialization failed"),
            );
            return;
          }

          this.ready = true;
          for (const pending of this.pendingMessages) {
            if (pending.transferables) {
              this.worker?.postMessage(pending.message, pending.transferables);
            } else {
              this.sendToWorker(pending.message);
            }
          }
          this.pendingMessages = [];
          resolve();
        }
      };

      this.worker?.addMessageHandler(messageId, handler);
    });
  }

  private sendToWorker(message: any): void {
    if (!this.worker) return;
    if (this.failed) return;
    if (!this.ready) {
      this.pendingMessages.push({ message });
      return;
    }
    this.worker.postMessage(message);
  }

  private sendToWorkerWithTransfer(message: any, transferables: any[]): void {
    if (!this.worker) return;
    if (this.failed) return;
    if (!this.ready) {
      this.pendingMessages.push({ message, transferables });
      return;
    }
    this.worker.postMessage(message, transferables);
  }

  setViewSize(width: number, height: number): void {
    this.viewSize = {
      width: Math.max(1, Math.floor(width)),
      height: Math.max(1, Math.floor(height)),
    };
  }

  setViewTransform(scale: number, offsetX: number, offsetY: number): void {
    this.viewTransform = { scale, offsetX, offsetY };
  }

  setAlternativeView(enabled: boolean): void {
    const message: SetAlternativeViewMessage = {
      type: "set_alternative_view",
      enabled,
    };
    this.sendToWorker(message);
  }

  setPatternsEnabled(enabled: boolean): void {
    const message: SetPatternsEnabledMessage = {
      type: "set_patterns_enabled",
      enabled,
    };
    this.sendToWorker(message);
  }

  setHighlightedOwnerId(ownerSmallId: number | null): void {
    const message: SetHighlightedOwnerMessage = {
      type: "set_highlighted_owner",
      ownerSmallId,
    };
    this.sendToWorker(message);
  }

  // Shader controls are ignored by the Canvas2D backend but kept for API parity.
  setTerritoryShader(_shaderPath: string): void {}
  setTerrainShader(_shaderPath: string): void {}
  setTerritoryShaderParams(
    _params0: Float32Array | number[],
    _params1: Float32Array | number[],
  ): void {}
  setTerrainShaderParams(
    _params0: Float32Array | number[],
    _params1: Float32Array | number[],
  ): void {}
  setPreSmoothing(
    _enabled: boolean,
    _shaderPath: string,
    _params0: Float32Array | number[],
  ): void {}
  setPostSmoothing(
    _enabled: boolean,
    _shaderPath: string,
    _params0: Float32Array | number[],
  ): void {}
  setShaderSettings(_settings: SetShaderSettingsMessage): void {}

  markTile(tile: TileRef): void {
    const message: MarkTileMessage = { type: "mark_tile", tile };
    this.sendToWorker(message);
  }

  markAllDirty(): void {
    const message: MarkAllDirtyMessage = { type: "mark_all_dirty" };
    this.sendToWorker(message);
  }

  markDefensePostsDirty(): void {
    this.markAllDirty();
  }

  refreshPalette(): void {
    if (!this.worker) return;

    let maxSmallId = 0;
    for (const player of this.game.playerViews()) {
      maxSmallId = Math.max(maxSmallId, player.smallID());
    }

    const RESERVED = 10;
    const paletteWidth = RESERVED + Math.max(1, maxSmallId + 1);
    const rowStride = paletteWidth * 4;

    const row0 = new Uint8Array(rowStride);
    const row1 = new Uint8Array(rowStride);

    // Fallout slot (index 0)
    row0[0] = 120;
    row0[1] = 255;
    row0[2] = 71;
    row0[3] = 255;

    const toByte = (value: number): number =>
      Math.max(0, Math.min(255, Math.round(value)));

    for (const player of this.game.playerViews()) {
      const id = player.smallID();
      if (id <= 0) continue;
      const idx = (RESERVED + id) * 4;

      const tc = player.territoryColor().toRgb();
      row0[idx] = toByte(tc.r);
      row0[idx + 1] = toByte(tc.g);
      row0[idx + 2] = toByte(tc.b);
      row0[idx + 3] = 255;

      const bc = player.borderColor().toRgb();
      row1[idx] = toByte(bc.r);
      row1[idx + 1] = toByte(bc.g);
      row1[idx + 2] = toByte(bc.b);
      row1[idx + 3] = 255;
    }

    const message: SetPaletteMessage = {
      type: "set_palette",
      paletteWidth,
      maxSmallId,
      row0,
      row1,
    };
    this.sendToWorkerWithTransfer(message, [row0.buffer, row1.buffer]);

    const fallback: RefreshPaletteMessage = { type: "refresh_palette" };
    this.sendToWorker(fallback);
  }

  refreshTerrain(): void {
    const message: RefreshTerrainMessage = { type: "refresh_terrain" };
    this.sendToWorker(message);
  }

  tick(): void {
    const message: TickRendererMessage = { type: "tick_renderer" };
    this.sendToWorker(message);
  }

  render(): void {
    const message: RenderFrameMessage = { type: "render_frame" };

    if (
      !this.lastSentViewSize ||
      this.lastSentViewSize.width !== this.viewSize.width ||
      this.lastSentViewSize.height !== this.viewSize.height
    ) {
      message.viewSize = this.viewSize;
      this.lastSentViewSize = this.viewSize;
    }

    if (
      !this.lastSentViewTransform ||
      this.lastSentViewTransform.scale !== this.viewTransform.scale ||
      this.lastSentViewTransform.offsetX !== this.viewTransform.offsetX ||
      this.lastSentViewTransform.offsetY !== this.viewTransform.offsetY
    ) {
      message.viewTransform = this.viewTransform;
      this.lastSentViewTransform = this.viewTransform;
    }

    this.sendToWorker(message);
  }
}
