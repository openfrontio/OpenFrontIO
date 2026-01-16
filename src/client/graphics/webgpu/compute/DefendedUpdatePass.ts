import { GroundTruthData } from "../core/GroundTruthData";
import { loadShader } from "../core/ShaderLoader";
import { ComputePass } from "./ComputePass";

/**
 * Compute pass that updates the defended texture from defense posts.
 */
export class DefendedUpdatePass implements ComputePass {
  name = "defended-update";
  dependencies: string[] = ["state-update"];

  private pipeline: GPUComputePipeline | null = null;
  private bindGroupLayout: GPUBindGroupLayout | null = null;
  private bindGroup: GPUBindGroup | null = null;
  private device: GPUDevice | null = null;
  private resources: GroundTruthData | null = null;
  private needsRebuild = true;

  async init(device: GPUDevice, resources: GroundTruthData): Promise<void> {
    this.device = device;
    this.resources = resources;

    const shaderCode = await loadShader("compute/defended-update.wgsl");
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
  }

  needsUpdate(): boolean {
    if (!this.resources || !this.needsRebuild) {
      return false;
    }

    // Only run if we have defense posts
    return this.resources.getDefensePostsCount() > 0;
  }

  execute(encoder: GPUCommandEncoder, resources: GroundTruthData): void {
    if (!this.device || !this.pipeline) {
      return;
    }

    const range = resources.getGame().config().defensePostRange();
    const postsCount = resources.getDefensePostsCount();

    if (postsCount === 0) {
      this.needsRebuild = false;
      return;
    }

    // Epoch is incremented by orchestrator before this pass runs
    resources.writeDefenseParamsBuffer();

    const oldBuffer = this.resources?.defensePostsBuffer;
    const bufferChanged = oldBuffer !== resources.defensePostsBuffer;

    if (bufferChanged) {
      this.rebuildBindGroup();
    }

    if (!this.bindGroup) {
      return;
    }

    const gridSize = 2 * range + 1;
    const workgroupCount = Math.ceil(gridSize / 8);

    const pass = encoder.beginComputePass();
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.dispatchWorkgroups(workgroupCount, workgroupCount, postsCount);
    pass.end();

    this.needsRebuild = false;
  }

  private rebuildBindGroup(): void {
    if (
      !this.device ||
      !this.bindGroupLayout ||
      !this.resources ||
      !this.resources.defenseParamsBuffer ||
      !this.resources.defensePostsBuffer ||
      !this.resources.stateTexture ||
      !this.resources.defendedTexture ||
      this.resources.getDefensePostsCount() <= 0
    ) {
      this.bindGroup = null;
      return;
    }

    this.bindGroup = this.device.createBindGroup({
      layout: this.bindGroupLayout,
      entries: [
        {
          binding: 0,
          resource: { buffer: this.resources.defenseParamsBuffer },
        },
        {
          binding: 1,
          resource: { buffer: this.resources.defensePostsBuffer },
        },
        {
          binding: 2,
          resource: this.resources.stateTexture.createView(),
        },
        {
          binding: 3,
          resource: this.resources.defendedTexture.createView(),
        },
      ],
    });
  }

  markDirty(): void {
    this.needsRebuild = true;
  }

  dispose(): void {
    this.pipeline = null;
    this.bindGroupLayout = null;
    this.bindGroup = null;
    this.device = null;
    this.resources = null;
  }
}
