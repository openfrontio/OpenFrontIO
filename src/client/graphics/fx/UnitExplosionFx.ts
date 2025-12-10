import { GameView } from "../../../core/game/GameView";
import { AnimatedSpriteLoader } from "../AnimatedSpriteLoader";
import { Fx, FxType } from "./Fx";
import { SpriteFx } from "./SpriteFx";
import { Timeline } from "./Timeline";

/**
 * Explosion Effect: a few timed explosions
 */
export class UnitExplosionFx implements Fx {
  private timeline = new Timeline();
  private explosions: Fx[] = [];

  constructor(
    animatedSpriteLoader: AnimatedSpriteLoader,
    private x: number,
    private y: number,
    game: GameView,
  ) {
    const config: { dx: number; dy: number; delay: number; type: FxType }[] = [
      { dx: 0, dy: 0, delay: 0, type: "UnitExplosion" },
      { dx: 4, dy: -6, delay: 80, type: "UnitExplosion" },
      { dx: -6, dy: 4, delay: 160, type: "UnitExplosion" },
    ];
    for (const { dx, dy, delay, type } of config) {
      this.timeline.add(delay, () => {
        if (game.isValidCoord(x + dx, y + dy)) {
          this.explosions.push(
            new SpriteFx(animatedSpriteLoader, x + dx, y + dy, type),
          );
        }
      });
    }
  }

  renderTick(frameTime: number, ctx: CanvasRenderingContext2D): boolean {
    this.timeline.update(frameTime);
    let allDone = true;
    for (const fx of this.explosions) {
      if (fx.renderTick(frameTime, ctx)) {
        allDone = false;
      }
    }

    return !allDone || !this.timeline.isComplete();
  }
}
