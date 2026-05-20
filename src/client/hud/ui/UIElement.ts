export interface UIElement {
  x: number;
  y: number;
  render(ctx: CanvasRenderingContext2D, delta: number): boolean;
}
