export interface AnimatedSpriteConfig {
  name: string;
  frameCount: number;
  frameDuration: number; // ms per frame
  looping: boolean;
  originX: number;
  originY: number;
}
export class AnimatedSprite {
  private frameHeight: number;
  private frameWidth: number;
  private currentFrame: number = 0;
  private elapsedTime: number = 0;
  private active: boolean = true;

  constructor(
    private image: HTMLCanvasElement,
    private config: AnimatedSpriteConfig,
  ) {
    if (config.frameCount <= 0) {
      throw new Error("Animated sprite should at least have one frame");
    }
    if ("height" in image && "width" in image) {
      this.frameHeight = (image as HTMLImageElement | HTMLCanvasElement).height;
      this.frameWidth = Math.floor(
        (image as HTMLImageElement | HTMLCanvasElement).width /
          config.frameCount,
      );
    } else {
      throw new Error(
        "Image source must have 'width' and 'height' properties.",
      );
    }
  }

  update(deltaTime: number) {
    if (!this.active) return;
    this.elapsedTime += deltaTime;
    if (this.elapsedTime >= this.config.frameDuration) {
      this.elapsedTime -= this.config.frameDuration;
      this.currentFrame++;

      if (this.currentFrame >= this.config.frameCount) {
        if (this.config.looping) {
          this.currentFrame = 0;
        } else {
          this.currentFrame = this.config.frameCount - 1;
          this.active = false;
        }
      }
    }
  }

  isActive(): boolean {
    return this.active;
  }

  lifeTime(): number | undefined {
    if (this.config.looping) {
      return undefined;
    }
    return this.config.frameDuration * this.config.frameCount;
  }

  draw(ctx: CanvasRenderingContext2D, x: number, y: number) {
    const drawX = x - this.config.originX;
    const drawY = y - this.config.originY;

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
    this.config.originX = xRatio;
    this.config.originY = yRatio;
  }
}
