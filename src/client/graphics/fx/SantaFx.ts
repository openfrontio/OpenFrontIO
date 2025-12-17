import { Theme } from "../../../core/configuration/Config";
import { PlayerView } from "../../../core/game/GameView";
import { AnimatedSpriteLoader } from "../AnimatedSpriteLoader";
import { Fx, FxType } from "./Fx";
import { SpriteFx } from "./SpriteFx";

export class SantaFx implements Fx {
  private spriteFx: SpriteFx;
  private speed: number = 0.05; // px / ms

  constructor(
    animatedSpriteLoader: AnimatedSpriteLoader,
    private startX: number,
    private startY: number,
    private endX: number,
    owner?: PlayerView,
    theme?: Theme,
  ) {
    const distance = Math.abs(endX - startX);
    const duration = Math.max(distance / this.speed, 1);

    this.spriteFx = new SpriteFx(
      animatedSpriteLoader,
      startX,
      startY,
      FxType.Santa,
      duration,
      owner,
      theme,
    );
  }

  renderTick(frameTime: number, ctx: CanvasRenderingContext2D): boolean {
    const elapsed = this.spriteFx.getElapsedTime();
    const duration = this.spriteFx.getDuration();

    const t = elapsed / duration;
    if (t >= 1) return false;

    const x = this.startX + Math.floor((this.endX - this.startX) * t);
    const y = this.startY;
    this.spriteFx.setPosition(x, y);

    return this.spriteFx.renderTick(frameTime, ctx);
  }
}
