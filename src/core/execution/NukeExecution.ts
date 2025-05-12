import { consolex } from "../Consolex";
import {
  Execution,
  Game,
  MessageType,
  NukeType,
  Player,
  Unit,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { AirPathFinder } from "../pathfinding/PathFinding";
import { PseudoRandom } from "../PseudoRandom";

export class NukeExecution implements Execution {
  private mg: Game;

  private random: PseudoRandom;
  private pathFinder: AirPathFinder;

  constructor(
    private nuke: Unit,
    private speed: number = -1,
    private waitTicks = 0,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    this.random = new PseudoRandom(ticks);
    if (this.speed == -1) {
      this.speed = this.mg.config().defaultNukeSpeed();
    }
    this.pathFinder = new AirPathFinder(mg, this.random);

    if (this.mg.hasOwner(this.nuke.detonationDst())) {
      const target = this.mg.owner(this.nuke.detonationDst()) as Player;
      if (this.nuke.type() == UnitType.AtomBomb) {
        this.mg.displayMessage(
          `${this.nuke.owner().name()} - atom bomb inbound`,
          MessageType.ERROR,
          target.id(),
        );
      }
      if (this.nuke.type() == UnitType.HydrogenBomb) {
        this.mg.displayMessage(
          `${this.nuke.owner().name()} - hydrogen bomb inbound`,
          MessageType.ERROR,
          target.id(),
        );
      }

      this.mg
        .stats()
        .increaseNukeCount(
          this.nuke.owner().id(),
          target.id(),
          this.nuke.type() as NukeType,
        );
    }

    // after sending an nuke set the missilesilo on cooldown
    const silo = this.nuke
      .owner()
      .units(UnitType.MissileSilo)
      .find((silo) => silo.tile() === this.nuke.tile());
    if (silo) {
      silo.setCooldown(true);
    }
    return;
  }

  private tilesToDestroy(): Set<TileRef> {
    const magnitude = this.mg.config().nukeMagnitudes(this.nuke.type());
    const rand = new PseudoRandom(this.mg.ticks());
    const inner2 = magnitude.inner * magnitude.inner;
    const outer2 = magnitude.outer * magnitude.outer;
    return this.mg.bfs(this.nuke.detonationDst(), (_, n: TileRef) => {
      const d2 = this.mg.euclideanDistSquared(this.nuke.detonationDst(), n);
      return d2 <= outer2 && (d2 <= inner2 || rand.chance(2));
    });
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
      if (tilesDestroyed > 100 && this.nuke.type() != UnitType.MIRVWarhead) {
        // Mirv warheads shouldn't break alliances
        const alliance = this.nuke.owner().allianceWith(other);
        if (alliance != null) {
          this.nuke.owner().breakAlliance(alliance);
        }
        if (other != this.nuke.owner()) {
          other.updateRelation(this.nuke.owner(), -100);
        }
      }
    }
  }

  tick(ticks: number): void {
    // make the nuke unactive if it was intercepted
    if (!this.nuke.isActive()) {
      consolex.log(`Nuke destroyed before reaching target`);
      return;
    }

    if (this.waitTicks > 0) {
      this.waitTicks--;
      return;
    }

    for (let i = 0; i < this.speed; i++) {
      // Move to next tile
      const nextTile = this.pathFinder.nextTile(
        this.nuke.tile(),
        this.nuke.detonationDst(),
      );
      if (nextTile === true) {
        this.detonate();
        return;
      } else {
        this.nuke.move(nextTile);
      }
    }
  }

  private detonate() {
    const magnitude = this.mg.config().nukeMagnitudes(this.nuke.type());
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
          const deaths = this.mg
            .config()
            .nukeDeathFactor(attack.troops(), owner.numTilesOwned());
          attack.setTroops(attack.troops() - deaths);
        });
        owner.units(UnitType.TransportShip).forEach((attack) => {
          const deaths = this.mg
            .config()
            .nukeDeathFactor(attack.troops(), owner.numTilesOwned());
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
        unit.type() != UnitType.AtomBomb &&
        unit.type() != UnitType.HydrogenBomb &&
        unit.type() != UnitType.MIRVWarhead &&
        unit.type() != UnitType.MIRV
      ) {
        if (
          this.mg.euclideanDistSquared(this.nuke.detonationDst(), unit.tile()) <
          outer2
        ) {
          unit.delete();
        }
      }
    }
    this.nuke.delete(false);
  }

  owner(): Player {
    return this.nuke.owner();
  }

  isActive(): boolean {
    return this.nuke.isActive();
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
