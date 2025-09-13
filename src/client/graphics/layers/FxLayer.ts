import { Theme } from "../../../core/configuration/Config";
import { EventBus } from "../../../core/EventBus";
import { UnitType } from "../../../core/game/Game";
import { TileRef } from "../../../core/game/GameMap";
import {
  BonusEventUpdate,
  ConquestUpdate,
  GameUpdateType,
  RailroadUpdate,
} from "../../../core/game/GameUpdates";
import { GameView, UnitView } from "../../../core/game/GameView";
import { ShowTargetEvent } from "../../InputHandler";
import { renderNumber } from "../../Utils";
import { AnimatedSpriteLoader } from "../AnimatedSpriteLoader";
import { conquestFxFactory } from "../fx/ConquestFx";
import { Fx, FxType } from "../fx/Fx";
import { nukeFxFactory, ShockwaveFx } from "../fx/NukeFx";
import { SpriteFx } from "../fx/SpriteFx";
import { TargetFx } from "../fx/TargetFx";
import { TextFx } from "../fx/TextFx";
import { UnitExplosionFx } from "../fx/UnitExplosionFx";
import { Layer } from "./Layer";
export class FxLayer implements Layer {
  private canvas: HTMLCanvasElement;
  private context: CanvasRenderingContext2D;

  private lastRefresh: number = 0;
  private refreshRate: number = 10;
  private theme: Theme;
  private animatedSpriteLoader: AnimatedSpriteLoader =
    new AnimatedSpriteLoader();

  private allFx: Fx[] = [];
  private boatTargetFxByUnitId: Map<number, TargetFx> = new Map();
  private pendingBoatTargets: {
    tile: TileRef;
    spawn: TileRef | null;
    fx: TargetFx;
    createdAt: number;
  }[] = [];

  constructor(
    private game: GameView,
    private eventBus?: EventBus,
  ) {
    this.theme = this.game.config().theme();
    if (this.eventBus) {
      this.eventBus.on(ShowTargetEvent, (e: ShowTargetEvent) => {
        const x = this.game.x(e.tile);
        const y = this.game.y(e.tile);
        // persistent until boat finishes
        const fx = new TargetFx(x, y, 0, 12, true);
        this.allFx.push(fx);
        this.pendingBoatTargets.push({
          tile: e.tile,
          spawn: (e as any).spawn ?? null,
          fx,
          createdAt: Date.now(),
        });
      });
    }
  }

  shouldTransform(): boolean {
    return true;
  }

  tick() {
    this.manageBoatTargetFx();
    this.game
      .updatesSinceLastTick()
      ?.[GameUpdateType.Unit]?.map((unit) => this.game.unit(unit.id))
      ?.forEach((unitView) => {
        if (unitView === undefined) return;
        this.onUnitEvent(unitView);
      });
    this.game
      .updatesSinceLastTick()
      ?.[GameUpdateType.BonusEvent]?.forEach((bonusEvent) => {
        if (bonusEvent === undefined) return;
        this.onBonusEvent(bonusEvent);
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

  private manageBoatTargetFx() {
    const my = this.game.myPlayer();
    if (!my) return;

    // Bind pending markers to newly created boats heading to that tile
    if (this.pendingBoatTargets.length > 0) {
      const boats = my
        .units()
        .filter((u) => u.type() === UnitType.TransportShip && u.isActive());
      for (let i = this.pendingBoatTargets.length - 1; i >= 0; i--) {
        const pending = this.pendingBoatTargets[i];
        // Prefer matching by spawn tile if known; fall back to target tile proximity
        const match = boats.find((b) => {
          if (this.boatTargetFxByUnitId.has(b.id())) return false;
          const t = b.targetTile();
          if (pending.spawn !== null) {
            // If the newly spawned boat's current tile equals provided spawn, it's our guy
            if (b.tile && b.tile() === pending.spawn) return true;
          }
          if (t === undefined) return false;
          return (
            t === pending.tile || this.game.manhattanDist(t, pending.tile) <= 1
          );
        });
        if (match) {
          this.boatTargetFxByUnitId.set(match.id(), pending.fx);
          this.pendingBoatTargets.splice(i, 1);
          continue;
        }
        // Expire unbound targets after a timeout to avoid stuck markers if no boat spawns
        const maxWaitMs = 8000; // 8 seconds
        if (Date.now() - pending.createdAt > maxWaitMs) {
          (pending.fx as any).end?.();
          this.pendingBoatTargets.splice(i, 1);
        }
      }
    }

    // End markers for boats that arrived or retreated
    for (const [unitId, fx] of Array.from(
      this.boatTargetFxByUnitId.entries(),
    )) {
      const unit = this.game.unit(unitId);
      if (
        !unit ||
        !unit.isActive() ||
        unit.reachedTarget() ||
        unit.retreating()
      ) {
        (fx as any).end?.();
        this.boatTargetFxByUnitId.delete(unitId);
      }
    }
  }

  onBonusEvent(bonus: BonusEventUpdate) {
    if (this.game.player(bonus.player) !== this.game.myPlayer()) {
      // Only display text fx for the current player
      return;
    }
    const tile = bonus.tile;
    const x = this.game.x(tile);
    let y = this.game.y(tile);
    const gold = bonus.gold;
    const troops = bonus.troops;

    if (gold > 0) {
      const shortened = renderNumber(gold, 0);
      this.addTextFx(`+ ${shortened}`, x, y);
      y += 10; // increase y so the next popup starts bellow
    }

    if (troops > 0) {
      const shortened = renderNumber(troops, 0);
      this.addTextFx(`+ ${shortened} troops`, x, y);
      y += 10;
    }
  }

  addTextFx(text: string, x: number, y: number) {
    const textFx = new TextFx(text, x, y, 1000, 20);
    this.allFx.push(textFx);
  }

  addTargetFx(x: number, y: number) {
    const fx = new TargetFx(x, y, 1200, 12);
    this.allFx.push(fx);
  }

  onUnitEvent(unit: UnitView) {
    switch (unit.type()) {
      case UnitType.AtomBomb:
      case UnitType.MIRVWarhead:
        this.onNukeEvent(unit, 70);
        break;
      case UnitType.HydrogenBomb:
        this.onNukeEvent(unit, 160);
        break;
      case UnitType.Warship:
        this.onWarshipEvent(unit);
        break;
      case UnitType.Shell:
        this.onShellEvent(unit);
        break;
      case UnitType.Train:
        this.onTrainEvent(unit);
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

    const conquestFx = conquestFxFactory(
      this.animatedSpriteLoader,
      conquest,
      this.game,
    );
    this.allFx = this.allFx.concat(conquestFx);
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
