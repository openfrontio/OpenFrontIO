import { GroundTruthData } from "../core/GroundTruthData";
import { loadShader } from "../core/ShaderLoader";
import { ComputePass } from "./ComputePass";

/**
 * Full defended strength recompute across the entire map.
 * Used on initial upload or when post diffs are too large for a tile list.
 */
export class DefendedStrengthFullPass implements ComputePass {
  name = "defended-strength-full";
  dependencies: string[] = ["state-update"];

  private pipeline: GPUComputePipeline | null = null;
  private bindGroupLayout: GPUBindGroupLayout | null = null;
  private bindGroup: GPUBindGroup | null = null;
  private device: GPUDevice | null = null;
  private resources: GroundTruthData | null = null;
  private boundPostsByOwnerBuffer: GPUBuffer | null = null;

  async init(device: GPUDevice, resources: GroundTruthData): Promise<void> {
    this.device = device;
    this.resources = resources;

    const shaderCode = await loadShader("compute/defended-strength-full.wgsl");
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
          texture: { sampleType: "uint" },
        },
        {
          binding: 2,
          visibility: 4 /* COMPUTE */,
          storageTexture: { format: "rgba8unorm" },
        },
        {
          binding: 3,
          visibility: 4 /* COMPUTE */,
          buffer: { type: "read-only-storage" },
        },
        {
          binding: 4,
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
    return this.resources?.needsDefendedFullRecompute() ?? false;
  }

  execute(encoder: GPUCommandEncoder, resources: GroundTruthData): void {
    if (!this.device || !this.pipeline) {
      return;
    }

    if (!resources.needsDefendedFullRecompute()) {
      return;
    }

    resources.writeDefendedStrengthParamsBuffer(0);

    const postsByOwnerBuffer = resources.defensePostsByOwnerBuffer;
    if (
      !this.bindGroup ||
      this.boundPostsByOwnerBuffer !== postsByOwnerBuffer
    ) {
      this.rebuildBindGroup();
    }
    if (!this.bindGroup) {
      return;
    }

    const mapWidth = resources.getMapWidth();
    const mapHeight = resources.getMapHeight();
    const workgroupCountX = Math.ceil(mapWidth / 8);
    const workgroupCountY = Math.ceil(mapHeight / 8);

    const pass = encoder.beginComputePass();
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.dispatchWorkgroups(workgroupCountX, workgroupCountY);
    pass.end();

    resources.clearDefendedFullRecompute();
  }

  private rebuildBindGroup(): void {
    if (
      !this.device ||
      !this.bindGroupLayout ||
      !this.resources ||
      !this.resources.defendedStrengthParamsBuffer ||
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
          resource: this.resources.stateTexture.createView(),
        },
        {
          binding: 2,
          resource: this.resources.defendedStrengthTexture.createView(),
        },
        {
          binding: 3,
          resource: { buffer: this.resources.defenseOwnerOffsetsBuffer },
        },
        {
          binding: 4,
          resource: { buffer: this.resources.defensePostsByOwnerBuffer },
        },
      ],
    });

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
