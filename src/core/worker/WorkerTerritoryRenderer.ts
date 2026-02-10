import { Theme } from "../configuration/Config";
import { TileRef } from "../game/GameMap";
import { GameUpdateViewData } from "../game/GameUpdates";
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
  private lastGpuWork: Promise<void> | null = null;
  private frameDirty = true;

  private lastViewWidth = 0;
  private lastViewHeight = 0;
  private lastViewScale = NaN;
  private lastViewOffsetX = NaN;
  private lastViewOffsetY = NaN;
  private lastAlternativeViewEnabled: boolean | null = null;
  private lastHighlightedOwnerSmallId: number | null = null;

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
  private tickPending = false;
  private tickRunning = false;
  private gpuWaitEnabled = true;
  private readonly gpuWaitTimeoutMs = 250;

  /**
   * Initialize renderer with offscreen canvas and game data.
   */
  async init(
    offscreenCanvas: OffscreenCanvas,
    gameRunner: GameRunner,
    theme: Theme,
    myClientID: ClientID | null,
    cosmeticsByClientID: Map<ClientID, PlayerCosmetics>,
    tileState: Uint16Array,
  ): Promise<void> {
    this.canvas = offscreenCanvas;
    const game = gameRunner.game;
    this.defensePostRange = game.config().defensePostRange();

    // Create adapter
    this.gameViewAdapter = new GameViewAdapter(
      tileState,
      game.terrainDataView(),
      game.width(),
      game.height(),
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
    const state = tileState;
    this.resources = GroundTruthData.create(
      webgpuDevice.device,
      this.gameViewAdapter as any,
      theme,
      this.defensePostRange,
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
    void this.terrainComputePass
      .setShader(this.terrainShaderPath)
      .then(() => {
        this.computeTerrainImmediate();
      })
      .catch(() => {});
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
  updateGameView(gu: GameUpdateViewData): boolean {
    if (!this.gameViewAdapter) {
      return false;
    }

    this.gameViewAdapter.update(gu);
    const defensePostsDirty = this.gameViewAdapter.consumeDefensePostsDirty();
    const rosterDirty = this.gameViewAdapter.consumeRosterDirty();
    const playersDirty = this.gameViewAdapter.consumePlayersDirty();
    if (defensePostsDirty) {
      this.resources?.markDefensePostsDirty();
    }
    if (rosterDirty) {
      this.resources?.markRelationsDirty();
      this.resources?.markPaletteDirty();
      this.resources?.invalidateHistory();
    } else if (playersDirty) {
      this.resources?.markPaletteDirty();
      this.resources?.invalidateHistory();
    }
    const didWork = defensePostsDirty || rosterDirty || playersDirty;
    if (didWork) {
      this.frameDirty = true;
    }
    return didWork;
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

    if (
      nextWidth === this.lastViewWidth &&
      nextHeight === this.lastViewHeight
    ) {
      return;
    }
    this.lastViewWidth = nextWidth;
    this.lastViewHeight = nextHeight;
    this.frameDirty = true;

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
    if (
      scale === this.lastViewScale &&
      offsetX === this.lastViewOffsetX &&
      offsetY === this.lastViewOffsetY
    ) {
      return;
    }
    this.lastViewScale = scale;
    this.lastViewOffsetX = offsetX;
    this.lastViewOffsetY = offsetY;
    this.frameDirty = true;
    this.resources.setViewTransform(scale, offsetX, offsetY);
  }

  setAlternativeView(enabled: boolean): void {
    if (!this.resources) {
      return;
    }
    if (enabled === this.lastAlternativeViewEnabled) {
      return;
    }
    this.lastAlternativeViewEnabled = enabled;
    this.frameDirty = true;
    this.resources.setAlternativeView(enabled);
  }

  setHighlightedOwnerId(ownerSmallId: number | null): void {
    if (!this.resources) {
      return;
    }
    if (ownerSmallId === this.lastHighlightedOwnerSmallId) {
      return;
    }
    this.lastHighlightedOwnerSmallId = ownerSmallId;
    this.frameDirty = true;
    this.resources.setHighlightedOwnerId(ownerSmallId);
  }

  setPatternsEnabled(enabled: boolean): void {
    this.patternsEnabled = enabled;
    this.gameViewAdapter?.setPatternsEnabled(enabled);
    this.resources?.markPaletteDirty();
    this.resources?.invalidateHistory();
    this.frameDirty = true;
  }

  setTerritoryShader(shaderPath: string): void {
    this.territoryShaderPath = shaderPath;
    if (this.territoryRenderPass) {
      void this.territoryRenderPass.setShader(shaderPath);
    }
    this.resources?.invalidateHistory();
    this.frameDirty = true;
  }

  setTerrainShader(shaderPath: string): void {
    this.terrainShaderPath = shaderPath;
    if (!this.terrainComputePass) {
      return;
    }
    void this.terrainComputePass.setShader(shaderPath).then(() => {
      this.refreshTerrain();
    });
    this.frameDirty = true;
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
    this.frameDirty = true;
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
    this.frameDirty = true;
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
    this.frameDirty = true;
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
    this.frameDirty = true;
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
        const w =
          (this.canvas?.width ?? this.lastViewWidth ?? 0) > 0
            ? (this.canvas?.width ?? this.lastViewWidth)
            : 1;
        const h =
          (this.canvas?.height ?? this.lastViewHeight ?? 0) > 0
            ? (this.canvas?.height ?? this.lastViewHeight)
            : 1;
        this.resources.ensurePostSmoothingTextures(
          w,
          h,
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
    this.frameDirty = true;
  }

  refreshPalette(): void {
    if (!this.resources) {
      return;
    }
    this.resources.markPaletteDirty();
    this.frameDirty = true;
  }

  markRelationsDirty(): void {
    this.resources?.markRelationsDirty();
    this.frameDirty = true;
  }

  markRelationsPairDirty(aSmallId: number, bSmallId: number): void {
    this.resources?.markRelationsPairDirty(aSmallId, bSmallId);
    this.frameDirty = true;
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
    this.frameDirty = true;
  }

  markDefensePostsDirty(): void {
    if (!this.resources) {
      return;
    }
    this.resources.markDefensePostsDirty();
    this.frameDirty = true;
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
    this.frameDirty = true;
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
  tick(): boolean {
    if (!this.ready || !this.device || !this.resources) {
      return false;
    }

    this.resources.updateTickTiming(performance.now() / 1000);

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
      return false;
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
    this.frameDirty = true;
    return true;
  }

  requestTick(): void {
    this.tickPending = true;
    if (this.tickRunning) {
      return;
    }
    this.tickRunning = true;
    void this.runTickLoop();
  }

  private async runTickLoop(): Promise<void> {
    try {
      while (this.tickPending) {
        this.tickPending = false;

        if (!this.ready || !this.device) {
          return;
        }

        if (this.gpuWaitEnabled && this.lastGpuWork) {
          const r = await this.awaitGpuWork(this.lastGpuWork);
          if (r.timedOut) {
            this.gpuWaitEnabled = false;
          }
          this.lastGpuWork = null;
        }

        const submitted = this.tick();
        const q: any = this.device.device.queue as any;
        if (submitted && typeof q?.onSubmittedWorkDone === "function") {
          const p = q.onSubmittedWorkDone() as Promise<void>;
          this.lastGpuWork = p.catch(() => {});
          if (this.gpuWaitEnabled) {
            const r = await this.awaitGpuWork(this.lastGpuWork);
            if (r.timedOut) {
              this.gpuWaitEnabled = false;
              this.lastGpuWork = null;
            } else {
              this.lastGpuWork = null;
            }
          }
        }
      }
    } finally {
      this.tickRunning = false;
    }
  }

  /**
   * Render one frame.
   * Runs render passes to draw to the canvas.
   */
  render(
    onGetTextureMs?: (ms: number) => void,
    profile?: {
      cpuTotalMs: number;
      frameComputeMs: number;
      territoryPassMs: number;
      temporalResolveMs: number;
      submitMs: number;
    },
  ): boolean {
    if (
      !this.ready ||
      !this.device ||
      !this.resources ||
      !this.territoryRenderPass
    ) {
      return false;
    }

    // Without post-smoothing, stable frames can simply be skipped.
    if (!this.frameDirty && !this.postSmoothingEnabled) {
      return false;
    }

    const cpuStart = profile ? performance.now() : 0;

    const nowSec = performance.now() / 1000;
    this.resources.writeTemporalUniformBuffer(nowSec);

    const encoder = this.device.device.createCommandEncoder();
    const getTexStart = performance.now();
    const swapchainView = this.device.context.getCurrentTexture().createView();
    if (onGetTextureMs) {
      onGetTextureMs(performance.now() - getTexStart);
    }

    let frameComputeMs = 0;
    if (
      this.preSmoothingEnabled &&
      this.resources.consumeVisualStateSyncNeeded()
    ) {
      const start = profile ? performance.now() : 0;
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
      if (profile) {
        frameComputeMs += performance.now() - start;
      }
    }

    for (const pass of this.frameComputePasses) {
      if (!pass.needsUpdate()) {
        continue;
      }
      const start = profile ? performance.now() : 0;
      pass.execute(encoder, this.resources);
      if (profile) {
        frameComputeMs += performance.now() - start;
      }
    }
    if (profile) {
      profile.frameComputeMs = frameComputeMs;
    }

    let territoryPassMs = 0;
    let temporalResolveMs = 0;

    // Execute render passes in dependency order.
    for (const pass of this.renderPassOrder) {
      if (!pass.needsUpdate()) {
        continue;
      }

      const passStart = profile ? performance.now() : 0;

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

        if (profile) {
          territoryPassMs += performance.now() - passStart;
        }
        continue;
      }

      pass.execute(encoder, this.resources, swapchainView);

      if (profile) {
        const dt = performance.now() - passStart;
        if (pass === this.territoryRenderPass) {
          territoryPassMs += dt;
        } else if (pass === this.temporalResolvePass) {
          temporalResolveMs += dt;
        }
      }
    }

    const submitStart = profile ? performance.now() : 0;
    this.device.device.queue.submit([encoder.finish()]);

    if (profile) {
      profile.territoryPassMs = territoryPassMs;
      profile.temporalResolveMs = temporalResolveMs;
      profile.submitMs = performance.now() - submitStart;
      profile.cpuTotalMs = performance.now() - cpuStart;
    }

    if (!this.postSmoothingEnabled) {
      this.frameDirty = false;
    }
    return true;
  }

  async renderAsync(profilePhases: boolean = false): Promise<{
    waitPrevGpuMs: number;
    cpuMs: number;
    getTextureMs: number;
    submitted: boolean;
    frameComputeMs?: number;
    territoryPassMs?: number;
    temporalResolveMs?: number;
    submitMs?: number;
    cpuTotalMs?: number;
    gpuWaitMs: number;
    waitPrevGpuTimedOut: boolean;
    gpuWaitTimedOut: boolean;
  } | null> {
    if (!this.ready || !this.device) {
      return null;
    }

    const waitPrevGpuMs = 0;
    let cpuMs = 0;
    let getTextureMs = 0;
    let submitted = false;
    let frameComputeMs: number | undefined;
    let territoryPassMs: number | undefined;
    let temporalResolveMs: number | undefined;
    let submitMs: number | undefined;
    let cpuTotalMs: number | undefined;
    const gpuWaitMs = 0;
    const waitPrevGpuTimedOut = false;
    const gpuWaitTimedOut = false;

    // Keep render_frame handlers cheap: do not await GPU progress here.
    // Backpressure is handled on the main thread (one in-flight render).
    this.lastGpuWork = null;

    const cpuStart = performance.now();
    const profile = profilePhases
      ? {
          cpuTotalMs: 0,
          frameComputeMs: 0,
          territoryPassMs: 0,
          temporalResolveMs: 0,
          submitMs: 0,
        }
      : undefined;

    submitted = this.render((ms) => {
      getTextureMs = ms;
    }, profile);
    cpuMs = performance.now() - cpuStart;

    if (!submitted) {
      this.lastGpuWork = null;
      return {
        waitPrevGpuMs,
        cpuMs,
        getTextureMs,
        submitted,
        gpuWaitMs,
        waitPrevGpuTimedOut,
        gpuWaitTimedOut,
      };
    }

    const q: any = this.device.device.queue as any;
    if (typeof q?.onSubmittedWorkDone !== "function") {
      this.lastGpuWork = null;
      return {
        waitPrevGpuMs,
        cpuMs,
        getTextureMs,
        submitted,
        frameComputeMs,
        territoryPassMs,
        temporalResolveMs,
        submitMs,
        cpuTotalMs,
        gpuWaitMs,
        waitPrevGpuTimedOut,
        gpuWaitTimedOut,
      };
    }

    if (profile) {
      frameComputeMs = profile.frameComputeMs;
      territoryPassMs = profile.territoryPassMs;
      temporalResolveMs = profile.temporalResolveMs;
      submitMs = profile.submitMs;
      cpuTotalMs = profile.cpuTotalMs;
    }

    const p = q.onSubmittedWorkDone() as Promise<void>;
    this.lastGpuWork = p.catch(() => {});

    return {
      waitPrevGpuMs,
      cpuMs,
      getTextureMs,
      submitted,
      frameComputeMs,
      territoryPassMs,
      temporalResolveMs,
      submitMs,
      cpuTotalMs,
      gpuWaitMs,
      waitPrevGpuTimedOut,
      gpuWaitTimedOut,
    };
  }

  private async awaitGpuWork(
    work: Promise<void>,
  ): Promise<{ timedOut: boolean }> {
    let timeoutId: any = null;
    const timeout = new Promise<"timeout">((resolve) => {
      timeoutId = setTimeout(() => resolve("timeout"), this.gpuWaitTimeoutMs);
    });
    const result = await Promise.race([
      work.then(() => "done" as const),
      timeout,
    ]);
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
    return { timedOut: result === "timeout" };
  }
}
