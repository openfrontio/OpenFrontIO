import { Theme } from "../../../core/configuration/Config";
import { UnitType } from "../../../core/game/Game";
import {
  BonusEventUpdate,
  ConquestUpdate,
  GameUpdateType,
  RailroadUpdate,
} from "../../../core/game/GameUpdates";
import { GameView, UnitView } from "../../../core/game/GameView";
import SoundManager, { SoundEffect } from "../../sound/SoundManager";
import { renderNumber } from "../../Utils";
import { AnimatedSpriteLoader } from "../AnimatedSpriteLoader";
import { conquestFxFactory } from "../fx/ConquestFx";
import { Fx, FxType } from "../fx/Fx";
import { NukeAreaFx } from "../fx/NukeAreaFx";
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
  private nukeTargetFxByUnitId: Map<number, NukeAreaFx> = new Map();

  constructor(private game: GameView) {
    this.theme = this.game.config().theme();
  }

  shouldTransform(): boolean {
    return true;
  }

  tick() {
    this.manageBoatTargetFx();
    this.updateNukeTargetFxRemainingTime();
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

  private calculateAlertIntensity(unit: UnitView): number | undefined {
    const trajectoryIndex = unit.trajectoryIndex();
    const trajectoryLength = unit.trajectoryLength();
    if (
      trajectoryIndex !== undefined &&
      trajectoryLength !== undefined &&
      trajectoryLength > 0
    ) {
      // Calculate alert intensity: 0 = start of trajectory, 1 = end of trajectory
      // Scale based on progress through trajectory
      return Math.max(0, Math.min(1, trajectoryIndex / trajectoryLength));
    }
    return undefined;
  }

  private updateNukeTargetFxRemainingTime() {
    // Update alert intensity for inbound bombs and check if inbound status changed
    // (e.g., if player recaptures territory while bomb is in flight)
    // Also update timer information
    for (const [unitId, fx] of Array.from(
      this.nukeTargetFxByUnitId.entries(),
    )) {
      const unit = this.game.unit(unitId);
      if (!unit || !unit.isActive()) continue;

      const targetTile = unit.targetTile();
      if (!targetTile) continue;

      const my = this.game.myPlayer();
      if (!my) continue;

      // Recompute isInbound based on current target tile ownership
      const targetOwner = this.game.owner(targetTile);
      const isInbound =
        targetOwner.isPlayer() &&
        (targetOwner.id() === my.id() || my.isOnSameTeam(targetOwner));

      // Update inbound flag if it changed
      if (fx.isInboundBomb() !== isInbound) {
        fx.setInbound(isInbound);
      }

      // Calculate remaining time
      const trajectoryIndex = unit.trajectoryIndex();
      const trajectoryLength = unit.trajectoryLength();
      let remainingSeconds: number | null = null;
      if (
        trajectoryIndex !== undefined &&
        trajectoryLength !== undefined &&
        trajectoryLength > 0
      ) {
        const remainingTicks = trajectoryLength - trajectoryIndex;
        remainingSeconds = Math.max(0, Math.ceil(remainingTicks / 10));
      }

      // Determine if bomb is outbound (launched by my player or teammate)
      const isOutbound = unit.owner() === my || my.isOnSameTeam(unit.owner());

      // Only show timer for bombs that are either outbound or inbound
      if (isOutbound || isInbound) {
        fx.updateTimer(remainingSeconds, isOutbound);
      }

      // Update alert intensity for inbound bombs
      if (isInbound) {
        const alertIntensity = this.calculateAlertIntensity(unit);
        if (alertIntensity !== undefined) {
          fx.updateAlertIntensity(alertIntensity);
        }
      }
    }
  }

  // Register a persistent nuke target marker for the current player or teammates
  // Also shows marker for inbound bombs targeting the player
  private createNukeTargetFxIfOwned(unit: UnitView) {
    const my = this.game.myPlayer();
    if (!my) return;
    if (!unit.isActive()) return;

    // Check if bomb is outbound (owned by player or teammate)
    const isOutbound = unit.owner() === my || my.isOnSameTeam(unit.owner());

    // Check if bomb is inbound (targeting player's or teammate's territory)
    const targetTile = unit.targetTile();
    let isInbound = false;
    if (targetTile !== undefined) {
      const targetOwner = this.game.owner(targetTile);
      isInbound =
        targetOwner.isPlayer() &&
        (targetOwner.id() === my.id() || my.isOnSameTeam(targetOwner));
    }

    // Show nuke marker for outbound or inbound bombs
    if (
      (isOutbound || isInbound) &&
      !this.nukeTargetFxByUnitId.has(unit.id())
    ) {
      if (targetTile !== undefined) {
        const x = this.game.x(targetTile);
        const y = this.game.y(targetTile);

        // Calculate alert intensity for inbound bombs
        const alertIntensity = isInbound
          ? (this.calculateAlertIntensity(unit) ?? 0)
          : 0;

        // Calculate remaining time
        const trajectoryIndex = unit.trajectoryIndex();
        const trajectoryLength = unit.trajectoryLength();
        let remainingSeconds: number | null = null;
        if (
          trajectoryIndex !== undefined &&
          trajectoryLength !== undefined &&
          trajectoryLength > 0
        ) {
          const remainingTicks = trajectoryLength - trajectoryIndex;
          remainingSeconds = Math.max(0, Math.ceil(remainingTicks / 10));
        }

        const fx = new NukeAreaFx(
          x,
          y,
          this.game.config().nukeMagnitudes(unit.type()),
          isInbound,
          alertIntensity,
          isOutbound,
          remainingSeconds,
        );
        this.allFx.push(fx);
        this.nukeTargetFxByUnitId.set(unit.id(), fx);
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

  onUnitEvent(unit: UnitView) {
    switch (unit.type()) {
      case UnitType.TransportShip: {
        const my = this.game.myPlayer();
        if (!my) return;
        if (unit.owner() !== my) return;
        if (!unit.isActive() || unit.retreating()) return;
        if (this.boatTargetFxByUnitId.has(unit.id())) return;
        const t = unit.targetTile();
        if (t !== undefined) {
          const x = this.game.x(t);
          const y = this.game.y(t);
          // persistent until boat finishes or retreats
          const fx = new TargetFx(x, y, 0, true);
          this.allFx.push(fx);
          this.boatTargetFxByUnitId.set(unit.id(), fx);
        }
        break;
      }
      case UnitType.AtomBomb: {
        this.createNukeTargetFxIfOwned(unit);
        this.onNukeEvent(unit, 70);
        break;
      }
      case UnitType.MIRVWarhead:
        this.onNukeEvent(unit, 70);
        break;
      case UnitType.HydrogenBomb: {
        this.createNukeTargetFxIfOwned(unit);
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
      const fx = this.nukeTargetFxByUnitId.get(unit.id());
      if (fx) {
        fx.end();
        this.nukeTargetFxByUnitId.delete(unit.id());
      }
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
