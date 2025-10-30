import { Theme } from "../../../core/configuration/Config";
import { PlayerView } from "../../../core/game/GameView";
import { AnimatedSprite } from "../AnimatedSprite";
import { AnimatedSpriteLoader } from "../AnimatedSpriteLoader";
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
 * Move a sprite around
 */
export class MoveSpriteFx implements Fx {
  private originX: number;
  private originY: number;
  constructor(
    private fxToMove: SpriteFx,
    private toX: number,
    private toY: number,
    private fadeIn: number = 0.1,
    private fadeOut: number = 0.9,
  ) {
    this.originX = fxToMove.x;
    this.originY = fxToMove.y;
  }

  renderTick(duration: number, ctx: CanvasRenderingContext2D): boolean {
    const t = this.fxToMove.getElapsedTime() / this.fxToMove.getDuration();
    this.fxToMove.x = Math.floor(this.originX * (1 - t) + this.toX * t);
    this.fxToMove.y = Math.floor(this.originY * (1 - t) + this.toY * t);
    ctx.save();
    ctx.globalAlpha = fadeInOut(t, this.fadeIn, this.fadeOut);
    const result = this.fxToMove.renderTick(duration, ctx);
    ctx.restore();
    return result;
  }
}

/**
 * Fade in/out another FX
 */
export class FadeFx implements Fx {
  constructor(
    private fxToFade: SpriteFx,
    private fadeIn: number,
    private fadeOut: number,
  ) {}

  renderTick(duration: number, ctx: CanvasRenderingContext2D): boolean {
    const t = this.fxToFade.getElapsedTime() / this.fxToFade.getDuration();
    ctx.save();
    ctx.globalAlpha = fadeInOut(t, this.fadeIn, this.fadeOut);
    const result = this.fxToFade.renderTick(duration, ctx);
    ctx.restore();
    return result;
  }
}

/**
 * Animated sprite. Can be colored if provided an owner/theme
 */
export class SpriteFx implements Fx {
  protected animatedSprite: AnimatedSprite | null;
  protected elapsedTime = 0;
  protected duration: number;
  protected waitToTheEnd = false;
  constructor(
    animatedSpriteLoader: AnimatedSpriteLoader,
    public x: number,
    public y: number,
    fxType: FxType,
    duration?: number,
    owner?: PlayerView,
    theme?: Theme,
  ) {
    this.animatedSprite = animatedSpriteLoader.createAnimatedSprite(
      fxType,
      owner,
      theme,
    );
    if (!this.animatedSprite) {
      console.error("Could not load animated sprite", fxType);
    } else {
      this.waitToTheEnd = duration ? true : false;
      this.duration = duration ?? this.animatedSprite.lifeTime() ?? 1000;
    }
  }

  renderTick(frameTime: number, ctx: CanvasRenderingContext2D): boolean {
    if (!this.animatedSprite) return false;

    this.elapsedTime += frameTime;
    if (this.elapsedTime >= this.duration) return false;

    if (!this.animatedSprite.isActive() && !this.waitToTheEnd) return false;

    this.animatedSprite.update(frameTime);
    this.animatedSprite.draw(ctx, this.x, this.y);
    return true;
  }

  getElapsedTime(): number {
    return this.elapsedTime;
  }

  getDuration(): number {
    return this.duration;
  }
}
