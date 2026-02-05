import { Theme } from "../../../core/configuration/Config";
import { UnitType } from "../../../core/game/Game";
import {
  ConquestUpdate,
  GameUpdateType,
  RailroadUpdate,
} from "../../../core/game/GameUpdates";
import { GameView, UnitView } from "../../../core/game/GameView";
import SoundManager, { SoundEffect } from "../../sound/SoundManager";
import { AnimatedSpriteLoader } from "../AnimatedSpriteLoader";
import { conquestFxFactory } from "../fx/ConquestFx";
import { Fx, FxType } from "../fx/Fx";
import { nukeFxFactory, ShockwaveFx } from "../fx/NukeFx";
import { SpriteFx } from "../fx/SpriteFx";
import { UnitExplosionFx } from "../fx/UnitExplosionFx";
import { Layer } from "./Layer";
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

  constructor(private game: GameView) {
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
      ?.[GameUpdateType.RailroadEvent]?.forEach((update) => {
        if (update === undefined) return;
        this.onRailroadEvent(update);
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

  onRailroadEvent(railroad: RailroadUpdate) {
    const railTiles = railroad.railTiles;
    for (const rail of railTiles) {
      // No need for pseudorandom, this is fx
      const chanceFx = Math.floor(Math.random() * 3);
      if (chanceFx === 0) {
        const x = this.game.x(rail.tile);
        const y = this.game.y(rail.tile);
        const animation = new SpriteFx(
          this.animatedSpriteLoader,
          x,
          y,
          FxType.Dust,
        );
        this.allFx.push(animation);
      }
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
    if (this.game.config().userSettings()?.fxLayer()) {
      const hasFx = this.allFx.length > 0;
      if (!hasFx) {
        if (this.hasBufferedFrame) {
          // Clear stale pixels once when fx ends; the main renderer clears its
          // overlay each frame, so we can skip drawing entirely when empty.
          this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
          this.hasBufferedFrame = false;
        }
        return;
      }

      const nowMs = performance.now();
      if (nowMs > this.lastRefreshMs + this.refreshRate) {
        const delta = nowMs - this.lastRefreshMs;
        this.renderAllFx(delta);
        this.lastRefreshMs = nowMs;
      }

      this.hasBufferedFrame = true;
      this.drawVisibleFx(context);
    }
  }

  private drawVisibleFx(context: CanvasRenderingContext2D) {
    const mapW = this.game.width();
    const mapH = this.game.height();

    const vis = this.visibleMapRect(context, mapW, mapH);
    if (!vis) {
      context.drawImage(this.canvas, -mapW / 2, -mapH / 2, mapW, mapH);
      return;
    }

    context.drawImage(
      this.canvas,
      vis.srcX,
      vis.srcY,
      vis.srcW,
      vis.srcH,
      vis.dstX,
      vis.dstY,
      vis.dstW,
      vis.dstH,
    );
  }

  private visibleMapRect(
    context: CanvasRenderingContext2D,
    mapW: number,
    mapH: number,
  ): {
    srcX: number;
    srcY: number;
    srcW: number;
    srcH: number;
    dstX: number;
    dstY: number;
    dstW: number;
    dstH: number;
  } | null {
    const getTransform = (context as any).getTransform as
      | (() => DOMMatrix)
      | undefined;
    if (!getTransform) {
      return null;
    }

    let inv: DOMMatrix;
    try {
      inv = getTransform.call(context).inverse();
    } catch {
      return null;
    }

    const toWorld = (sx: number, sy: number): { x: number; y: number } => ({
      x: inv.a * sx + inv.c * sy + inv.e,
      y: inv.b * sx + inv.d * sy + inv.f,
    });

    const cw = context.canvas.width;
    const ch = context.canvas.height;
    const p0 = toWorld(0, 0);
    const p1 = toWorld(cw, 0);
    const p2 = toWorld(0, ch);
    const p3 = toWorld(cw, ch);

    const minWorldX = Math.min(p0.x, p1.x, p2.x, p3.x);
    const maxWorldX = Math.max(p0.x, p1.x, p2.x, p3.x);
    const minWorldY = Math.min(p0.y, p1.y, p2.y, p3.y);
    const maxWorldY = Math.max(p0.y, p1.y, p2.y, p3.y);

    const pad = 2;
    const left = Math.max(0, Math.floor(minWorldX + mapW / 2 - pad));
    const top = Math.max(0, Math.floor(minWorldY + mapH / 2 - pad));
    const right = Math.min(mapW, Math.ceil(maxWorldX + mapW / 2 + pad));
    const bottom = Math.min(mapH, Math.ceil(maxWorldY + mapH / 2 + pad));

    const width = Math.max(0, right - left);
    const height = Math.max(0, bottom - top);
    if (width === 0 || height === 0) {
      return null;
    }

    return {
      srcX: left,
      srcY: top,
      srcW: width,
      srcH: height,
      dstX: -mapW / 2 + left,
      dstY: -mapH / 2 + top,
      dstW: width,
      dstH: height,
    };
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
