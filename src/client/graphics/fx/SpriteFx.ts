import { consolex } from "../../../core/Consolex";
import { AnimatedSprite } from "../AnimatedSprite";
import { createAnimatedSpriteForUnit } from "../AnimatedSpriteLoader";
import { Fx, FxType } from "./Fx";

function fadeInOut(
  t: number,
  fadeIn: number = 0.3,
  fadeOut: number = 0.7,
): number {
  if (t < fadeIn) {
    const f = t / fadeIn; // Map to [0, 1]
    return f * f;
  } else if (t < fadeOut) {
    return 1;
  } else {
    const f = (t - fadeOut) / (1 - fadeOut); // Map to [0, 1]
    return 1 - f * f;
  }
}

/**
 * A simple FX displaying an animated sprite
 */
export class SpriteFX implements Fx {
  private lifeTime: number = 0;
  private animatedSprite: AnimatedSprite | null;
  private totalLifeTime: number = 0;
  constructor(
    private x: number,
    private y: number,
    fxType: FxType,
    duration?: number,
    private fadeIn?: number,
    private fadeOut?: number,
  ) {
    this.animatedSprite = createAnimatedSpriteForUnit(fxType);
    if (!this.animatedSprite) {
      consolex.error("Could not load animated sprite ", fxType);
      this.totalLifeTime = 0;
    } else if (!duration) {
      // When no duration set, rely on the sprite lifetime
      this.totalLifeTime = this.animatedSprite.lifeTime() ?? 1000; // 1s by default
    } else {
      this.totalLifeTime = duration;
    }
  }

  renderTick(frameTime: number, ctx: CanvasRenderingContext2D): boolean {
    if (this.animatedSprite) {
      this.lifeTime += frameTime;
      if (this.lifeTime >= this.totalLifeTime) {
        return false;
      }
      if (this.animatedSprite.isActive()) {
        ctx.save();
        const t = this.lifeTime / this.totalLifeTime;
        ctx.globalAlpha = fadeInOut(t, this.fadeIn ?? 0, this.fadeOut ?? 0.7);
        this.animatedSprite.update(frameTime);
        this.animatedSprite.draw(ctx, this.x, this.y);
        ctx.restore();
        return true;
      }
      return false;
    }
    return false;
  }
}
