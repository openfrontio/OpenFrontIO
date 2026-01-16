/**
 * Manages WebGPU device initialization and canvas context configuration.
 */

export class WebGPUDevice {
  public readonly device: GPUDevice;
  public readonly context: GPUCanvasContext;
  public readonly canvasFormat: GPUTextureFormat;

  private constructor(
    device: GPUDevice,
    context: GPUCanvasContext,
    canvasFormat: GPUTextureFormat,
  ) {
    this.device = device;
    this.context = context;
    this.canvasFormat = canvasFormat;
  }

  /**
   * Initialize WebGPU device and canvas context.
   * @param canvas Canvas element to configure
   * @returns WebGPUDevice instance or null if WebGPU is not available
   */
  static async create(canvas: HTMLCanvasElement): Promise<WebGPUDevice | null> {
    const nav = globalThis.navigator as any;
    if (!nav?.gpu || typeof nav.gpu.requestAdapter !== "function") {
      return null;
    }

    const adapter = await nav.gpu.requestAdapter();
    if (!adapter) {
      return null;
    }

    const device = await adapter.requestDevice();
    const context = canvas.getContext("webgpu");
    if (!context) {
      return null;
    }

    const canvasFormat =
      typeof nav.gpu.getPreferredCanvasFormat === "function"
        ? nav.gpu.getPreferredCanvasFormat()
        : "bgra8unorm";

    context.configure({
      device,
      format: canvasFormat,
      alphaMode: "opaque",
    });

    return new WebGPUDevice(device, context, canvasFormat);
  }

  /**
   * Reconfigure the canvas context (e.g., when canvas size changes).
   */
  reconfigure(): void {
    this.context.configure({
      device: this.device,
      format: this.canvasFormat,
      alphaMode: "opaque",
    });
  }
}
