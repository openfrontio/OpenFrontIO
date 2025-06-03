import { consolex } from "../Consolex";
import {
  Execution,
  Game,
  MessageType,
  Player,
  TerraNullius,
  Unit,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { ParabolaPathFinder } from "../pathfinding/PathFinding";
import { PseudoRandom } from "../PseudoRandom";
import { NukeType } from "../StatsSchemas";

export class NukeExecution implements Execution {
  private active = true;
  private mg: Game;
  private nuke: Unit | null = null;
  private tilesToDestroyCache: Set<TileRef> | undefined;

  private random: PseudoRandom;
  private pathFinder: ParabolaPathFinder;

  constructor(
    private nukeType: NukeType,
    private _owner: Player,
    private dst: TileRef,
    private src?: TileRef | null,
    private speed: number = -1,
    private waitTicks = 0,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    this.random = new PseudoRandom(ticks);
    if (this.speed === -1) {
      this.speed = this.mg.config().defaultNukeSpeed();
    }
    this.pathFinder = new ParabolaPathFinder(mg);
  }

  public target(): Player | TerraNullius {
    return this.mg.owner(this.dst);
  }

  private tilesToDestroy(): Set<TileRef> {
    if (this.tilesToDestroyCache !== undefined) {
      return this.tilesToDestroyCache;
    }
    const magnitude = this.mg.config().nukeMagnitudes(this.nukeType);
    const rand = new PseudoRandom(this.mg.ticks());
    const inner2 = magnitude.inner * magnitude.inner;
    const outer2 = magnitude.outer * magnitude.outer;
    this.tilesToDestroyCache = this.mg.bfs(this.dst, (_, n: TileRef) => {
      const d2 = this.mg.euclideanDistSquared(this.dst, n);
      return d2 <= outer2 && (d2 <= inner2 || rand.chance(2));
    });
    return this.tilesToDestroyCache;
  }

  private breakAlliances(toDestroy: Set<TileRef>) {
    const attacked = new Map<Player, number>();
    for (const tile of toDestroy) {
      const owner = this.mg.owner(tile);
      if (owner.isPlayer()) {
        const prev = attacked.get(owner) ?? 0;
        attacked.set(owner, prev + 1);
      }
    }

    for (const [other, tilesDestroyed] of attacked) {
      if (tilesDestroyed > 100 && this.nukeType !== UnitType.MIRVWarhead) {
        // Mirv warheads shouldn't break alliances
        const alliance = this._owner.allianceWith(other);
        if (alliance !== null) {
          this._owner.breakAlliance(alliance);
        }
        if (other !== this._owner) {
          other.updateRelation(this._owner, -100);
        }
      }
    }
  }

  tick(ticks: number): void {
    if (this.nuke === null) {
      const spawn = this.src ?? this._owner.canBuild(this.nukeType, this.dst);
      if (spawn === false) {
        consolex.warn(`cannot build Nuke`);
        this.active = false;
        return;
      }
      this.pathFinder.computeControlPoints(
        spawn,
        this.dst,
        this.nukeType !== UnitType.MIRVWarhead,
      );
      this.nuke = this._owner.buildUnit(this.nukeType, spawn, {
        targetTile: this.dst,
      });
      if (this.mg.hasOwner(this.dst)) {
        const target = this.mg.owner(this.dst);
        if (!target.isPlayer()) {
          // Ignore terra nullius
        } else if (this.nukeType === UnitType.AtomBomb) {
          this.mg.displayIncomingUnit(
            this.nuke.id(),
            `${this._owner.name()} - atom bomb inbound`,
            MessageType.ERROR,
            target.id(),
          );
          this.breakAlliances(this.tilesToDestroy());
        } else if (this.nukeType === UnitType.HydrogenBomb) {
          this.mg.displayIncomingUnit(
            this.nuke.id(),
            `${this._owner.name()} - hydrogen bomb inbound`,
            MessageType.ERROR,
            target.id(),
          );
          this.breakAlliances(this.tilesToDestroy());
        }

        // Record stats
        this.mg.stats().bombLaunch(this._owner, target, this.nukeType);
      }

      // after sending a nuke set the missilesilo on cooldown
      const silo = this._owner
        .units(UnitType.MissileSilo)
        .find((silo) => silo.tile() === spawn);
      if (silo) {
        silo.launch();
      }
      return;
    }

    // make the nuke unactive if it was intercepted
    if (!this.nuke.isActive()) {
      consolex.log(`Nuke destroyed before reaching target`);
      this.active = false;
      return;
    }

    if (this.waitTicks > 0) {
      this.waitTicks--;
      return;
    }

    // Move to next tile
    const nextTile = this.pathFinder.nextTile(this.speed);
    if (nextTile === true) {
      this.detonate();
      return;
    } else {
      this.nuke.move(nextTile);
    }
  }

  private detonate() {
    const magnitude = this.mg.config().nukeMagnitudes(this.nukeType);
    const toDestroy = this.tilesToDestroy();
    this.breakAlliances(toDestroy);

    for (const tile of toDestroy) {
      const owner = this.mg.owner(tile);
      if (owner.isPlayer()) {
        owner.relinquish(tile);
        owner.removeTroops(
          this.mg
            .config()
            .nukeDeathFactor(owner.troops(), owner.numTilesOwned()),
        );
        owner.removeWorkers(
          this.mg
            .config()
            .nukeDeathFactor(owner.workers(), owner.numTilesOwned()),
        );
        owner.outgoingAttacks().forEach((attack) => {
          const deaths =
            this.mg
              ?.config()
              .nukeDeathFactor(attack.troops(), owner.numTilesOwned()) ?? 0;
          attack.setTroops(attack.troops() - deaths);
        });
        owner.units(UnitType.TransportShip).forEach((attack) => {
          const deaths =
            this.mg
              ?.config()
              .nukeDeathFactor(attack.troops(), owner.numTilesOwned()) ?? 0;
          attack.setTroops(attack.troops() - deaths);
        });
      }

      if (this.mg.isLand(tile)) {
        this.mg.setFallout(tile, true);
      }
    }

    const outer2 = magnitude.outer * magnitude.outer;
    for (const unit of this.mg.units()) {
      if (
        unit.type() !== UnitType.AtomBomb &&
        unit.type() !== UnitType.HydrogenBomb &&
        unit.type() !== UnitType.MIRVWarhead &&
        unit.type() !== UnitType.MIRV
      ) {
        if (this.mg.euclideanDistSquared(this.dst, unit.tile()) < outer2) {
          unit.delete(true, this._owner);
        }
      }
    }
    this.active = false;
    this.nuke?.setReachedTarget();
    this.nuke?.delete(false);

    // Record stats
    this.mg.stats().bombLand(this._owner, this.target(), this.nukeType);
  }

  owner(): Player {
    return this._owner;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
