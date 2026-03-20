import { GameView, UnitView } from "../../../core/game/GameView";
import { Fx } from "./Fx";

class SmokeParticle {
  public life: number = 0;
  public maxLife: number;
  public x: number;
  public y: number;
  public vx: number;
  public vy: number;
  public size: number;
  public maxSize: number;
  public opacity: number;
  public color: string;

  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
    // Longer life for "puffy" trails
    this.maxLife = 1500 + Math.random() * 1000;

    // Slow drift
    this.vx = (Math.random() - 0.5) * 0.02;
    this.vy = (Math.random() - 0.5) * 0.02;

    // Start small, grow BIG
    this.size = 1 + Math.random() * 1;
    this.maxSize = 6 + Math.random() * 6;

    // Bolder opacity
    this.opacity = 0.6 + Math.random() * 0.3;

    // Varying shades of gray/white
    const gray = Math.floor(180 + Math.random() * 75);
    this.color = `rgba(${gray}, ${gray}, ${gray},`;
  }

  update(delta: number): boolean {
    this.life += delta;
    if (this.life >= this.maxLife) return false;

    const t = this.life / this.maxLife;
    this.x += this.vx * delta;
    this.y += this.vy * delta;

    // Grow significantly over time
    this.size = 1 + t * (this.maxSize - 1);

    return true;
  }

  draw(ctx: CanvasRenderingContext2D) {
    const t = this.life / this.maxLife;
    // Fade out towards the end
    const currentOpacity = this.opacity * (1 - t * t);

    ctx.beginPath();
    ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
    ctx.fillStyle = `${this.color} ${currentOpacity})`;
    ctx.fill();
  }
}

export class SmokeTrailFx implements Fx {
  private particles: SmokeParticle[] = [];
  private lastEmitTime: number = 0;
  private emitInterval: number = 15; // Faster emission for denser trail

  constructor(
    private game: GameView,
    private unitId: number,
  ) {}

  renderTick(duration: number, ctx: CanvasRenderingContext2D): boolean {
    const unit = this.game.unit(this.unitId);
    const isActive = unit?.isActive() ?? false;

    if (isActive) {
      this.lastEmitTime += duration;
      while (this.lastEmitTime >= this.emitInterval) {
        this.emit(unit!);
        this.lastEmitTime -= this.emitInterval;
      }
    }

    // Update and render particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      if (!this.particles[i].update(duration)) {
        this.particles.splice(i, 1);
      } else {
        this.particles[i].draw(ctx);
      }
    }

    return isActive || this.particles.length > 0;
  }

  private emit(unit: UnitView) {
    // Add some randomness to spawn position so it's not a perfect line
    const offsetX = (Math.random() - 0.5) * 2;
    const offsetY = (Math.random() - 0.5) * 2;
    this.particles.push(
      new SmokeParticle(
        this.game.x(unit.tile()) + offsetX,
        this.game.y(unit.tile()) + offsetY,
      ),
    );
  }
}
