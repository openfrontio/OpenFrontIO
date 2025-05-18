import { AnimatedSprite } from "../AnimatedSprite";
import { createAnimatedSpriteForUnit } from "../AnimatedSpriteLoader";
import { Fx, FxType } from "./Fx";

/**
 * Shockwave effect: draw a growing 1px white circle
 */
export class ShockwaveFx implements Fx {
  private lifeTime: number = 0;
  constructor(
    private x: number,
    private y: number,
    private duration: number,
    private maxRadius: number,
  ) {}

  renderTick(frameTime: number, ctx: CanvasRenderingContext2D): boolean {
    this.lifeTime += frameTime;
    if (this.lifeTime >= this.duration) {
      return false;
    }
    const t = this.lifeTime / this.duration;
    const radius = t * this.maxRadius;
    ctx.beginPath();
    ctx.arc(this.x, this.y, radius, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255, 255, 255, " + (1 - t) + ")";
    ctx.lineWidth = 0.5;
    ctx.stroke();
    return true;
  }
}

/**
 * Explosion effect: sprite animation of an explosion
 */
export class NukeExplosionFx implements Fx {
  private lifeTime: number = 0;
  private nukeExplosionSprite: AnimatedSprite | null;
  constructor(
    private x: number,
    private y: number,
    private duration: number,
  ) {
    this.nukeExplosionSprite = createAnimatedSpriteForUnit(FxType.Nuke);
  }

  renderTick(frameTime: number, ctx: CanvasRenderingContext2D): boolean {
    if (this.nukeExplosionSprite) {
      this.lifeTime += frameTime;
      if (this.lifeTime >= this.duration) {
        return false;
      }
      if (this.nukeExplosionSprite.isActive()) {
        this.nukeExplosionSprite.update(frameTime);
        this.nukeExplosionSprite.draw(ctx, this.x, this.y);
        return true;
      }
      return false;
    }
    return false;
  }
}
