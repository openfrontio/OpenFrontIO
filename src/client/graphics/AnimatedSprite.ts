export class AnimatedSprite {
  private image: CanvasImageSource;
  private frameWidth: number;
  private frameHeight: number;
  private frameCount: number;
  private currentFrame: number = 0;
  private elapsedTime: number = 0;
  private frameDuration: number;
  private looping: boolean;

  // Origin as ratio: 0 = left/top, 0.5 = center, 1 = right/bottom
  private originX: number;
  private originY: number;
  private alive: boolean = true;

  constructor(
    image: CanvasImageSource,
    frameWidth: number,
    frameCount: number,
    frameDuration: number, // in milliseconds
    looping: boolean = true,
    originX: number,
    originY: number,
  ) {
    this.image = image;
    this.frameWidth = frameWidth;
    this.frameCount = frameCount;
    this.frameDuration = frameDuration;
    this.looping = looping;
    this.originX = originX;
    this.originY = originY;

    if ("height" in image) {
      this.frameHeight = (image as HTMLImageElement | HTMLCanvasElement).height;
    } else {
      throw new Error("Image source must have a 'height' property.");
    }
  }

  update(deltaTime: number) {
    if (!this.alive) return;
    this.elapsedTime += deltaTime;
    if (this.elapsedTime >= this.frameDuration) {
      this.elapsedTime -= this.frameDuration;
      this.currentFrame++;

      if (this.currentFrame >= this.frameCount) {
        if (this.looping) {
          this.currentFrame = 0;
        } else {
          this.currentFrame = this.frameCount - 1;
          this.alive = false;
        }
      }
    }
  }

  isAlive(): boolean {
    return this.alive;
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
