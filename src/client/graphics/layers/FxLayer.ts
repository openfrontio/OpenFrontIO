import { Theme } from "../../../core/configuration/Config";
import { EventBus } from "../../../core/EventBus";
import { UnitType } from "../../../core/game/Game";
import { TileRef } from "../../../core/game/GameMap";
import { ConquestUpdate, GameUpdateType } from "../../../core/game/GameUpdates";
import { GameView, UnitView } from "../../../core/game/GameView";
import SoundManager, { SoundEffect } from "../../sound/SoundManager";
import { AnimatedSpriteLoader } from "../AnimatedSpriteLoader";
import { conquestFxFactory } from "../fx/ConquestFx";
import { Fx, FxType } from "../fx/Fx";
import { nukeFxFactory, ShockwaveFx } from "../fx/NukeFx";
import { SpriteFx } from "../fx/SpriteFx";
import { UnitExplosionFx } from "../fx/UnitExplosionFx";
import { TransformHandler } from "../TransformHandler";
import { Layer } from "./Layer";
import { RailTileChangedEvent } from "./RailroadLayer";
export class FxLayer implements Layer {
  private lastRefreshMs: number = 0;
  private refreshRate: number = 10;
  private theme: Theme;
  private animatedSpriteLoader: AnimatedSpriteLoader =
    new AnimatedSpriteLoader();

  private allFx: Fx[] = [];

  constructor(
    private game: GameView,
    private eventBus: EventBus,
    private transformHandler: TransformHandler,
  ) {
    this.theme = this.game.config().theme();
  }

  shouldTransform(): boolean {
    return true;
  }

  tick() {
    if (!this.game.config().userSettings()?.fxLayer()) {
      return;
    }
    this.game
      .updatesSinceLastTick()
      ?.[GameUpdateType.Unit]?.map((unit) => this.game.unit(unit.id))
      ?.forEach((unitView) => {
        if (unitView === undefined) return;
        this.onUnitEvent(unitView);
      });
    this.game
      .updatesSinceLastTick()
      ?.[GameUpdateType.ConquestEvent]?.forEach((update) => {
        if (update === undefined) return;
        this.onConquestEvent(update);
      });
  }

  onUnitEvent(unit: UnitView) {
    switch (unit.type()) {
      case UnitType.AtomBomb: {
        this.onNukeEvent(unit, 70);
        break;
      }
      case UnitType.MIRVWarhead:
        this.onNukeEvent(unit, 70);
        break;
      case UnitType.HydrogenBomb: {
        this.onNukeEvent(unit, 160);
        break;
      }
      case UnitType.Warship:
        this.onWarshipEvent(unit);
        break;
      case UnitType.Shell:
        this.onShellEvent(unit);
        break;
      case UnitType.Train:
        this.onTrainEvent(unit);
        break;
      case UnitType.DefensePost:
      case UnitType.City:
      case UnitType.Port:
      case UnitType.MissileSilo:
      case UnitType.SAMLauncher:
      case UnitType.Factory:
        this.onStructureEvent(unit);
        break;
    }
  }

  onShellEvent(unit: UnitView) {
    if (!unit.isActive()) {
      if (unit.reachedTarget()) {
        const x = this.game.x(unit.lastTile());
        const y = this.game.y(unit.lastTile());
        const explosion = new SpriteFx(
          this.animatedSpriteLoader,
          x,
          y,
          FxType.MiniExplosion,
        );
        this.allFx.push(explosion);
      }
    }
  }

  onTrainEvent(unit: UnitView) {
    if (!unit.isActive()) {
      if (!unit.reachedTarget()) {
        const x = this.game.x(unit.lastTile());
        const y = this.game.y(unit.lastTile());
        const explosion = new SpriteFx(
          this.animatedSpriteLoader,
          x,
          y,
          FxType.MiniExplosion,
        );
        this.allFx.push(explosion);
      }
    }
  }

  onRailroadEvent(tile: TileRef) {
    // No need for pseudorandom, this is fx
    const chanceFx = Math.floor(Math.random() * 3);
    if (chanceFx === 0) {
      const x = this.game.x(tile);
      const y = this.game.y(tile);
      const animation = new SpriteFx(
        this.animatedSpriteLoader,
        x,
        y,
        FxType.Dust,
      );
      this.allFx.push(animation);
    }
  }

  onConquestEvent(conquest: ConquestUpdate) {
    // Only display fx for the current player
    const conqueror = this.game.player(conquest.conquerorId);
    if (conqueror !== this.game.myPlayer()) {
      return;
    }

    SoundManager.playSoundEffect(SoundEffect.KaChing);

    this.allFx.push(
      conquestFxFactory(this.animatedSpriteLoader, conquest, this.game),
    );
  }

  onWarshipEvent(unit: UnitView) {
    if (!unit.isActive()) {
      const x = this.game.x(unit.lastTile());
      const y = this.game.y(unit.lastTile());
      const shipExplosion = new UnitExplosionFx(
        this.animatedSpriteLoader,
        x,
        y,
        this.game,
      );
      this.allFx.push(shipExplosion);
      const sinkingShip = new SpriteFx(
        this.animatedSpriteLoader,
        x,
        y,
        FxType.SinkingShip,
        undefined,
        unit.owner(),
        this.theme,
      );
      this.allFx.push(sinkingShip);
    }
  }

  onStructureEvent(unit: UnitView) {
    if (!unit.isActive()) {
      const x = this.game.x(unit.lastTile());
      const y = this.game.y(unit.lastTile());
      const explosion = new SpriteFx(
        this.animatedSpriteLoader,
        x,
        y,
        FxType.BuildingExplosion,
      );
      this.allFx.push(explosion);
    }
  }

  onNukeEvent(unit: UnitView, radius: number) {
    if (!unit.isActive()) {
      if (!unit.reachedTarget()) {
        this.handleSAMInterception(unit);
      } else {
        // Kaboom
        this.handleNukeExplosion(unit, radius);
      }
    }
  }

  handleNukeExplosion(unit: UnitView, radius: number) {
    const x = this.game.x(unit.lastTile());
    const y = this.game.y(unit.lastTile());
    const nukeFx = nukeFxFactory(
      this.animatedSpriteLoader,
      x,
      y,
      radius,
      this.game,
    );
    this.allFx = this.allFx.concat(nukeFx);
  }

  handleSAMInterception(unit: UnitView) {
    const x = this.game.x(unit.lastTile());
    const y = this.game.y(unit.lastTile());
    const explosion = new SpriteFx(
      this.animatedSpriteLoader,
      x,
      y,
      FxType.SAMExplosion,
    );
    this.allFx.push(explosion);
    const shockwave = new ShockwaveFx(x, y, 800, 40);
    this.allFx.push(shockwave);
  }

  async init() {
    this.redraw();

    this.eventBus.on(RailTileChangedEvent, (e) => {
      this.onRailroadEvent(e.tile);
    });
    try {
      this.animatedSpriteLoader.loadAllAnimatedSpriteImages();
      console.log("FX sprites loaded successfully");
    } catch (err) {
      console.error("Failed to load FX sprites:", err);
    }
  }

  redraw(): void {
    // Redraw is no longer needed since we are using immediate mode rendering
  }

  renderLayer(context: CanvasRenderingContext2D) {
    const nowMs = performance.now();

    const hasFx = this.allFx.length > 0;
    if (!this.game.config().userSettings()?.fxLayer() || !hasFx) {
      this.lastRefreshMs = nowMs;
      return;
    }

    const needsRefresh = nowMs > this.lastRefreshMs + this.refreshRate;
    let delta = 0;

    if (needsRefresh) {
      delta = this.lastRefreshMs === 0 ? 0 : nowMs - this.lastRefreshMs;
      this.lastRefreshMs = nowMs;
    }

    this.drawVisibleFx(context, delta);
  }

  private drawVisibleFx(context: CanvasRenderingContext2D, duration: number) {
    // Translate the context to the center so that FX coordinates align with the world coordinates
    context.save();
    context.imageSmoothingEnabled = false;
    context.translate(-this.game.width() / 2, -this.game.height() / 2);

    for (let i = this.allFx.length - 1; i >= 0; i--) {
      // In immediate mode, we want to skip updating the FX if duration is 0,
      // but still draw it. If duration > 0, we both update and draw.
      // renderTick does both in the original code.
      // If we need to decouple update and draw, we might need to modify Fx interface,
      // but calling renderTick with a delta of 0 just redraws without advancing animation.
      if (!this.allFx[i].renderTick(duration, context)) {
        this.allFx.splice(i, 1);
      }
    }

    context.restore();
  }
}
