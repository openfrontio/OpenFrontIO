import { AnimatedSprite } from "../AnimatedSprite";
import { createAnimatedSpriteForUnit } from "../AnimatedSpriteLoader";
import { Fx, FxType } from "./Fx";

/**
 * Explosion effect: sprite animation of an explosion
 */
export class SAMExplosionFx implements Fx {
  private lifeTime: number = 0;
  private explosionSprite: AnimatedSprite | null;
  constructor(
    private x: number,
    private y: number,
    private duration: number,
  ) {
    this.explosionSprite = createAnimatedSpriteForUnit(FxType.SAMExplosion);
  }

  renderTick(frameTime: number, ctx: CanvasRenderingContext2D): boolean {
    if (this.explosionSprite) {
      this.lifeTime += frameTime;
      if (this.lifeTime >= this.duration) {
        return false;
      }
      if (this.explosionSprite.isActive()) {
        this.explosionSprite.update(frameTime);
        this.explosionSprite.draw(ctx, this.x, this.y);
        return true;
      }
      return false;
    }
    return false;
  }
}
