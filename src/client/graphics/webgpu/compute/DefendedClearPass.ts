import { GroundTruthData } from "../core/GroundTruthData";
import { loadShader } from "../core/ShaderLoader";
import { ComputePass } from "./ComputePass";

/**
 * Compute pass that clears the defended texture (sets all texels to 0).
 * Used for initial clear and epoch wrap scenarios.
 */
export class DefendedClearPass implements ComputePass {
  name = "defended-clear";
  dependencies: string[] = [];

  private pipeline: GPUComputePipeline | null = null;
  private bindGroupLayout: GPUBindGroupLayout | null = null;
  private bindGroup: GPUBindGroup | null = null;
  private device: GPUDevice | null = null;
  private resources: GroundTruthData | null = null;
  private needsHardClear = true;

  async init(device: GPUDevice, resources: GroundTruthData): Promise<void> {
    this.device = device;
    this.resources = resources;

    const shaderCode = await loadShader("compute/defended-clear.wgsl");
    const shaderModule = device.createShaderModule({ code: shaderCode });

    this.bindGroupLayout = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
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
    return this.needsHardClear;
  }

  execute(encoder: GPUCommandEncoder, resources: GroundTruthData): void {
    if (!this.device || !this.pipeline || !this.bindGroup) {
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

    this.needsHardClear = false;
  }

  private rebuildBindGroup(): void {
    if (
      !this.device ||
      !this.bindGroupLayout ||
      !this.resources ||
      !this.resources.defendedTexture
    ) {
      return;
    }

    this.bindGroup = this.device.createBindGroup({
      layout: this.bindGroupLayout,
      entries: [
        {
          binding: 0,
          resource: this.resources.defendedTexture.createView(),
        },
      ],
    });
  }

  setNeedsHardClear(value: boolean): void {
    this.needsHardClear = value;
  }

  dispose(): void {
    this.pipeline = null;
    this.bindGroupLayout = null;
    this.bindGroup = null;
    this.device = null;
    this.resources = null;
  }
}
