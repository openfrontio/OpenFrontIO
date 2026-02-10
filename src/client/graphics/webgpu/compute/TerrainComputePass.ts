import { GroundTruthData } from "../core/GroundTruthData";
import { loadShader } from "../core/ShaderLoader";
import { ComputePass } from "./ComputePass";

/**
 * Compute pass that generates terrain colors from terrain data.
 * Runs once at initialization or when theme changes.
 */
export class TerrainComputePass implements ComputePass {
  name = "terrain-compute";
  dependencies: string[] = [];

  private pipeline: GPUComputePipeline | null = null;
  private bindGroupLayout: GPUBindGroupLayout | null = null;
  private bindGroup: GPUBindGroup | null = null;
  private device: GPUDevice | null = null;
  private resources: GroundTruthData | null = null;
  private needsCompute = true;
  private shaderPath = "compute/terrain-compute.wgsl";

  async init(device: GPUDevice, resources: GroundTruthData): Promise<void> {
    this.device = device;
    this.resources = resources;

    this.ensureBindGroupLayout();
    await this.setShader(this.shaderPath);
    this.rebuildBindGroup();
  }

  async setShader(shaderPath: string): Promise<void> {
    this.shaderPath = shaderPath;
    if (!this.device || !this.bindGroupLayout) {
      return;
    }

    const shaderCode = await loadShader(shaderPath);
    const shaderModule = this.device.createShaderModule({ code: shaderCode });

    this.pipeline = this.device.createComputePipeline({
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [this.bindGroupLayout],
      }),
      compute: {
        module: shaderModule,
        entryPoint: "main",
      },
    });

    this.needsCompute = true;
  }

  needsUpdate(): boolean {
    return this.needsCompute;
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

    this.needsCompute = false;
  }

  private rebuildBindGroup(): void {
    if (
      !this.device ||
      !this.bindGroupLayout ||
      !this.resources ||
      !this.resources.terrainParamsBuffer ||
      !this.resources.terrainDataTexture ||
      !this.resources.terrainTexture
    ) {
      return;
    }

    this.bindGroup = this.device.createBindGroup({
      layout: this.bindGroupLayout,
      entries: [
        {
          binding: 0,
          resource: { buffer: this.resources.terrainParamsBuffer },
        },
        {
          binding: 1,
          resource: this.resources.terrainDataTexture.createView(),
        },
        {
          binding: 2,
          resource: this.resources.terrainTexture.createView(),
        },
      ],
    });
  }

  private ensureBindGroupLayout(): void {
    if (!this.device || this.bindGroupLayout) {
      return;
    }

    this.bindGroupLayout = this.device.createBindGroupLayout({
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
      ],
    });
  }

  markDirty(): void {
    this.needsCompute = true;
    // Rebuild bind group in case terrain params buffer was recreated
    this.rebuildBindGroup();
  }

  dispose(): void {
    this.pipeline = null;
    this.bindGroupLayout = null;
    this.bindGroup = null;
    this.device = null;
    this.resources = null;
  }
}
