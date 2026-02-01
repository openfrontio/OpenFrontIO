export interface Layer {
  init?: () => void;
  tick?: () => void;
  // Optional hint to throttle expensive ticks by wall-clock.
  // If omitted or <= 0, the layer ticks whenever GameRenderer ticks.
  getTickIntervalMs?: () => number;
  renderLayer?: (context: CanvasRenderingContext2D) => void;
  shouldTransform?: () => boolean;
  redraw?: () => void;
  // Clean up resources when the layer is no longer needed.
  // This should remove any DOM elements added during init() and release event listeners.
  dispose?: () => void;
}
