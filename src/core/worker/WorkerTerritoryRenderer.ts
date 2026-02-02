import { Theme } from "../configuration/Config";
import { TileRef } from "../game/GameMap";
import { GameUpdateViewData } from "../game/GameUpdates";
import { TerrainMapData } from "../game/TerrainMapLoader";
import { GameRunner } from "../GameRunner";
import { ClientID, PlayerCosmetics } from "../Schemas";
import { GameViewAdapter } from "./GameViewAdapter";

// Import rendering components from client (they should work with adapter)
import { ComputePass } from "../../client/graphics/webgpu/compute/ComputePass";
import { DefendedStrengthFullPass } from "../../client/graphics/webgpu/compute/DefendedStrengthFullPass";
import { DefendedStrengthPass } from "../../client/graphics/webgpu/compute/DefendedStrengthPass";
import { StateUpdatePass } from "../../client/graphics/webgpu/compute/StateUpdatePass";
import { TerrainComputePass } from "../../client/graphics/webgpu/compute/TerrainComputePass";
import { VisualStateSmoothingPass } from "../../client/graphics/webgpu/compute/VisualStateSmoothingPass";
import { GroundTruthData } from "../../client/graphics/webgpu/core/GroundTruthData";
import { WebGPUDevice } from "../../client/graphics/webgpu/core/WebGPUDevice";
import { RenderPass } from "../../client/graphics/webgpu/render/RenderPass";
import { TemporalResolvePass } from "../../client/graphics/webgpu/render/TemporalResolvePass";
import { TerritoryRenderPass } from "../../client/graphics/webgpu/render/TerritoryRenderPass";

/**
 * Worker-compatible WebGPU territory renderer.
 * Works with Game directly (not GameView) and uses OffscreenCanvas.
 */
export class WorkerTerritoryRenderer {
  private device: WebGPUDevice | null = null;
  private canvas: OffscreenCanvas | null = null;
  private resources: GroundTruthData | null = null;
  private gameViewAdapter: GameViewAdapter | null = null;
  private ready = false;

  // Compute passes
  private computePasses: ComputePass[] = [];
  private computePassOrder: ComputePass[] = [];
  private frameComputePasses: ComputePass[] = [];

  // Render passes
  private renderPasses: RenderPass[] = [];
  private renderPassOrder: RenderPass[] = [];

  // Pass instances
  private terrainComputePass: TerrainComputePass | null = null;
  private stateUpdatePass: StateUpdatePass | null = null;
  private defendedStrengthFullPass: DefendedStrengthFullPass | null = null;
  private defendedStrengthPass: DefendedStrengthPass | null = null;
  private visualStateSmoothingPass: VisualStateSmoothingPass | null = null;
  private territoryRenderPass: TerritoryRenderPass | null = null;
  private temporalResolvePass: TemporalResolvePass | null = null;

  private territoryShaderPath = "render/territory.wgsl";
  private territoryShaderParams0 = new Float32Array(4);
  private territoryShaderParams1 = new Float32Array(4);
  private terrainShaderPath = "compute/terrain-compute.wgsl";
  private terrainShaderParams0 = new Float32Array(4);
  private terrainShaderParams1 = new Float32Array(4);
  private preSmoothingShaderPath = "compute/visual-state-smoothing.wgsl";
  private preSmoothingParams0 = new Float32Array(4);
  private postSmoothingShaderPath = "render/temporal-resolve.wgsl";
  private postSmoothingParams0 = new Float32Array(4);

  private preSmoothingEnabled = false;
  private postSmoothingEnabled = false;
  private defensePostRange: number;
  private patternsEnabled = false;

  /**
   * Initialize renderer with offscreen canvas and game data.
   */
  async init(
    offscreenCanvas: OffscreenCanvas,
    gameRunner: GameRunner,
    mapData: TerrainMapData,
    theme: Theme,
    myClientID: ClientID | null,
    cosmeticsByClientID: Map<ClientID, PlayerCosmetics>,
  ): Promise<void> {
    this.canvas = offscreenCanvas;
    const game = gameRunner.game;
    this.defensePostRange = game.config().defensePostRange();

    // Create adapter
    this.gameViewAdapter = new GameViewAdapter(
      game,
      mapData,
      theme,
      myClientID,
      cosmeticsByClientID,
    );
    this.gameViewAdapter.setPatternsEnabled(this.patternsEnabled);

    // Initialize WebGPU device with offscreen canvas
    const webgpuDevice = await WebGPUDevice.create(offscreenCanvas);
    if (!webgpuDevice) {
      throw new Error("Failed to create WebGPU device in worker");
    }
    this.device = webgpuDevice;

    // Create ground truth data using adapter
    const state = this.gameViewAdapter.tileStateView();
    this.resources = GroundTruthData.create(
      webgpuDevice.device,
      this.gameViewAdapter as any,
      theme,
      state,
    );
    this.resources.setTerritoryShaderParams(
      this.territoryShaderParams0,
      this.territoryShaderParams1,
    );
    this.resources.setTerrainShaderParams(
      this.terrainShaderParams0,
      this.terrainShaderParams1,
    );

    // Upload terrain data and params
    this.resources.uploadTerrainData();
    this.resources.uploadTerrainParams();

    // Create compute passes
    this.terrainComputePass = new TerrainComputePass();
    void this.terrainComputePass.setShader(this.terrainShaderPath);
    this.stateUpdatePass = new StateUpdatePass();
    this.defendedStrengthFullPass = new DefendedStrengthFullPass();
    this.defendedStrengthPass = new DefendedStrengthPass();
    this.visualStateSmoothingPass = new VisualStateSmoothingPass();

    this.computePasses = [
      this.terrainComputePass,
      this.stateUpdatePass,
      this.defendedStrengthFullPass,
      this.defendedStrengthPass,
    ];

    this.frameComputePasses = [this.visualStateSmoothingPass];

    // Create render passes
    this.territoryRenderPass = new TerritoryRenderPass();
    this.temporalResolvePass = new TemporalResolvePass();
    this.renderPasses = [this.territoryRenderPass, this.temporalResolvePass];

    // Initialize all passes
    for (const pass of this.computePasses) {
      await pass.init(webgpuDevice.device, this.resources);
    }

    for (const pass of this.frameComputePasses) {
      await pass.init(webgpuDevice.device, this.resources);
    }

    for (const pass of this.renderPasses) {
      await pass.init(
        webgpuDevice.device,
        this.resources,
        webgpuDevice.canvasFormat,
      );
    }

    if (this.territoryRenderPass) {
      await this.territoryRenderPass.setShader(this.territoryShaderPath);
    }

    // Compute dependency order
    this.computePassOrder = this.topologicalSort(this.computePasses);
    this.renderPassOrder = this.topologicalSort(this.renderPasses);

    this.ready = true;
  }

  /**
   * Update game view adapter with latest game update.
   */
  updateGameView(gu: GameUpdateViewData): void {
    if (this.gameViewAdapter) {
      this.gameViewAdapter.update(gu);
    }
  }

  /**
   * Topological sort of passes based on dependencies.
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

    let sizeChanged = true;
    if (this.canvas) {
      sizeChanged =
        nextWidth !== this.canvas.width || nextHeight !== this.canvas.height;
      if (sizeChanged) {
        this.canvas.width = nextWidth;
        this.canvas.height = nextHeight;
      }
    }

    this.resources.setViewSize(nextWidth, nextHeight);
    if (sizeChanged) {
      this.device.reconfigure();
    }

    if (this.postSmoothingEnabled && this.resources) {
      this.resources.ensurePostSmoothingTextures(
        nextWidth,
        nextHeight,
        this.device.canvasFormat,
      );
    }
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

  setPatternsEnabled(enabled: boolean): void {
    this.patternsEnabled = enabled;
    this.gameViewAdapter?.setPatternsEnabled(enabled);
    this.resources?.markPaletteDirty();
    this.resources?.invalidateHistory();
  }

  setTerritoryShader(shaderPath: string): void {
    this.territoryShaderPath = shaderPath;
    if (this.territoryRenderPass) {
      void this.territoryRenderPass.setShader(shaderPath);
    }
    this.resources?.invalidateHistory();
  }

  setTerrainShader(shaderPath: string): void {
    this.terrainShaderPath = shaderPath;
    if (!this.terrainComputePass) {
      return;
    }
    void this.terrainComputePass.setShader(shaderPath).then(() => {
      this.refreshTerrain();
    });
  }

  setTerritoryShaderParams(
    params0: Float32Array | number[],
    params1: Float32Array | number[],
  ): void {
    for (let i = 0; i < 4; i++) {
      this.territoryShaderParams0[i] = Number(params0[i] ?? 0);
      this.territoryShaderParams1[i] = Number(params1[i] ?? 0);
    }

    if (!this.resources) {
      return;
    }
    this.resources.setTerritoryShaderParams(
      this.territoryShaderParams0,
      this.territoryShaderParams1,
    );
    this.resources.invalidateHistory();
  }

  setTerrainShaderParams(
    params0: Float32Array | number[],
    params1: Float32Array | number[],
  ): void {
    for (let i = 0; i < 4; i++) {
      this.terrainShaderParams0[i] = Number(params0[i] ?? 0);
      this.terrainShaderParams1[i] = Number(params1[i] ?? 0);
    }

    if (!this.resources) {
      return;
    }
    this.resources.setTerrainShaderParams(
      this.terrainShaderParams0,
      this.terrainShaderParams1,
    );
    this.refreshTerrain();
  }

  setPreSmoothing(
    enabled: boolean,
    shaderPath: string,
    params0: Float32Array | number[],
  ): void {
    this.preSmoothingEnabled = enabled;
    if (shaderPath) {
      this.preSmoothingShaderPath = shaderPath;
    }
    for (let i = 0; i < 4; i++) {
      this.preSmoothingParams0[i] = Number(params0[i] ?? 0);
    }
    this.applyPreSmoothingConfig();
  }

  setPostSmoothing(
    enabled: boolean,
    shaderPath: string,
    params0: Float32Array | number[],
  ): void {
    this.postSmoothingEnabled = enabled;
    if (shaderPath) {
      this.postSmoothingShaderPath = shaderPath;
    }
    for (let i = 0; i < 4; i++) {
      this.postSmoothingParams0[i] = Number(params0[i] ?? 0);
    }
    this.applyPostSmoothingConfig();
  }

  private applyPreSmoothingConfig(): void {
    if (!this.resources || !this.visualStateSmoothingPass) {
      return;
    }

    this.resources.setUseVisualStateTexture(this.preSmoothingEnabled);
    if (this.preSmoothingEnabled) {
      this.resources.ensureVisualStateTexture();
      void this.visualStateSmoothingPass.setShader(this.preSmoothingShaderPath);
      this.visualStateSmoothingPass.setParams(this.preSmoothingParams0);
    } else {
      this.visualStateSmoothingPass.setParams(new Float32Array(4));
      this.resources.releaseVisualStateTexture();
    }

    this.resources.invalidateHistory();
  }

  private applyPostSmoothingConfig(): void {
    if (!this.resources || !this.temporalResolvePass || !this.device) {
      return;
    }

    if (this.postSmoothingEnabled) {
      void this.temporalResolvePass.setShader(this.postSmoothingShaderPath);
      this.temporalResolvePass.setParams(this.postSmoothingParams0);
      this.temporalResolvePass.setEnabled(true);
      // Note: canvas size not available here, will be set on first setViewSize
      if (this.resources) {
        this.resources.ensurePostSmoothingTextures(
          1,
          1,
          this.device.canvasFormat,
        );
      }
    } else {
      this.temporalResolvePass.setEnabled(false);
      this.resources.releasePostSmoothingTextures();
    }

    this.resources.invalidateHistory();
  }

  markTile(tile: TileRef): void {
    if (this.stateUpdatePass) {
      // TileRef is number, StateUpdatePass.markTile expects number
      this.stateUpdatePass.markTile(tile as number);
    }
  }

  markAllDirty(): void {
    if (!this.resources) {
      return;
    }
    // Full sync points used when the dirty-tile pipeline overflows or when
    // global settings require a complete rebuild.
    this.resources.markStateDirty();
    this.resources.markDefensePostsDirty();
    this.resources.markDefendedFullRecompute();
    this.resources.markPaletteDirty();
    this.resources.invalidateHistory();

    this.terrainComputePass?.markDirty();
  }

  refreshPalette(): void {
    if (!this.resources) {
      return;
    }
    this.resources.markPaletteDirty();
  }

  markRelationsDirty(): void {
    this.resources?.markRelationsDirty();
  }

  markRelationsPairDirty(aSmallId: number, bSmallId: number): void {
    this.resources?.markRelationsPairDirty(aSmallId, bSmallId);
  }

  setPaletteFromBytes(
    paletteWidth: number,
    maxSmallId: number,
    row0: Uint8Array,
    row1: Uint8Array,
  ): void {
    if (!this.resources) {
      return;
    }
    this.resources.setPaletteOverride(paletteWidth, maxSmallId, row0, row1);
    this.resources.invalidateHistory();
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
      this.computeTerrainImmediate();
    }
  }

  dispose(): void {
    this.ready = false;
    this.computePasses = [];
    this.computePassOrder = [];
    this.frameComputePasses = [];
    this.renderPasses = [];
    this.renderPassOrder = [];
    this.terrainComputePass = null;
    this.stateUpdatePass = null;
    this.defendedStrengthFullPass = null;
    this.defendedStrengthPass = null;
    this.visualStateSmoothingPass = null;
    this.territoryRenderPass = null;
    this.temporalResolvePass = null;
    this.resources = null;
    this.gameViewAdapter = null;
    this.device = null;
    this.canvas = null;
  }

  private computeTerrainImmediate(): void {
    if (
      !this.ready ||
      !this.device ||
      !this.resources ||
      !this.terrainComputePass
    ) {
      return;
    }

    this.resources.uploadTerrainParams();

    if (!this.terrainComputePass.needsUpdate()) {
      return;
    }

    const encoder = this.device.device.createCommandEncoder();
    this.terrainComputePass.execute(encoder, this.resources);
    this.device.device.queue.submit([encoder.finish()]);

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

    this.resources.updateTickTiming(performance.now() / 1000);

    if (
      this.gameViewAdapter?.config().defensePostRange() !==
      this.defensePostRange
    ) {
      throw new Error("defensePostRange changed at runtime; unsupported.");
    }

    // Upload palette if needed
    this.resources.uploadPalette();

    // Upload diplomacy relations
    this.resources.uploadRelations();

    // Upload defense posts if needed
    this.resources.uploadDefensePosts();

    // Initial state upload
    this.resources.uploadState();

    const stateUpdatesPending = this.stateUpdatePass?.needsUpdate() ?? false;
    if (!stateUpdatesPending) {
      this.resources.setLastStateUpdateCount(0);
    }

    const needsCompute =
      (this.terrainComputePass?.needsUpdate() ?? false) ||
      stateUpdatesPending ||
      (this.defendedStrengthFullPass?.needsUpdate() ?? false) ||
      (this.defendedStrengthPass?.needsUpdate() ?? false);

    if (!needsCompute) {
      return;
    }

    const encoder = this.device.device.createCommandEncoder();

    if (this.preSmoothingEnabled && stateUpdatesPending) {
      this.resources.ensureVisualStateTexture();
      const visualStateTexture = this.resources.getVisualStateTexture();
      if (visualStateTexture) {
        encoder.copyTextureToTexture(
          { texture: this.resources.stateTexture },
          { texture: visualStateTexture },
          {
            width: this.resources.getMapWidth(),
            height: this.resources.getMapHeight(),
            depthOrArrayLayers: 1,
          },
        );
        this.resources.consumeVisualStateSyncNeeded();
      }
    }

    // Execute compute passes in dependency order
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

    const nowSec = performance.now() / 1000;
    this.resources.writeTemporalUniformBuffer(nowSec);

    // If terrain needs recomputation, trigger it asynchronously
    if (this.terrainComputePass?.needsUpdate()) {
      this.resources.uploadTerrainParams();
      const computeEncoder = this.device.device.createCommandEncoder();
      this.terrainComputePass.execute(computeEncoder, this.resources);
      this.device.device.queue.submit([computeEncoder.finish()]);
    }

    const encoder = this.device.device.createCommandEncoder();
    const swapchainView = this.device.context.getCurrentTexture().createView();

    if (
      this.preSmoothingEnabled &&
      this.resources.consumeVisualStateSyncNeeded()
    ) {
      const visualStateTexture = this.resources.getVisualStateTexture();
      if (visualStateTexture) {
        encoder.copyTextureToTexture(
          { texture: this.resources.stateTexture },
          { texture: visualStateTexture },
          {
            width: this.resources.getMapWidth(),
            height: this.resources.getMapHeight(),
            depthOrArrayLayers: 1,
          },
        );
      }
    }

    for (const pass of this.frameComputePasses) {
      if (!pass.needsUpdate()) {
        continue;
      }
      pass.execute(encoder, this.resources);
    }

    // Execute render passes in dependency order
    for (const pass of this.renderPassOrder) {
      if (!pass.needsUpdate()) {
        continue;
      }
      if (pass === this.territoryRenderPass && this.postSmoothingEnabled) {
        if (!this.resources.getCurrentColorTexture()) {
          const viewWidth = this.canvas?.width ?? 1;
          const viewHeight = this.canvas?.height ?? 1;
          this.resources.ensurePostSmoothingTextures(
            viewWidth,
            viewHeight,
            this.device.canvasFormat,
          );
        }
        const currentTexture = this.resources.getCurrentColorTexture();
        if (currentTexture) {
          pass.execute(encoder, this.resources, currentTexture.createView());
        }
        continue;
      }

      pass.execute(encoder, this.resources, swapchainView);
    }

    this.device.device.queue.submit([encoder.finish()]);
  }
}
