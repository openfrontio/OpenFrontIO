import { EventBus } from "src/core/EventBus";
import { TileRef } from "src/core/game/GameMap";
import { Theme } from "../../../core/configuration/Config";
import { UnitType } from "../../../core/game/Game";
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
  private canvas: HTMLCanvasElement;
  private context: CanvasRenderingContext2D;

  private lastRefreshMs: number = 0;
  private refreshRate: number = 10;
  private theme: Theme;
  private animatedSpriteLoader: AnimatedSpriteLoader =
    new AnimatedSpriteLoader();

  private allFx: Fx[] = [];
  private hasBufferedFrame = false;

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
    this.canvas = document.createElement("canvas");
    const context = this.canvas.getContext("2d");
    if (context === null) throw new Error("2d context not supported");
    this.context = context;
    this.context.imageSmoothingEnabled = false;
    this.canvas.width = this.game.width();
    this.canvas.height = this.game.height();
  }

  renderLayer(context: CanvasRenderingContext2D) {
    const nowMs = performance.now();

    const hasFx = this.allFx.length > 0;
    if (!this.game.config().userSettings()?.fxLayer() || !hasFx) {
      if (this.hasBufferedFrame) {
        // Clear stale pixels once when fx ends/disabled so re-enabling doesn't
        // flash old frames.
        this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.hasBufferedFrame = false;
      }
      this.lastRefreshMs = nowMs;
      return;
    }

    const needsRefresh =
      !this.hasBufferedFrame || nowMs > this.lastRefreshMs + this.refreshRate;
    if (needsRefresh) {
      const delta = this.hasBufferedFrame ? nowMs - this.lastRefreshMs : 0;
      this.renderAllFx(delta);
      this.lastRefreshMs = nowMs;
      this.hasBufferedFrame = true;
    }

    this.drawVisibleFx(context);
  }

  private drawVisibleFx(context: CanvasRenderingContext2D) {
    const mapW = this.game.width();
    const mapH = this.game.height();

    const [topLeft, bottomRight] = this.transformHandler.screenBoundingRect();
    const pad = 2;

    const left = Math.max(0, Math.floor(topLeft.x - pad));
    const top = Math.max(0, Math.floor(topLeft.y - pad));
    const right = Math.min(mapW, Math.ceil(bottomRight.x + pad));
    const bottom = Math.min(mapH, Math.ceil(bottomRight.y + pad));

    const width = Math.max(0, right - left);
    const height = Math.max(0, bottom - top);
    if (width === 0 || height === 0) return;

    context.drawImage(
      this.canvas,
      left,
      top,
      width,
      height,
      -mapW / 2 + left,
      -mapH / 2 + top,
      width,
      height,
    );
  }

  private renderAllFx(delta: number) {
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.renderContextFx(delta);
  }

  renderContextFx(duration: number) {
    for (let i = this.allFx.length - 1; i >= 0; i--) {
      if (!this.allFx[i].renderTick(duration, this.context)) {
        this.allFx.splice(i, 1);
      }
    }
  }
}
