import { Theme } from "../../../core/configuration/Config";
import { TileRef } from "../../../core/game/GameMap";
import { GameView } from "../../../core/game/GameView";
import { createCanvas } from "../../Utils";
import { ComputePass } from "./compute/ComputePass";
import { DefendedClearPass } from "./compute/DefendedClearPass";
import { DefendedUpdatePass } from "./compute/DefendedUpdatePass";
import { StateUpdatePass } from "./compute/StateUpdatePass";
import { GroundTruthData } from "./core/GroundTruthData";
import { WebGPUDevice } from "./core/WebGPUDevice";
import { RenderPass } from "./render/RenderPass";
import { TerritoryRenderPass } from "./render/TerritoryRenderPass";

export interface TerritoryWebGLCreateResult {
  renderer: TerritoryRenderer | null;
  reason?: string;
}

/**
 * Main orchestrator for WebGPU territory rendering.
 * Manages compute passes (tick-based) and render passes (frame-based).
 */
export class TerritoryRenderer {
  public readonly canvas: HTMLCanvasElement;

  private device: WebGPUDevice | null = null;
  private resources: GroundTruthData | null = null;
  private ready = false;
  private initPromise: Promise<void> | null = null;

  // Compute passes
  private computePasses: ComputePass[] = [];
  private computePassOrder: ComputePass[] = [];

  // Render passes
  private renderPasses: RenderPass[] = [];
  private renderPassOrder: RenderPass[] = [];

  // Pass instances
  private stateUpdatePass: StateUpdatePass | null = null;
  private defendedClearPass: DefendedClearPass | null = null;
  private defendedUpdatePass: DefendedUpdatePass | null = null;
  private territoryRenderPass: TerritoryRenderPass | null = null;

  // State tracking
  private needsDefendedRebuild = true;
  private needsDefendedHardClear = true;

  private constructor(
    private readonly game: GameView,
    private readonly theme: Theme,
  ) {
    this.canvas = createCanvas();
    this.canvas.style.pointerEvents = "none";
    this.canvas.width = 1;
    this.canvas.height = 1;
  }

  static create(game: GameView, theme: Theme): TerritoryWebGLCreateResult {
    const state = game.tileStateView();
    const expected = game.width() * game.height();
    if (state.length !== expected) {
      return {
        renderer: null,
        reason: "Tile state buffer size mismatch; GPU renderer disabled.",
      };
    }

    const nav = globalThis.navigator as any;
    if (!nav?.gpu || typeof nav.gpu.requestAdapter !== "function") {
      return {
        renderer: null,
        reason: "WebGPU not available; GPU renderer disabled.",
      };
    }

    const renderer = new TerritoryRenderer(game, theme);
    renderer.startInit();
    return { renderer };
  }

  private startInit(): void {
    if (this.initPromise) return;
    this.initPromise = this.init();
  }

  private async init(): Promise<void> {
    const webgpuDevice = await WebGPUDevice.create(this.canvas);
    if (!webgpuDevice) {
      return;
    }
    this.device = webgpuDevice;

    const state = this.game.tileStateView();
    this.resources = GroundTruthData.create(
      webgpuDevice.device,
      this.game,
      this.theme,
      state,
    );

    // Upload initial terrain texture
    this.resources.uploadTerrain();

    // Create compute passes
    this.stateUpdatePass = new StateUpdatePass();
    this.defendedClearPass = new DefendedClearPass();
    this.defendedUpdatePass = new DefendedUpdatePass();

    this.computePasses = [
      this.stateUpdatePass,
      this.defendedClearPass,
      this.defendedUpdatePass,
    ];

    // Create render passes
    this.territoryRenderPass = new TerritoryRenderPass();
    this.renderPasses = [this.territoryRenderPass];

    // Initialize all passes
    for (const pass of this.computePasses) {
      await pass.init(webgpuDevice.device, this.resources);
    }

    for (const pass of this.renderPasses) {
      await pass.init(
        webgpuDevice.device,
        this.resources,
        webgpuDevice.canvasFormat,
      );
    }

    // Compute dependency order (topological sort)
    this.computePassOrder = this.topologicalSort(this.computePasses);
    this.renderPassOrder = this.topologicalSort(this.renderPasses);

    this.ready = true;
  }

  /**
   * Topological sort of passes based on dependencies.
   * Ensures passes run in the correct order.
   */
  private topologicalSort<T extends { name: string; dependencies: string[] }>(
    passes: T[],
  ): T[] {
    const passMap = new Map<string, T>();
    for (const pass of passes) {
      passMap.set(pass.name, pass);
    }

    const visited = new Set<string>();
    const visiting = new Set<string>();
    const result: T[] = [];

    const visit = (pass: T): void => {
      if (visiting.has(pass.name)) {
        console.warn(
          `Circular dependency detected involving pass: ${pass.name}`,
        );
        return;
      }
      if (visited.has(pass.name)) {
        return;
      }

      visiting.add(pass.name);
      for (const depName of pass.dependencies) {
        const dep = passMap.get(depName);
        if (dep) {
          visit(dep);
        }
      }
      visiting.delete(pass.name);
      visited.add(pass.name);
      result.push(pass);
    };

    for (const pass of passes) {
      if (!visited.has(pass.name)) {
        visit(pass);
      }
    }

    return result;
  }

  setViewSize(width: number, height: number): void {
    if (!this.resources || !this.device) {
      return;
    }

    const nextWidth = Math.max(1, Math.floor(width));
    const nextHeight = Math.max(1, Math.floor(height));

    if (nextWidth === this.canvas.width && nextHeight === this.canvas.height) {
      return;
    }

    this.canvas.width = nextWidth;
    this.canvas.height = nextHeight;
    this.resources.setViewSize(nextWidth, nextHeight);
    this.device.reconfigure();
  }

  setViewTransform(scale: number, offsetX: number, offsetY: number): void {
    if (!this.resources) {
      return;
    }
    this.resources.setViewTransform(scale, offsetX, offsetY);
  }

  setAlternativeView(enabled: boolean): void {
    if (!this.resources) {
      return;
    }
    this.resources.setAlternativeView(enabled);
  }

  setHighlightedOwnerId(ownerSmallId: number | null): void {
    if (!this.resources) {
      return;
    }
    this.resources.setHighlightedOwnerId(ownerSmallId);
  }

  markTile(tile: TileRef): void {
    if (this.stateUpdatePass) {
      this.stateUpdatePass.markTile(tile);
    }
  }

  markAllDirty(): void {
    this.needsDefendedRebuild = true;
    if (this.defendedUpdatePass) {
      this.defendedUpdatePass.markDirty();
    }
  }

  refreshPalette(): void {
    if (!this.resources) {
      return;
    }
    this.resources.markPaletteDirty();
  }

  markDefensePostsDirty(): void {
    if (!this.resources) {
      return;
    }
    this.resources.markDefensePostsDirty();
    this.needsDefendedRebuild = true;
    if (this.defendedUpdatePass) {
      this.defendedUpdatePass.markDirty();
    }
  }

  /**
   * Perform one simulation tick.
   * Runs compute passes to update ground truth data.
   */
  tick(): void {
    if (!this.ready || !this.device || !this.resources) {
      return;
    }

    // Upload palette if needed
    this.resources.uploadPalette();

    // Upload defense posts if needed (tracks if it was dirty before upload)
    const wasDefensePostsDirty = (this.resources as any)
      .needsDefensePostsUpload;
    this.resources.uploadDefensePosts();

    // Initial state upload
    this.resources.uploadState();

    // Check if we need to run compute passes
    const numUpdates = this.stateUpdatePass
      ? ((this.stateUpdatePass as any).pendingTiles?.size ?? 0)
      : 0;
    const range = this.game.config().defensePostRange();
    const rangeChanged = range !== this.resources.getLastDefenseRange();
    const countChanged =
      this.resources.getDefensePostsCount() !==
      this.resources.getLastDefensePostsCount();
    const hasPosts = this.resources.getDefensePostsCount() > 0;

    // Use explicit boolean checks to satisfy linter (|| is correct for boolean OR)
    const shouldRebuildDefended =
      this.needsDefendedRebuild === true ||
      wasDefensePostsDirty === true ||
      rangeChanged === true ||
      countChanged === true ||
      (hasPosts && numUpdates > 0);

    const needsCompute =
      numUpdates > 0 ||
      shouldRebuildDefended === true ||
      this.needsDefendedHardClear === true;

    // Update defense params even if we early-out
    if (!needsCompute) {
      this.resources.writeDefenseParamsBuffer();
      this.resources.setLastDefenseRange(range);
      this.resources.setLastDefensePostsCount(
        this.resources.getDefensePostsCount(),
      );
      return;
    }

    const encoder = this.device.device.createCommandEncoder();

    // Handle defended rebuild (before executing passes)
    if (shouldRebuildDefended) {
      // Increment epoch for this rebuild
      const epochBefore = this.resources.getDefendedEpoch();
      this.resources.incrementDefendedEpoch();
      const epochAfter = this.resources.getDefendedEpoch();

      // If epoch wrapped, we need a hard clear
      if (epochAfter === 0 || epochAfter < epochBefore) {
        this.needsDefendedHardClear = true;
        this.resources.incrementDefendedEpoch();
      }

      this.needsDefendedRebuild = false;
    }

    // Update hard clear flag for DefendedClearPass
    if (this.defendedClearPass) {
      this.defendedClearPass.setNeedsHardClear(this.needsDefendedHardClear);
    }

    // Execute compute passes in dependency order (clear will run before update if needed)
    for (const pass of this.computePassOrder) {
      if (!pass.needsUpdate()) {
        continue;
      }
      pass.execute(encoder, this.resources);
    }

    // After all passes, update defense params and clear flags
    this.resources.writeDefenseParamsBuffer();
    if (this.needsDefendedHardClear && this.defendedClearPass) {
      this.needsDefendedHardClear = false;
      this.defendedClearPass.setNeedsHardClear(false);
    }

    this.resources.setLastDefenseRange(range);
    this.resources.setLastDefensePostsCount(
      this.resources.getDefensePostsCount(),
    );

    this.device.device.queue.submit([encoder.finish()]);
  }

  /**
   * Render one frame.
   * Runs render passes to draw to the canvas.
   */
  render(): void {
    if (
      !this.ready ||
      !this.device ||
      !this.resources ||
      !this.territoryRenderPass
    ) {
      return;
    }

    const encoder = this.device.device.createCommandEncoder();
    const textureView = this.device.context.getCurrentTexture().createView();

    // Execute render passes in dependency order
    for (const pass of this.renderPassOrder) {
      if (!pass.needsUpdate()) {
        continue;
      }
      pass.execute(encoder, this.resources, textureView);
    }

    this.device.device.queue.submit([encoder.finish()]);
  }
}
