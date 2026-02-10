import { GroundTruthData } from "../core/GroundTruthData";

/**
 * Base interface for compute passes.
 * Compute passes run during tick() (simulation rate) to update ground truth data.
 */
export interface ComputePass {
  /** Unique name of this pass (used for dependency resolution) */
  name: string;

  /** Names of passes that must run before this one */
  dependencies: string[];

  /**
   * Initialize the pass with device and resources.
   * Called once during renderer initialization.
   */
  init(device: GPUDevice, resources: GroundTruthData): Promise<void>;

  /**
   * Check if this pass needs to run this tick.
   * Performance optimization: return false to skip execution.
   */
  needsUpdate(): boolean;

  /**
   * Execute the compute pass.
   * @param encoder Command encoder for recording GPU commands
   * @param resources Ground truth data (read/write access)
   */
  execute(encoder: GPUCommandEncoder, resources: GroundTruthData): void;

  /**
   * Clean up resources when the pass is no longer needed.
   */
  dispose(): void;
}
