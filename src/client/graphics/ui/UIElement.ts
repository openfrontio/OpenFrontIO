export abstract class UIElement {
  protected ended = false;
  protected lifeTime = 0;
  constructor(
    protected x: number,
    protected y: number,
  ) {}

  end() {
    if (!this.ended) {
      this.ended = true;
    }
  }

  abstract render(ctx: CanvasRenderingContext2D, delta: number): boolean;
}
