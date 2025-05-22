import { UnitType } from "../../../core/game/Game";
import { GameUpdateType } from "../../../core/game/GameUpdates";
import { GameView, UnitView } from "../../../core/game/GameView";
import { loadAllAnimatedSpriteImages } from "../AnimatedSpriteLoader";
import { Fx } from "../fx/Fx";
import { NukeExplosionFx, ShockwaveFx } from "../fx/NukeFx";
import { SAMExplosionFx } from "../fx/SAMExplosionFx";
import { Layer } from "./Layer";

export class FxLayer implements Layer {
  private canvas: HTMLCanvasElement;
  private context: CanvasRenderingContext2D;

  private lastRefresh: number = 0;
  private refreshRate: number = 10;

  private allFx: Fx[] = [];

  constructor(private game: GameView) {}

  shouldTransform(): boolean {
    return true;
  }

  tick() {
    this.game
      .updatesSinceLastTick()
      ?.[GameUpdateType.Unit]?.map((unit) => this.game.unit(unit.id))
      ?.forEach((unitView) => {
        if (unitView === undefined) return;
        this.onUnitEvent(unitView);
      });
  }

  onUnitEvent(unit: UnitView) {
    switch (unit.type()) {
      case UnitType.AtomBomb:
      case UnitType.MIRVWarhead:
        this.handleNukes(unit, 70);
        break;
      case UnitType.HydrogenBomb:
        this.handleNukes(unit, 250);
        break;
    }
  }

  handleNukes(unit: UnitView, shockwaveRadius: number) {
    if (!unit.isActive()) {
      if (unit.wasInterceptedBySAM()) {
        this.handleSAMInterception(unit);
      } else {
        // Kaboom
        this.handleNukeExplosion(unit, shockwaveRadius);
      }
    }
  }

  handleNukeExplosion(unit: UnitView, shockwaveRadius: number) {
    const x = this.game.x(unit.lastTile());
    const y = this.game.y(unit.lastTile());
    const nuke = new NukeExplosionFx(x, y, 1000);
    this.allFx.push(nuke as Fx);
    const shockwave = new ShockwaveFx(x, y, 1500, shockwaveRadius);
    this.allFx.push(shockwave as Fx);
  }

  handleSAMInterception(unit: UnitView) {
    const x = this.game.x(unit.lastTile());
    const y = this.game.y(unit.lastTile());
    const interception = new SAMExplosionFx(x, y, 1000);
    this.allFx.push(interception as Fx);
    const shockwave = new ShockwaveFx(x, y, 800, 40);
    this.allFx.push(shockwave as Fx);
  }

  async init() {
    this.redraw();
    try {
      await loadAllAnimatedSpriteImages();
      console.log("FX sprites loaded successfully");
    } catch (err) {
      console.error("Failed to load FX sprites:", err);
    }
  }

  redraw(): void {
    this.canvas = document.createElement("canvas");
    const context = this.canvas.getContext("2d");
    if (context === null) throw new Error("2d context not supported");
    this.context = context;
    this.context.imageSmoothingEnabled = false;
    this.canvas.width = this.game.width();
    this.canvas.height = this.game.height();
  }

  renderLayer(context: CanvasRenderingContext2D) {
    const now = Date.now();
    if (this.game.config().userSettings()?.fxLayer()) {
      if (now > this.lastRefresh + this.refreshRate) {
        const delta = now - this.lastRefresh;
        this.renderAllFx(context, delta);
        this.lastRefresh = now;
      }
      context.drawImage(
        this.canvas,
        -this.game.width() / 2,
        -this.game.height() / 2,
        this.game.width(),
        this.game.height(),
      );
    }
  }

  renderAllFx(context: CanvasRenderingContext2D, delta: number) {
    if (this.allFx.length > 0) {
      this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.renderContextFx(delta);
    }
  }

  renderContextFx(duration: number) {
    for (let i = this.allFx.length - 1; i >= 0; i--) {
      if (!this.allFx[i].renderTick(duration, this.context)) {
        this.allFx.splice(i, 1);
      }
    }
  }
}
