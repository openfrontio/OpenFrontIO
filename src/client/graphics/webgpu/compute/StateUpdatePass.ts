import { GroundTruthData } from "../core/GroundTruthData";
import { loadShader } from "../core/ShaderLoader";
import { ComputePass } from "./ComputePass";

/**
 * Compute pass that scatters tile state updates into the state texture.
 */
export class StateUpdatePass implements ComputePass {
  name = "state-update";
  dependencies: string[] = [];

  private pipeline: GPUComputePipeline | null = null;
  private bindGroupLayout: GPUBindGroupLayout | null = null;
  private bindGroup: GPUBindGroup | null = null;
  private device: GPUDevice | null = null;
  private resources: GroundTruthData | null = null;
  private readonly pendingTiles: Set<number> = new Set();
  private boundUpdatesBuffer: GPUBuffer | null = null;
  private boundPostsByOwnerBuffer: GPUBuffer | null = null;

  async init(device: GPUDevice, resources: GroundTruthData): Promise<void> {
    this.device = device;
    this.resources = resources;

    const shaderCode = await loadShader("compute/state-update.wgsl");
    const shaderModule = device.createShaderModule({ code: shaderCode });

    this.bindGroupLayout = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: 4 /* COMPUTE */,
          buffer: { type: "uniform" },
        },
        {
          binding: 1,
          visibility: 4 /* COMPUTE */,
          buffer: { type: "read-only-storage" },
        },
        {
          binding: 2,
          visibility: 4 /* COMPUTE */,
          storageTexture: { format: "r32uint" },
        },
        {
          binding: 3,
          visibility: 4 /* COMPUTE */,
          storageTexture: { format: "rgba8unorm" },
        },
        {
          binding: 4,
          visibility: 4 /* COMPUTE */,
          buffer: { type: "read-only-storage" },
        },
        {
          binding: 5,
          visibility: 4 /* COMPUTE */,
          buffer: { type: "read-only-storage" },
        },
      ],
    });

    this.pipeline = device.createComputePipeline({
      layout: device.createPipelineLayout({
        bindGroupLayouts: [this.bindGroupLayout],
      }),
      compute: {
        module: shaderModule,
        entryPoint: "main",
      },
    });

    this.rebuildBindGroup();
  }

  needsUpdate(): boolean {
    return this.pendingTiles.size > 0;
  }

  execute(encoder: GPUCommandEncoder, resources: GroundTruthData): void {
    if (!this.device || !this.pipeline) {
      return;
    }

    const numUpdates = this.pendingTiles.size;
    if (numUpdates === 0) {
      return;
    }

    resources.setLastStateUpdateCount(numUpdates);

    const updatesBuffer = resources.ensureUpdatesBuffer(numUpdates);
    resources.writeStateUpdateParamsBuffer(numUpdates);

    const staging = resources.getUpdatesStaging();
    const state = resources.getState();

    // Prepare staging data
    let idx = 0;
    for (const tile of this.pendingTiles) {
      const stateValue = state[tile];
      staging[idx * 2] = tile;
      staging[idx * 2 + 1] = stateValue;
      idx++;
    }

    // Upload to GPU
    this.device.queue.writeBuffer(
      updatesBuffer,
      0,
      staging.subarray(0, numUpdates * 2),
    );

    const postsByOwnerBuffer = resources.defensePostsByOwnerBuffer;
    const shouldRebuildBindGroup =
      !this.bindGroup ||
      this.boundUpdatesBuffer !== updatesBuffer ||
      this.boundPostsByOwnerBuffer !== postsByOwnerBuffer;

    if (shouldRebuildBindGroup) {
      this.rebuildBindGroup();
    }

    if (!this.bindGroup) {
      return;
    }

    const pass = encoder.beginComputePass();
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    const workgroupCount = Math.ceil(numUpdates / 64);
    pass.dispatchWorkgroups(workgroupCount);
    pass.end();

    this.pendingTiles.clear();
  }

  private rebuildBindGroup(): void {
    if (
      !this.device ||
      !this.bindGroupLayout ||
      !this.resources ||
      !this.resources.stateUpdateParamsBuffer ||
      !this.resources.updatesBuffer ||
      !this.resources.stateTexture ||
      !this.resources.defendedStrengthTexture ||
      !this.resources.defenseOwnerOffsetsBuffer ||
      !this.resources.defensePostsByOwnerBuffer
    ) {
      this.bindGroup = null;
      return;
    }

    this.bindGroup = this.device.createBindGroup({
      layout: this.bindGroupLayout,
      entries: [
        {
          binding: 0,
          resource: { buffer: this.resources.stateUpdateParamsBuffer },
        },
        { binding: 1, resource: { buffer: this.resources.updatesBuffer } },
        {
          binding: 2,
          resource: this.resources.stateTexture.createView(),
        },
        {
          binding: 3,
          resource: this.resources.defendedStrengthTexture.createView(),
        },
        {
          binding: 4,
          resource: { buffer: this.resources.defenseOwnerOffsetsBuffer },
        },
        {
          binding: 5,
          resource: { buffer: this.resources.defensePostsByOwnerBuffer },
        },
      ],
    });

    this.boundUpdatesBuffer = this.resources.updatesBuffer;
    this.boundPostsByOwnerBuffer = this.resources.defensePostsByOwnerBuffer;
  }

  markTile(tile: number): void {
    this.pendingTiles.add(tile);
  }

  dispose(): void {
    // Resources are managed by GroundTruthData
    this.pipeline = null;
    this.bindGroupLayout = null;
    this.bindGroup = null;
    this.device = null;
    this.resources = null;
  }
}
