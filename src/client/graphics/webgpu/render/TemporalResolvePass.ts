import { GroundTruthData } from "../core/GroundTruthData";
import { loadShader } from "../core/ShaderLoader";
import { RenderPass } from "./RenderPass";

/**
 * Post-render temporal resolve pass. Blends current and history frames.
 */
export class TemporalResolvePass implements RenderPass {
  name = "temporal-resolve";
  dependencies: string[] = ["territory"];

  private pipeline: GPURenderPipeline | null = null;
  private bindGroupLayout: GPUBindGroupLayout | null = null;
  private bindGroup: GPUBindGroup | null = null;
  private device: GPUDevice | null = null;
  private resources: GroundTruthData | null = null;
  private canvasFormat: GPUTextureFormat | null = null;
  private paramsBuffer: GPUBuffer | null = null;
  private paramsData = new Float32Array(4);
  private enabled = false;
  private boundCurrentTexture: GPUTexture | null = null;
  private boundHistoryTexture: GPUTexture | null = null;

  async init(
    device: GPUDevice,
    resources: GroundTruthData,
    canvasFormat: GPUTextureFormat,
  ): Promise<void> {
    this.device = device;
    this.resources = resources;
    this.canvasFormat = canvasFormat;

    const GPUBufferUsage = (globalThis as any).GPUBufferUsage;
    const UNIFORM = GPUBufferUsage?.UNIFORM ?? 0x40;
    const COPY_DST = GPUBufferUsage?.COPY_DST ?? 0x8;
    this.paramsBuffer = device.createBuffer({
      size: 16,
      usage: UNIFORM | COPY_DST,
    });

    this.bindGroupLayout = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: 2 /* FRAGMENT */,
          buffer: { type: "uniform" },
        },
        {
          binding: 1,
          visibility: 2 /* FRAGMENT */,
          buffer: { type: "uniform" },
        },
        {
          binding: 2,
          visibility: 2 /* FRAGMENT */,
          texture: { sampleType: "float" },
        },
        {
          binding: 3,
          visibility: 2 /* FRAGMENT */,
          texture: { sampleType: "float" },
        },
      ],
    });

    await this.setShader("render/temporal-resolve.wgsl");
    this.rebuildBindGroup();
  }

  async setShader(shaderPath: string): Promise<void> {
    if (!this.device || !this.bindGroupLayout || !this.canvasFormat) {
      return;
    }

    const shaderCode = await loadShader(shaderPath);
    const shaderModule = this.device.createShaderModule({ code: shaderCode });

    this.pipeline = this.device.createRenderPipeline({
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [this.bindGroupLayout],
      }),
      vertex: { module: shaderModule, entryPoint: "vsMain" },
      fragment: {
        module: shaderModule,
        entryPoint: "fsMain",
        targets: [{ format: this.canvasFormat }, { format: this.canvasFormat }],
      },
      primitive: { topology: "triangle-list" },
    });
  }

  setParams(params0: Float32Array | number[]): void {
    this.paramsData[0] = Number(params0[0] ?? 0);
    this.paramsData[1] = Number(params0[1] ?? 1);
    this.paramsData[2] = Number(params0[2] ?? 0.08);
    this.paramsData[3] = 0;
    this.enabled = this.paramsData[0] > 0;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  needsUpdate(): boolean {
    return this.enabled;
  }

  execute(
    encoder: GPUCommandEncoder,
    resources: GroundTruthData,
    target: GPUTextureView,
  ): void {
    if (!this.device || !this.pipeline || !this.paramsBuffer) {
      return;
    }
    if (!this.enabled) {
      return;
    }

    const currentTexture = resources.getCurrentColorTexture();
    const historyRead = resources.getHistoryReadTexture();
    const historyWrite = resources.getHistoryWriteTexture();
    if (!currentTexture || !historyRead || !historyWrite) {
      return;
    }

    this.device.queue.writeBuffer(this.paramsBuffer, 0, this.paramsData);

    const shouldRebuild =
      !this.bindGroup ||
      this.boundCurrentTexture !== currentTexture ||
      this.boundHistoryTexture !== historyRead;
    if (shouldRebuild) {
      this.rebuildBindGroup();
    }

    if (!this.bindGroup) {
      return;
    }

    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: target,
          loadOp: "clear",
          storeOp: "store",
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
        },
        {
          view: historyWrite.createView(),
          loadOp: "clear",
          storeOp: "store",
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
        },
      ],
    });

    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.draw(3);
    pass.end();

    resources.swapHistoryTextures();
    resources.markHistoryValid();
  }

  rebuildBindGroup(): void {
    if (
      !this.device ||
      !this.bindGroupLayout ||
      !this.resources ||
      !this.resources.temporalUniformBuffer ||
      !this.paramsBuffer
    ) {
      return;
    }

    const currentTexture = this.resources.getCurrentColorTexture();
    const historyRead = this.resources.getHistoryReadTexture();
    if (!currentTexture || !historyRead) {
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
          resource: currentTexture.createView(),
        },
        {
          binding: 3,
          resource: historyRead.createView(),
        },
      ],
    });

    this.boundCurrentTexture = currentTexture;
    this.boundHistoryTexture = historyRead;
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
