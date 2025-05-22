import { GameView } from "../../../core/game/GameView";
import { Fx, FxType } from "./Fx";
import { SpriteFX } from "./SpriteFx";

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
 * Spawn @p number of @p type animation within a perimeter
 */
function addSpriteInCircle(
  x: number,
  y: number,
  radius: number,
  num: number,
  type: FxType,
  result: Fx[],
  game: GameView,
) {
  for (let i = 0; i < num; i++) {
    const angle = Math.random() * 2 * Math.PI;
    const distance = Math.random() * (radius / 2);
    const spawnX = Math.floor(x + Math.cos(angle) * distance);
    const spawnY = Math.floor(y + Math.sin(angle) * distance);
    if (
      game.isValidCoord(spawnX, spawnY) &&
      game.isLand(game.ref(spawnX, spawnY))
    ) {
      const sprite = new SpriteFX(spawnX, spawnY, type, 6000, 0.1, 0.8);
      result.push(sprite as Fx);
    }
  }
}

/**
 * Explosion effect:
 * - explosion animation
 * - shockwave
 * - ruins and desolation fx
 */
export function nukeFxFactory(
  x: number,
  y: number,
  radius: number,
  game: GameView,
): Fx[] {
  const nukeFx: Fx[] = [];
  // Explosion animation
  nukeFx.push(new SpriteFX(x, y, FxType.Nuke) as Fx);
  // Shockwave animation
  nukeFx.push(new ShockwaveFx(x, y, 1500, radius * 1.5));
  // Ruins and desolation sprites
  // Arbitrary values that feels better
  addSpriteInCircle(x, y, radius, radius / 25, FxType.MiniFire, nukeFx, game);
  addSpriteInCircle(x, y, radius, radius / 28, FxType.MiniSmoke, nukeFx, game);
  addSpriteInCircle(
    x,
    y,
    radius * 0.9,
    radius / 70,
    FxType.MiniBigSmoke,
    nukeFx,
    game,
  );
  addSpriteInCircle(
    x,
    y,
    radius * 0.9,
    radius / 70,
    FxType.MiniSmokeAndFire,
    nukeFx,
    game,
  );
  return nukeFx;
}
