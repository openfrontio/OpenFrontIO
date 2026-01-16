import { GroundTruthData } from "../core/GroundTruthData";
import { loadShader } from "../core/ShaderLoader";
import { RenderPass } from "./RenderPass";

/**
 * Main territory rendering pass.
 * Renders territory colors, defended tiles, fallout, and hover highlights.
 */
export class TerritoryRenderPass implements RenderPass {
  name = "territory";
  dependencies: string[] = [];

  private pipeline: GPURenderPipeline | null = null;
  private bindGroupLayout: GPUBindGroupLayout | null = null;
  private bindGroup: GPUBindGroup | null = null;
  private device: GPUDevice | null = null;
  private resources: GroundTruthData | null = null;
  private canvasFormat: GPUTextureFormat | null = null;
  private clearR = 0;
  private clearG = 0;
  private clearB = 0;

  async init(
    device: GPUDevice,
    resources: GroundTruthData,
    canvasFormat: GPUTextureFormat,
  ): Promise<void> {
    this.device = device;
    this.resources = resources;
    this.canvasFormat = canvasFormat;

    const shaderCode = await loadShader("render/territory.wgsl");
    const shaderModule = device.createShaderModule({ code: shaderCode });

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
          texture: { sampleType: "uint" },
        },
        {
          binding: 3,
          visibility: 2 /* FRAGMENT */,
          texture: { sampleType: "uint" },
        },
        {
          binding: 4,
          visibility: 2 /* FRAGMENT */,
          texture: { sampleType: "float" },
        },
        {
          binding: 5,
          visibility: 2 /* FRAGMENT */,
          texture: { sampleType: "float" },
        },
      ],
    });

    this.pipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({
        bindGroupLayouts: [this.bindGroupLayout],
      }),
      vertex: { module: shaderModule, entryPoint: "vsMain" },
      fragment: {
        module: shaderModule,
        entryPoint: "fsMain",
        targets: [{ format: canvasFormat }],
      },
      primitive: { topology: "triangle-list" },
    });

    this.rebuildBindGroup();

    // Extract clear color from theme
    const bg = resources.getTheme().backgroundColor().rgba;
    this.clearR = bg.r / 255;
    this.clearG = bg.g / 255;
    this.clearB = bg.b / 255;
  }

  needsUpdate(): boolean {
    // Always run every frame (can be optimized later if needed)
    return true;
  }

  execute(
    encoder: GPUCommandEncoder,
    resources: GroundTruthData,
    target: GPUTextureView,
  ): void {
    if (!this.device || !this.pipeline) {
      return;
    }

    // Rebuild bind group if needed (e.g., after texture recreation)
    this.rebuildBindGroup();

    if (!this.bindGroup) {
      return;
    }

    // Update uniforms
    resources.writeUniformBuffer(performance.now() / 1000);
    resources.writeDefenseParamsBuffer();

    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: target,
          loadOp: "clear",
          storeOp: "store",
          clearValue: {
            r: this.clearR,
            g: this.clearG,
            b: this.clearB,
            a: 1,
          },
        },
      ],
    });

    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.draw(3);
    pass.end();
  }

  rebuildBindGroup(): void {
    if (
      !this.device ||
      !this.bindGroupLayout ||
      !this.resources ||
      !this.resources.uniformBuffer ||
      !this.resources.defenseParamsBuffer ||
      !this.resources.stateTexture ||
      !this.resources.defendedTexture ||
      !this.resources.paletteTexture ||
      !this.resources.terrainTexture
    ) {
      return;
    }

    this.bindGroup = this.device.createBindGroup({
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.resources.uniformBuffer } },
        {
          binding: 1,
          resource: { buffer: this.resources.defenseParamsBuffer },
        },
        {
          binding: 2,
          resource: this.resources.stateTexture.createView(),
        },
        {
          binding: 3,
          resource: this.resources.defendedTexture.createView(),
        },
        {
          binding: 4,
          resource: this.resources.paletteTexture.createView(),
        },
        {
          binding: 5,
          resource: this.resources.terrainTexture.createView(),
        },
      ],
    });
  }

  dispose(): void {
    this.pipeline = null;
    this.bindGroupLayout = null;
    this.bindGroup = null;
    this.device = null;
    this.resources = null;
  }
}
