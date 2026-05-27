import { GroundTruthData } from "../core/GroundTruthData";
import { loadShader } from "../core/ShaderLoader";
import { ComputePass } from "./ComputePass";

/**
 * Recomputes defended strength for a list of dirty tiles.
 * Dirty tiles are produced when defense posts are added/removed/moved.
 */
export class DefendedStrengthPass implements ComputePass {
  name = "defended-strength";
  dependencies: string[] = ["state-update"];

  private pipeline: GPUComputePipeline | null = null;
  private bindGroupLayout: GPUBindGroupLayout | null = null;
  private bindGroup: GPUBindGroup | null = null;
  private device: GPUDevice | null = null;
  private resources: GroundTruthData | null = null;
  private boundDirtyTilesBuffer: GPUBuffer | null = null;
  private boundPostsByOwnerBuffer: GPUBuffer | null = null;

  async init(device: GPUDevice, resources: GroundTruthData): Promise<void> {
    this.device = device;
    this.resources = resources;

    const shaderCode = await loadShader("compute/defended-strength.wgsl");
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
          texture: { sampleType: "uint" },
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
  }

  needsUpdate(): boolean {
    return (this.resources?.getDefendedDirtyTilesCount() ?? 0) > 0;
  }

  execute(encoder: GPUCommandEncoder, resources: GroundTruthData): void {
    if (!this.device || !this.pipeline) {
      return;
    }

    const dirtyCount = resources.getDefendedDirtyTilesCount();
    if (dirtyCount === 0) {
      return;
    }

    resources.writeDefendedStrengthParamsBuffer(dirtyCount);

    const dirtyTilesBuffer = resources.defendedDirtyTilesBuffer;
    const postsByOwnerBuffer = resources.defensePostsByOwnerBuffer;
    const shouldRebuildBindGroup =
      !this.bindGroup ||
      this.boundDirtyTilesBuffer !== dirtyTilesBuffer ||
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
    const workgroupCount = Math.ceil(dirtyCount / 64);
    pass.dispatchWorkgroups(workgroupCount);
    pass.end();

    resources.clearDefendedDirtyTiles();
  }

  private rebuildBindGroup(): void {
    if (
      !this.device ||
      !this.bindGroupLayout ||
      !this.resources ||
      !this.resources.defendedStrengthParamsBuffer ||
      !this.resources.defendedDirtyTilesBuffer ||
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
          resource: { buffer: this.resources.defendedStrengthParamsBuffer },
        },
        {
          binding: 1,
          resource: { buffer: this.resources.defendedDirtyTilesBuffer },
        },
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

    this.boundDirtyTilesBuffer = this.resources.defendedDirtyTilesBuffer;
    this.boundPostsByOwnerBuffer = this.resources.defensePostsByOwnerBuffer;
  }

  dispose(): void {
    this.pipeline = null;
    this.bindGroupLayout = null;
    this.bindGroup = null;
    this.device = null;
    this.resources = null;
  }
}
