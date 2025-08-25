export type Layer = {
  init?: () => void;
  tick?: () => void | Promise<void>;
  renderLayer?: (context: CanvasRenderingContext2D) => void;
  shouldTransform?: () => boolean;
  redraw?: () => void;
};
