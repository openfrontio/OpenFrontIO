import { Theme } from "../../../core/configuration/Config";
import { UnitType } from "../../../core/game/Game";
import {
  BonusEventUpdate,
  ConquestUpdate,
  GameUpdateType,
  RailroadUpdate,
} from "../../../core/game/GameUpdates";
import { GameView, UnitView } from "../../../core/game/GameView";
import { UserSettings } from "../../../core/game/UserSettings";
import { SoundEffect, SoundManager } from "../../sound/SoundManager";
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
  private seenBuildingUnitIds: Set<number> = new Set();
  private destroyedBuildingUnitIds: Set<number> = new Set();
  // Track recent nuke explosions: Map<tile, {owner, radius, tick}>
  private recentNukeExplosions: Map<
    number,
    Array<{ owner: number; radius: number; tick: number }>
  > = new Map();
  // Track recently conquered tiles: Map<tile, {conqueror, tick}>
  private recentlyConqueredTiles: Map<
    number,
    { conqueror: number; tick: number }
  > = new Map();
  // Track tiles where steal building sound has been played to avoid duplicates
  private stealBuildingSoundPlayed: Set<number> = new Set();
  // Track previous owners of buildings to detect ownership changes
  private buildingPreviousOwners: Map<number, number> = new Map();
  // Track nukes that have already had their launch sound played
  private nukeLaunchSoundPlayed: Set<number> = new Set();

  constructor(
    private game: GameView,
    private soundManager: SoundManager,
    private userSettings: UserSettings,
  ) {
    this.theme = this.game.config().theme();
  }

  shouldTransform(): boolean {
    return true;
  }

  tick() {
    this.manageBoatTargetFx();
    this.cleanupOldNukeExplosions();

    // Track recently updated tiles that are now owned by current player
    const my = this.game.myPlayer();
    if (my) {
      const recentlyUpdatedTiles = this.game.recentlyUpdatedTiles();
      const currentTick = this.game.ticks();
      const mySmallID = my.smallID();
      for (const tile of recentlyUpdatedTiles) {
        const tileOwner = this.game.owner(tile);
        if (tileOwner === my) {
          this.recentlyConqueredTiles.set(tile, {
            conqueror: mySmallID,
            tick: currentTick,
          });
        }
      }
    }

    // Process nukes first to track explosions before checking buildings
    const unitUpdates =
      this.game.updatesSinceLastTick()?.[GameUpdateType.Unit] ?? [];
    const nukeUnits = unitUpdates
      .map((unit) => this.game.unit(unit.id))
      .filter(
        (unitView): unitView is UnitView =>
          unitView !== undefined &&
          (unitView.type() === UnitType.AtomBomb ||
            unitView.type() === UnitType.HydrogenBomb ||
            unitView.type() === UnitType.MIRVWarhead),
      );

    // Process nukes first
    nukeUnits.forEach((unitView) => {
      this.onUnitEvent(unitView);
    });

    // Then process all other units (including buildings destroyed by nukes)
    unitUpdates
      .map((unit) => this.game.unit(unit.id))
      ?.forEach((unitView) => {
        if (unitView === undefined) return;
        // Skip nukes as they're already processed
        if (
          unitView.type() === UnitType.AtomBomb ||
          unitView.type() === UnitType.HydrogenBomb ||
          unitView.type() === UnitType.MIRVWarhead
        ) {
          return;
        }
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

  private cleanupOldNukeExplosions() {
    const currentTick = this.game.ticks();
    // Remove nuke explosions older than 2 ticks
    for (const [tile, explosions] of this.recentNukeExplosions.entries()) {
      const filtered = explosions.filter((exp) => currentTick - exp.tick <= 2);
      if (filtered.length === 0) {
        this.recentNukeExplosions.delete(tile);
      } else {
        this.recentNukeExplosions.set(tile, filtered);
      }
    }
    // Remove recently conquered tiles older than 2 ticks
    for (const [tile, conquest] of this.recentlyConqueredTiles.entries()) {
      if (currentTick - conquest.tick > 2) {
        this.recentlyConqueredTiles.delete(tile);
        // Also clean up the steal building sound tracking
        this.stealBuildingSoundPlayed.delete(tile);
      }
    }
  }

  private isBuildingNearNukeExplosion(
    buildingTile: number,
    mySmallID: number,
  ): boolean {
    for (const [nukeTile, explosions] of this.recentNukeExplosions.entries()) {
      for (const explosion of explosions) {
        if (explosion.owner !== mySmallID) continue;
        // Check if building is within nuke radius
        const distSquared = this.game.euclideanDistSquared(
          nukeTile,
          buildingTile,
        );
        const radiusSquared = explosion.radius * explosion.radius;
        if (distSquared <= radiusSquared) {
          return true;
        }
      }
    }
    return false;
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

  // Register a persistent nuke target marker for the current player or teammates
  private createNukeTargetFxIfOwned(unit: UnitView) {
    const my = this.game.myPlayer();
    if (!my) return;
    // Show nuke marker owned by the player or by players on the same team
    if (
      (unit.owner() === my || my.isOnSameTeam(unit.owner())) &&
      unit.isActive()
    ) {
      if (!this.nukeTargetFxByUnitId.has(unit.id())) {
        const t = unit.targetTile();
        if (t !== undefined) {
          const x = this.game.x(t);
          const y = this.game.y(t);
          const fx = new NukeAreaFx(
            x,
            y,
            this.game.config().nukeMagnitudes(unit.type()),
          );
          this.allFx.push(fx);
          this.nukeTargetFxByUnitId.set(unit.id(), fx);
        }
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
        // Clean up any stale building-related entries if unit ID was reused
        this.destroyedBuildingUnitIds.delete(unit.id());
        this.buildingPreviousOwners.delete(unit.id());

        this.createNukeTargetFxIfOwned(unit);
        // Play launch sound for attacker when nuke first appears
        if (unit.isActive() && !this.nukeLaunchSoundPlayed.has(unit.id())) {
          const my = this.game.myPlayer();
          if (my && unit.owner() === my) {
            this.soundManager?.playSoundEffect(SoundEffect.AtomLaunch);
          }
          this.nukeLaunchSoundPlayed.add(unit.id());
        }
        this.onNukeEvent(unit, 70);
        break;
      }
      case UnitType.MIRVWarhead: {
        // Clean up any stale building-related entries if unit ID was reused
        this.destroyedBuildingUnitIds.delete(unit.id());
        this.buildingPreviousOwners.delete(unit.id());

        // Play launch sound for attacker when MIRV first appears
        if (unit.isActive() && !this.nukeLaunchSoundPlayed.has(unit.id())) {
          const my = this.game.myPlayer();
          if (my && unit.owner() === my) {
            this.soundManager?.playSoundEffect(
              SoundEffect.MIRVLaunch,
              this.userSettings.mirvLaunchVolume(),
            );
          }
          this.nukeLaunchSoundPlayed.add(unit.id());
        }
        this.onNukeEvent(unit, 70);
        break;
      }
      case UnitType.HydrogenBomb: {
        // Clean up any stale building-related entries if unit ID was reused
        this.destroyedBuildingUnitIds.delete(unit.id());
        this.buildingPreviousOwners.delete(unit.id());

        this.createNukeTargetFxIfOwned(unit);
        // Play launch sound for attacker when nuke first appears
        if (unit.isActive() && !this.nukeLaunchSoundPlayed.has(unit.id())) {
          const my = this.game.myPlayer();
          if (my && unit.owner() === my) {
            this.soundManager?.playSoundEffect(SoundEffect.HydrogenLaunch);
          }
          this.nukeLaunchSoundPlayed.add(unit.id());
        }
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

    this.soundManager?.playSoundEffect(SoundEffect.KaChing);

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
    // Clean up any stale nuke-related entries if unit ID was reused
    this.nukeLaunchSoundPlayed.delete(unit.id());

    const my = this.game.myPlayer();
    const unitTile = unit.tile();
    const currentOwnerSmallID = unit.owner().smallID();

    // Track previous owner to detect ownership changes
    const previousOwnerSmallID = this.buildingPreviousOwners.get(unit.id());
    if (previousOwnerSmallID === undefined) {
      // Initialize previous owner tracking for new buildings
      this.buildingPreviousOwners.set(unit.id(), currentOwnerSmallID);
    } else if (previousOwnerSmallID !== currentOwnerSmallID) {
      // Update when ownership changes
      this.buildingPreviousOwners.set(unit.id(), currentOwnerSmallID);
    }

    // Check if building was just completed (becomes active for the first time)
    if (unit.isActive() && !this.seenBuildingUnitIds.has(unit.id())) {
      // Only play sound for buildings owned by the current player
      if (my && unit.owner() === my) {
        this.soundManager?.playSoundEffect(SoundEffect.Building);
      }
      this.seenBuildingUnitIds.add(unit.id());
    }

    // Check if building was captured (ownership changed to current player)
    if (
      unit.isActive() &&
      my &&
      unit.owner() === my &&
      previousOwnerSmallID !== undefined &&
      previousOwnerSmallID !== currentOwnerSmallID &&
      previousOwnerSmallID !== my.smallID()
    ) {
      // Check if the tile was recently conquered by the current player
      const recentlyConqueredByMe =
        this.recentlyConqueredTiles.has(unitTile) &&
        this.recentlyConqueredTiles.get(unitTile)?.conqueror === my.smallID();

      // Only play if tile was recently conquered (not just ownership change from other causes)
      if (
        recentlyConqueredByMe &&
        !this.stealBuildingSoundPlayed.has(unitTile)
      ) {
        // Play steal building sound at 50% volume for the attacker
        this.soundManager?.playSoundEffect(SoundEffect.StealBuilding, 0.5);
        this.stealBuildingSoundPlayed.add(unitTile);
      }
    }

    if (!unit.isActive()) {
      const my = this.game.myPlayer();
      const unitTile = unit.lastTile();

      // Clean up building-related tracking maps when building is destroyed
      this.destroyedBuildingUnitIds.delete(unit.id());
      this.buildingPreviousOwners.delete(unit.id());
      this.stealBuildingSoundPlayed.delete(unitTile);

      if (!my) {
        // No player context, just show explosion
        const x = this.game.x(unit.lastTile());
        const y = this.game.y(unit.lastTile());
        const explosion = new SpriteFx(
          this.animatedSpriteLoader,
          x,
          y,
          FxType.BuildingExplosion,
        );
        this.allFx.push(explosion);
        this.seenBuildingUnitIds.delete(unit.id());
        return;
      }

      const recentlyUpdatedTiles = this.game.recentlyUpdatedTiles();
      const tileWasJustConquered = recentlyUpdatedTiles.includes(unitTile);
      const tileOwner = this.game.owner(unitTile);
      const mySmallID = my.smallID();

      // Check if we should play the destroyed building sound
      // Play for defender: unit was owned by current player
      const isDefender = unit.owner() === my;

      // Check if building was destroyed by a nuke owned by current player
      const destroyedByMyNuke = this.isBuildingNearNukeExplosion(
        unitTile,
        mySmallID,
      );

      // Check if tile was recently conquered by current player (for defense post detection)
      const recentlyConqueredByMe =
        this.recentlyConqueredTiles.has(unitTile) &&
        this.recentlyConqueredTiles.get(unitTile)?.conqueror === mySmallID;

      // Play for attacker: building was destroyed during land attack (including defense posts)
      // Check both recentlyUpdatedTiles and our tracked recentlyConqueredTiles
      const isAttackerFromLandConquest =
        !destroyedByMyNuke &&
        (tileWasJustConquered || recentlyConqueredByMe) &&
        tileOwner === my &&
        unit.owner() !== my;

      // Play sound if:
      // - Defender: unit was owned by current player (always plays)
      // - Attacker: building destroyed by nuke OR building destroyed during land conquest
      if (
        (isDefender || destroyedByMyNuke || isAttackerFromLandConquest) &&
        !this.destroyedBuildingUnitIds.has(unit.id())
      ) {
        this.soundManager?.playSoundEffect(SoundEffect.BuildingDestroyed);
        this.destroyedBuildingUnitIds.add(unit.id());
      }

      const x = this.game.x(unit.lastTile());
      const y = this.game.y(unit.lastTile());
      const explosion = new SpriteFx(
        this.animatedSpriteLoader,
        x,
        y,
        FxType.BuildingExplosion,
      );
      this.allFx.push(explosion);
      // Remove from seen set when building is destroyed
      this.seenBuildingUnitIds.delete(unit.id());
    }
  }

  onNukeEvent(unit: UnitView, radius: number) {
    if (!unit.isActive()) {
      // Clean up nuke-related tracking maps when nuke is removed/exploded
      this.nukeLaunchSoundPlayed.delete(unit.id());

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
    const nukeTile = unit.lastTile();
    const nukeOwner = unit.owner();

    // Use actual destruction radius from config, not visual radius
    const nukeMagnitude = this.game.config().nukeMagnitudes(unit.type());
    const destructionRadius = nukeMagnitude.outer;

    // Track this nuke explosion so we can detect buildings destroyed by it
    const currentTick = this.game.ticks();
    const explosions = this.recentNukeExplosions.get(nukeTile) ?? [];
    explosions.push({
      owner: nukeOwner.smallID(),
      radius: destructionRadius,
      tick: currentTick,
    });
    this.recentNukeExplosions.set(nukeTile, explosions);

    // Play hit sound for both attacker and defender
    const my = this.game.myPlayer();
    if (my) {
      const isAttacker = nukeOwner === my;
      const targetOwner = this.game.owner(nukeTile);
      const isDefender =
        targetOwner === my ||
        (targetOwner.isPlayer() && my.isOnSameTeam(targetOwner));

      // Play hit sound based on nuke type
      if (unit.type() === UnitType.AtomBomb) {
        if (isAttacker || isDefender) {
          this.soundManager?.playSoundEffect(SoundEffect.AtomHit);
        }
      } else if (unit.type() === UnitType.HydrogenBomb) {
        if (isAttacker || isDefender) {
          this.soundManager?.playSoundEffect(SoundEffect.HydrogenHit);
        }
      } else if (unit.type() === UnitType.MIRVWarhead) {
        // MIRV warheads use atom hit sound
        if (isAttacker || isDefender) {
          this.soundManager?.playSoundEffect(SoundEffect.AtomHit);
        }
      }
    }

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

    // Play SAM hit sound for nuke owner when their nuke is intercepted
    const my = this.game.myPlayer();
    if (my) {
      const nukeOwner = unit.owner();
      const isNukeOwner = nukeOwner === my;
      // Check if it's an atom bomb, hydrogen bomb, or MIRV warhead
      const isNuke =
        unit.type() === UnitType.AtomBomb ||
        unit.type() === UnitType.HydrogenBomb ||
        unit.type() === UnitType.MIRVWarhead;
      if (isNukeOwner && isNuke) {
        this.soundManager?.playSoundEffect(SoundEffect.SAMHit);
      }
    }
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
