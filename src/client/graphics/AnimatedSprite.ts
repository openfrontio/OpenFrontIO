export class AnimatedSprite {
  private readonly frameHeight: number;
  private currentFrame = 0;
  private elapsedTime = 0;
  private active = true;

  constructor(
    private readonly image: CanvasImageSource,
    private readonly frameWidth: number,
    private readonly frameCount: number,
    private readonly frameDuration: number, // in milliseconds
    private readonly looping = false,
    private originX: number,
    private originY: number,
  ) {
    if ("height" in image) {
      this.frameHeight = (image as HTMLImageElement | HTMLCanvasElement).height;
    } else {
      throw new Error("Image source must have a 'height' property.");
    }
  }

  update(deltaTime: number) {
    if (!this.active) return;
    this.elapsedTime += deltaTime;
    if (this.elapsedTime >= this.frameDuration) {
      this.elapsedTime -= this.frameDuration;
      this.currentFrame++;

      if (this.currentFrame >= this.frameCount) {
        if (this.looping) {
          this.currentFrame = 0;
        } else {
          this.currentFrame = this.frameCount - 1;
          this.active = false;
        }
      }
    }
  }

  isActive(): boolean {
    return this.active;
  }

  lifeTime(): number | undefined {
    if (this.looping) {
      return undefined;
    }
    return this.frameDuration * this.frameCount;
  }

  draw(ctx: CanvasRenderingContext2D, x: number, y: number) {
    const drawX = x - this.originX;
    const drawY = y - this.originY;

    ctx.drawImage(
      this.image,
      this.currentFrame * this.frameWidth,
      0,
      this.frameWidth,
      this.frameHeight,
      drawX,
      drawY,
      this.frameWidth,
      this.frameHeight,
    );
  }

  reset() {
    this.currentFrame = 0;
    this.elapsedTime = 0;
  }

  setOrigin(xRatio: number, yRatio: number) {
    this.originX = xRatio;
    this.originY = yRatio;
  }
}
