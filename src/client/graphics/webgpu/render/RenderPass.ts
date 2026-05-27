import { GroundTruthData } from "../core/GroundTruthData";

/**
 * Base interface for render passes.
 * Render passes run during render() (frame rate) to draw to the canvas.
 */
export interface RenderPass {
  /** Unique name of this pass (used for dependency resolution) */
  name: string;

  /** Names of render passes that must run before this one */
  dependencies: string[];

  /**
   * Initialize the pass with device, resources, and canvas format.
   * Called once during renderer initialization.
   */
  init(
    device: GPUDevice,
    resources: GroundTruthData,
    canvasFormat: GPUTextureFormat,
  ): Promise<void>;

  /**
   * Check if this pass needs to run this frame.
   * Performance optimization: return false to skip execution.
   */
  needsUpdate(): boolean;

  /**
   * Execute the render pass.
   * @param encoder Command encoder for recording GPU commands
   * @param resources Ground truth data (read-only access)
   * @param target Target texture view to render to
   */
  execute(
    encoder: GPUCommandEncoder,
    resources: GroundTruthData,
    target: GPUTextureView,
  ): void;

  /**
   * Clean up resources when the pass is no longer needed.
   */
  dispose(): void;
}
