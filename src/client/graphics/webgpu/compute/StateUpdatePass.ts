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
          buffer: { type: "read-only-storage" },
        },
        {
          binding: 1,
          visibility: 4 /* COMPUTE */,
          storageTexture: { format: "r32uint" },
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

    const oldBuffer = this.resources?.updatesBuffer;
    const updatesBuffer = resources.ensureUpdatesBuffer(numUpdates);
    const bufferChanged = oldBuffer !== updatesBuffer;

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

    // Rebuild bind group if buffer changed
    if (bufferChanged) {
      this.rebuildBindGroup();
    }

    if (!this.bindGroup) {
      return;
    }

    if (this.bindGroup) {
      const pass = encoder.beginComputePass();
      pass.setPipeline(this.pipeline);
      pass.setBindGroup(0, this.bindGroup);
      pass.dispatchWorkgroups(numUpdates);
      pass.end();
    }

    this.pendingTiles.clear();
  }

  private rebuildBindGroup(): void {
    if (
      !this.device ||
      !this.bindGroupLayout ||
      !this.resources ||
      !this.resources.updatesBuffer ||
      !this.resources.stateTexture
    ) {
      return;
    }

    this.bindGroup = this.device.createBindGroup({
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.resources.updatesBuffer } },
        {
          binding: 1,
          resource: this.resources.stateTexture.createView(),
        },
      ],
    });
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
