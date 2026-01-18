import { Theme } from "../../../core/configuration/Config";
import { TileRef } from "../../../core/game/GameMap";
import { GameView } from "../../../core/game/GameView";
import { createCanvas } from "../../Utils";
import { ComputePass } from "./compute/ComputePass";
import { DefendedStrengthFullPass } from "./compute/DefendedStrengthFullPass";
import { DefendedStrengthPass } from "./compute/DefendedStrengthPass";
import { StateUpdatePass } from "./compute/StateUpdatePass";
import { TerrainComputePass } from "./compute/TerrainComputePass";
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
  private terrainComputePass: TerrainComputePass | null = null;
  private stateUpdatePass: StateUpdatePass | null = null;
  private defendedStrengthFullPass: DefendedStrengthFullPass | null = null;
  private defendedStrengthPass: DefendedStrengthPass | null = null;
  private territoryRenderPass: TerritoryRenderPass | null = null;
  private readonly defensePostRange: number;

  private constructor(
    private readonly game: GameView,
    private readonly theme: Theme,
  ) {
    this.canvas = createCanvas();
    this.canvas.style.pointerEvents = "none";
    this.canvas.width = 1;
    this.canvas.height = 1;
    this.defensePostRange = game.config().defensePostRange();
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

    // Upload terrain data and params (terrain colors will be computed on GPU)
    this.resources.uploadTerrainData();
    this.resources.uploadTerrainParams();

    // Create compute passes (terrain compute should run first)
    this.terrainComputePass = new TerrainComputePass();
    this.stateUpdatePass = new StateUpdatePass();
    this.defendedStrengthFullPass = new DefendedStrengthFullPass();
    this.defendedStrengthPass = new DefendedStrengthPass();

    this.computePasses = [
      this.terrainComputePass,
      this.stateUpdatePass,
      this.defendedStrengthFullPass,
      this.defendedStrengthPass,
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

  setBorderMode(mode: number): void {
    if (!this.resources) {
      return;
    }
    this.resources.setBorderMode(mode);
  }

  markTile(tile: TileRef): void {
    if (this.stateUpdatePass) {
      this.stateUpdatePass.markTile(tile);
    }
  }

  markAllDirty(): void {
    this.resources?.markDefensePostsDirty();
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
  }

  refreshTerrain(): void {
    if (!this.resources || !this.device) {
      return;
    }
    this.resources.markTerrainParamsDirty();
    if (this.terrainComputePass) {
      this.terrainComputePass.markDirty();
      // Immediately compute terrain to avoid blank rendering
      this.computeTerrainImmediate();
    }
  }

  /**
   * Immediately execute terrain compute pass (for theme changes).
   * This ensures terrain is recomputed before the next render.
   */
  private computeTerrainImmediate(): void {
    if (
      !this.ready ||
      !this.device ||
      !this.resources ||
      !this.terrainComputePass
    ) {
      return;
    }

    // Upload terrain params if needed
    this.resources.uploadTerrainParams();

    if (!this.terrainComputePass.needsUpdate()) {
      return;
    }

    const encoder = this.device.device.createCommandEncoder();
    this.terrainComputePass.execute(encoder, this.resources);
    this.device.device.queue.submit([encoder.finish()]);

    // Rebuild render pass bind group to ensure it uses the updated terrain texture
    // This will be called again in render(), but doing it here ensures it's ready
    if (this.territoryRenderPass) {
      (this.territoryRenderPass as any).rebuildBindGroup?.();
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

    if (this.game.config().defensePostRange() !== this.defensePostRange) {
      throw new Error("defensePostRange changed at runtime; unsupported.");
    }

    // Upload palette if needed
    this.resources.uploadPalette();

    // Upload defense posts if needed (also produces defended dirty tiles on changes)
    this.resources.uploadDefensePosts();

    // Initial state upload
    this.resources.uploadState();

    const needsCompute =
      (this.terrainComputePass?.needsUpdate() ?? false) ||
      (this.stateUpdatePass?.needsUpdate() ?? false) ||
      (this.defendedStrengthFullPass?.needsUpdate() ?? false) ||
      (this.defendedStrengthPass?.needsUpdate() ?? false);

    if (!needsCompute) {
      return;
    }

    const encoder = this.device.device.createCommandEncoder();

    // Execute compute passes in dependency order (clear will run before update if needed)
    for (const pass of this.computePassOrder) {
      if (!pass.needsUpdate()) {
        continue;
      }
      pass.execute(encoder, this.resources);
    }

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

    // If terrain needs recomputation, trigger it asynchronously (no blocking)
    // It will be ready for the next frame, acceptable trade-off for performance
    if (this.terrainComputePass?.needsUpdate()) {
      this.resources.uploadTerrainParams();
      const computeEncoder = this.device.device.createCommandEncoder();
      this.terrainComputePass.execute(computeEncoder, this.resources);
      this.device.device.queue.submit([computeEncoder.finish()]);
      // Continue with render - may show stale terrain for one frame, but better performance
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
