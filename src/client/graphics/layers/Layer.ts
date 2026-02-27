export interface Layer {
  init?: () => void;
  tick?: () => void;
  // Optional hint to throttle expensive ticks by wall-clock.
  // If omitted or <= 0, the layer ticks whenever GameRenderer ticks.
  getTickIntervalMs?: () => number;
  getPerfCounters?: () => Record<string, number>;
  renderLayer?: (context: CanvasRenderingContext2D) => void;
  shouldTransform?: () => boolean;
  redraw?: () => void;
}
