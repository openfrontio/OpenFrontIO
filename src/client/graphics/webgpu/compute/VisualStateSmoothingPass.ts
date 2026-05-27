import { GroundTruthData } from "../core/GroundTruthData";
import { loadShader } from "../core/ShaderLoader";
import { ComputePass } from "./ComputePass";

/**
 * Per-frame compute pass that updates the visual state texture.
 * Supports dissolve and budgeted reveal modes.
 */
export class VisualStateSmoothingPass implements ComputePass {
  name = "visual-state-smoothing";
  dependencies: string[] = [];

  private pipeline: GPUComputePipeline | null = null;
  private bindGroupLayout: GPUBindGroupLayout | null = null;
  private bindGroup: GPUBindGroup | null = null;
  private device: GPUDevice | null = null;
  private resources: GroundTruthData | null = null;
  private paramsBuffer: GPUBuffer | null = null;
  private paramsData = new Float32Array(8);
  private enabled = false;
  private shaderPath = "compute/visual-state-smoothing.wgsl";
  private mode = 0;
  private curveExp = 1;
  private boundUpdatesBuffer: GPUBuffer | null = null;
  private boundVisualStateTexture: GPUTexture | null = null;

  async init(device: GPUDevice, resources: GroundTruthData): Promise<void> {
    this.device = device;
    this.resources = resources;

    const GPUBufferUsage = (globalThis as any).GPUBufferUsage;
    const UNIFORM = GPUBufferUsage?.UNIFORM ?? 0x40;
    const COPY_DST = GPUBufferUsage?.COPY_DST ?? 0x8;

    this.paramsBuffer = device.createBuffer({
      size: 32,
      usage: UNIFORM | COPY_DST,
    });

    await this.setShader(this.shaderPath);
    this.rebuildBindGroup();
  }

  async setShader(shaderPath: string): Promise<void> {
    this.shaderPath = shaderPath;
    if (!this.device) {
      return;
    }
    const shaderCode = await loadShader(shaderPath);
    const shaderModule = this.device.createShaderModule({ code: shaderCode });

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
          buffer: { type: "uniform" },
        },
        {
          binding: 2,
          visibility: 4 /* COMPUTE */,
          buffer: { type: "read-only-storage" },
        },
        {
          binding: 3,
          visibility: 4 /* COMPUTE */,
          storageTexture: { format: "r32uint" },
        },
      ],
    });

    this.pipeline = this.device.createComputePipeline({
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [this.bindGroupLayout],
      }),
      compute: {
        module: shaderModule,
        entryPoint: "main",
      },
    });

    this.rebuildBindGroup();
  }

  setParams(params0: Float32Array | number[]): void {
    this.mode = Number(params0[0] ?? 0);
    this.curveExp = Number(params0[1] ?? 1);
    this.enabled = this.mode > 0;
  }

  needsUpdate(): boolean {
    if (!this.enabled || !this.resources) {
      return false;
    }
    return this.resources.getLastStateUpdateCount() > 0;
  }

  execute(encoder: GPUCommandEncoder, resources: GroundTruthData): void {
    if (!this.device || !this.pipeline || !this.paramsBuffer) {
      return;
    }

    const updateCount = resources.getLastStateUpdateCount();
    if (updateCount <= 0) {
      return;
    }

    const updatesBuffer = resources.updatesBuffer;
    const visualStateTexture = resources.getVisualStateTexture();
    if (!updatesBuffer || !visualStateTexture) {
      return;
    }

    this.paramsData[0] = this.mode;
    this.paramsData[1] = this.curveExp;
    this.paramsData[2] = 0;
    this.paramsData[3] = 0;
    this.paramsData[4] = updateCount;
    this.paramsData[5] = 0;
    this.paramsData[6] = 0;
    this.paramsData[7] = 0;
    this.device.queue.writeBuffer(this.paramsBuffer, 0, this.paramsData);

    const shouldRebuild =
      !this.bindGroup ||
      this.boundUpdatesBuffer !== updatesBuffer ||
      this.boundVisualStateTexture !== visualStateTexture;
    if (shouldRebuild) {
      this.rebuildBindGroup();
    }

    if (!this.bindGroup) {
      return;
    }

    const pass = encoder.beginComputePass();
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    const workgroupCount = Math.ceil(updateCount / 64);
    pass.dispatchWorkgroups(workgroupCount);
    pass.end();
  }

  private rebuildBindGroup(): void {
    if (
      !this.device ||
      !this.bindGroupLayout ||
      !this.resources ||
      !this.resources.temporalUniformBuffer ||
      !this.paramsBuffer ||
      !this.resources.updatesBuffer ||
      !this.resources.getVisualStateTexture()
    ) {
      this.bindGroup = null;
      return;
    }

    const visualStateTexture = this.resources.getVisualStateTexture();
    if (!visualStateTexture) {
      this.bindGroup = null;
      return;
    }

    this.bindGroup = this.device.createBindGroup({
      layout: this.bindGroupLayout,
      entries: [
        {
          binding: 0,
          resource: { buffer: this.resources.temporalUniformBuffer },
        },
        {
          binding: 1,
          resource: { buffer: this.paramsBuffer },
        },
        {
          binding: 2,
          resource: { buffer: this.resources.updatesBuffer },
        },
        {
          binding: 3,
          resource: visualStateTexture.createView(),
        },
      ],
    });

    this.boundUpdatesBuffer = this.resources.updatesBuffer;
    this.boundVisualStateTexture = visualStateTexture;
  }

  dispose(): void {
    this.pipeline = null;
    this.bindGroupLayout = null;
    this.bindGroup = null;
    this.device = null;
    this.resources = null;
    this.paramsBuffer = null;
  }
}
