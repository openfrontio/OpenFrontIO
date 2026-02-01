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
  SetShaderSettingsMessage,
  SetViewSizeMessage,
  SetViewTransformMessage,
  TickRendererMessage,
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
  private pendingMessages: any[] = [];

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
          for (const msg of this.pendingMessages) {
            this.sendToWorker(msg);
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
      this.pendingMessages.push(message);
      return;
    }
    this.worker.postMessage(message);
  }

  setViewSize(width: number, height: number): void {
    const message: SetViewSizeMessage = {
      type: "set_view_size",
      width,
      height,
    };
    this.sendToWorker(message);
  }

  setViewTransform(scale: number, offsetX: number, offsetY: number): void {
    const message: SetViewTransformMessage = {
      type: "set_view_transform",
      scale,
      offsetX,
      offsetY,
    };
    this.sendToWorker(message);
  }

  setAlternativeView(enabled: boolean): void {
    const message: SetAlternativeViewMessage = {
      type: "set_alternative_view",
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
    const message: RefreshPaletteMessage = {
      type: "refresh_palette",
    };
    this.sendToWorker(message);
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
    const message: TickRendererMessage = {
      type: "tick_renderer",
    };
    this.sendToWorker(message);
  }

  render(): void {
    const message: RenderFrameMessage = {
      type: "render_frame",
    };
    this.sendToWorker(message);
  }
}
