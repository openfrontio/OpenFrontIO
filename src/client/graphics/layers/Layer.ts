export interface Layer {
  /**
   * Stable display name for profiling/overlays. Avoid relying on
   * `constructor.name` since production builds may minify it.
   */
  profileName?: string;
  init?: () => void;
  tick?: () => void;
  // Optional hint to throttle expensive ticks by wall-clock.
  // If omitted or <= 0, the layer ticks whenever GameRenderer ticks.
  getTickIntervalMs?: () => number;
  renderLayer?: (context: CanvasRenderingContext2D) => void;
  shouldTransform?: () => boolean;
  redraw?: () => void;
}
