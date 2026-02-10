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
  ViewSize,
  ViewTransform,
} from "../../../core/worker/WorkerMessages";

export interface TerritoryWebGLCreateResult {
  renderer: TerritoryRendererProxy | null;
  reason?: string;
}

/**
 * Proxy for TerritoryRenderer that forwards calls to worker thread.
 * Manages canvas transfer and message routing.
 */
export class TerritoryRendererProxy {
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
  private renderInFlight = false;
  private renderSeq = 0;
  private renderCooldownUntilMs = 0;

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
  ): TerritoryWebGLCreateResult {
    const nav = globalThis.navigator as any;
    if (!nav?.gpu || typeof nav.gpu.requestAdapter !== "function") {
      return {
        renderer: null,
        reason: "WebGPU not available; GPU renderer disabled.",
      };
    }

    if (typeof OffscreenCanvas === "undefined") {
      return {
        renderer: null,
        reason: "OffscreenCanvas not supported; GPU renderer disabled.",
      };
    }

    const state = game.tileStateView();
    const expected = game.width() * game.height();
    if (state.length !== expected) {
      return {
        renderer: null,
        reason: "Tile state buffer size mismatch; GPU renderer disabled.",
      };
    }

    const renderer = new TerritoryRendererProxy(game, theme);
    renderer.worker = worker;
    renderer.startInit();
    return { renderer };
  }

  private startInit(): void {
    if (this.initPromise) return;
    this.initPromise = this.init().catch((err) => {
      this.failed = true;
      this.renderInFlight = false;
      this.pendingMessages = [];
      console.error("Worker territory renderer init failed:", err);
      throw err;
    });
  }

  private async init(): Promise<void> {
    if (!this.worker) {
      throw new Error("Worker not set");
    }

    // Transfer canvas control to offscreen
    this.offscreenCanvas = this.canvas.transferControlToOffscreen();

    // Send init message to worker
    // Determine dark mode from theme (check if it has darkShore property, same as GroundTruthData)
    const themeAny = this.theme as any;
    const darkMode = themeAny.darkShore !== undefined;

    const messageId = `init_renderer_${Date.now()}`;
    const initMessage: InitRendererMessage = {
      type: "init_renderer",
      id: messageId,
      offscreenCanvas: this.offscreenCanvas,
      darkMode: darkMode,
      backend: "webgpu",
    };

    // Transfer the offscreen canvas
    this.worker.postMessage(initMessage, [this.offscreenCanvas]);

    // Wait for renderer ready
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
          // Send any pending messages
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
    if (!this.worker) {
      return;
    }
    if (this.failed) {
      return;
    }
    if (!this.ready) {
      this.pendingMessages.push({ message });
      return;
    }
    this.worker.postMessage(message);
  }

  private sendToWorkerWithTransfer(message: any, transferables: any[]): void {
    if (!this.worker) {
      return;
    }
    if (this.failed) {
      return;
    }
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

  setTerritoryShader(shaderPath: string): void {
    const message: SetShaderSettingsMessage = {
      type: "set_shader_settings",
      territoryShader: shaderPath,
    };
    this.sendToWorker(message);
  }

  setTerrainShader(shaderPath: string): void {
    const message: SetShaderSettingsMessage = {
      type: "set_shader_settings",
      terrainShader: shaderPath,
    };
    this.sendToWorker(message);
  }

  setTerritoryShaderParams(
    params0: Float32Array | number[],
    params1: Float32Array | number[],
  ): void {
    const message: SetShaderSettingsMessage = {
      type: "set_shader_settings",
      territoryShaderParams0: Array.from(params0),
      territoryShaderParams1: Array.from(params1),
    };
    this.sendToWorker(message);
  }

  setTerrainShaderParams(
    params0: Float32Array | number[],
    params1: Float32Array | number[],
  ): void {
    const message: SetShaderSettingsMessage = {
      type: "set_shader_settings",
      terrainShaderParams0: Array.from(params0),
      terrainShaderParams1: Array.from(params1),
    };
    this.sendToWorker(message);
  }

  setPreSmoothing(
    enabled: boolean,
    shaderPath: string,
    params0: Float32Array | number[],
  ): void {
    const message: SetShaderSettingsMessage = {
      type: "set_shader_settings",
      preSmoothing: {
        enabled,
        shaderPath,
        params0: Array.from(params0),
      },
    };
    this.sendToWorker(message);
  }

  setPostSmoothing(
    enabled: boolean,
    shaderPath: string,
    params0: Float32Array | number[],
  ): void {
    const message: SetShaderSettingsMessage = {
      type: "set_shader_settings",
      postSmoothing: {
        enabled,
        shaderPath,
        params0: Array.from(params0),
      },
    };
    this.sendToWorker(message);
  }

  markTile(tile: TileRef): void {
    const message: MarkTileMessage = {
      type: "mark_tile",
      tile,
    };
    this.sendToWorker(message);
  }

  markAllDirty(): void {
    const message: MarkAllDirtyMessage = {
      type: "mark_all_dirty",
    };
    this.sendToWorker(message);
  }

  refreshPalette(): void {
    if (!this.worker) {
      return;
    }

    // Build palette on the main thread to avoid order-dependent color allocator
    // divergence between main and worker.
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

    // Transfer buffers to avoid copies; arrays are rebuilt when needed.
    this.sendToWorkerWithTransfer(message, [row0.buffer, row1.buffer]);

    // Back-compat: also mark palette dirty in worker for older code paths.
    const fallback: RefreshPaletteMessage = { type: "refresh_palette" };
    this.sendToWorker(fallback);
  }

  markDefensePostsDirty(): void {
    this.markAllDirty();
  }

  refreshTerrain(): void {
    const message: RefreshTerrainMessage = {
      type: "refresh_terrain",
    };
    this.sendToWorker(message);
  }

  tick(): void {
    // No-op: worker renderer ticks from worker-side game_update.
    // Sending tick messages from the main thread duplicates GPU work and
    // can stall Firefox badly under load.
  }

  render(): void {
    if (this.failed) {
      return;
    }
    if (performance.now() < this.renderCooldownUntilMs) {
      return;
    }
    if (this.renderInFlight) {
      return;
    }

    this.renderInFlight = true;
    const renderId = `render_${++this.renderSeq}`;
    const sentAtWallMs = Date.now();

    const message: RenderFrameMessage = { type: "render_frame" };
    message.id = renderId;
    message.sentAtWallMs = sentAtWallMs;

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

    const worker = this.worker;
    if (worker) {
      const timeout = setTimeout(() => {
        if (!this.renderInFlight) {
          worker.removeMessageHandler(renderId);
          return;
        }

        console.warn(`render_done timeout (${renderId})`);
        worker.removeMessageHandler(renderId);

        // Recover from lost/blocked frames without flooding the worker.
        this.renderInFlight = false;
        this.renderCooldownUntilMs = performance.now() + 250;

        // Force a view resync on the next successful render.
        this.lastSentViewSize = null;
        this.lastSentViewTransform = null;
      }, 15000);

      worker.addMessageHandler(renderId, (m: any) => {
        if (m?.type !== "render_done") {
          return;
        }
        clearTimeout(timeout);
        const startedAt = typeof m.startedAt === "number" ? m.startedAt : NaN;
        const endedAt = typeof m.endedAt === "number" ? m.endedAt : NaN;
        const startedAtWallMs =
          typeof m.startedAtWallMs === "number" ? m.startedAtWallMs : NaN;
        const endedAtWallMs =
          typeof m.endedAtWallMs === "number" ? m.endedAtWallMs : NaN;
        const echoedSentAtWallMs =
          typeof m.sentAtWallMs === "number" ? m.sentAtWallMs : sentAtWallMs;
        if (
          Number.isFinite(startedAt) &&
          Number.isFinite(endedAt) &&
          Number.isFinite(startedAtWallMs) &&
          Number.isFinite(endedAtWallMs) &&
          Number.isFinite(echoedSentAtWallMs)
        ) {
          const queueMs = startedAtWallMs - echoedSentAtWallMs;
          const renderMs = endedAt - startedAt;
          const totalMs = endedAtWallMs - echoedSentAtWallMs;
          const breakdown =
            typeof m.renderCpuMs === "number" ||
            typeof m.renderGpuWaitMs === "number" ||
            typeof m.renderWaitPrevGpuMs === "number" ||
            typeof m.renderGetTextureMs === "number"
              ? {
                  waitPrevGpuMs:
                    typeof m.renderWaitPrevGpuMs === "number"
                      ? Math.round(m.renderWaitPrevGpuMs)
                      : undefined,
                  waitPrevGpuTimedOut:
                    typeof m.renderWaitPrevGpuTimedOut === "boolean"
                      ? m.renderWaitPrevGpuTimedOut
                      : undefined,
                  cpuMs:
                    typeof m.renderCpuMs === "number"
                      ? Math.round(m.renderCpuMs)
                      : undefined,
                  getTextureMs:
                    typeof m.renderGetTextureMs === "number"
                      ? Math.round(m.renderGetTextureMs)
                      : undefined,
                  gpuWaitMs:
                    typeof m.renderGpuWaitMs === "number"
                      ? Math.round(m.renderGpuWaitMs)
                      : undefined,
                  gpuWaitTimedOut:
                    typeof m.renderGpuWaitTimedOut === "boolean"
                      ? m.renderGpuWaitTimedOut
                      : undefined,
                }
              : undefined;
          if (totalMs > 1000 || queueMs > 1000 || renderMs > 1000) {
            console.warn("worker render timing", {
              id: renderId,
              queueMs: Math.round(queueMs),
              renderMs: Math.round(renderMs),
              totalMs: Math.round(totalMs),
              breakdown,
            });
          }
        }
        this.renderInFlight = false;
      });
    } else {
      this.renderInFlight = false;
      return;
    }

    this.sendToWorker(message);
  }
}
