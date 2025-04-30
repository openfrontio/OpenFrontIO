import { consolex } from "../Consolex";
import {
  Execution,
  Game,
  MessageType,
  NukeType,
  Player,
  PlayerID,
  TerraNullius,
  Unit,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { AirPathFinder } from "../pathfinding/PathFinding";
import { PseudoRandom } from "../PseudoRandom";

export class NukeExecution implements Execution {
  private player: Player;
  private active = true;
  private mg: Game;
  private nuke: Unit;

  private random: PseudoRandom;
  private pathFinder: AirPathFinder;

  constructor(
    private type: NukeType,
    private senderID: PlayerID,
    private dst: TileRef,
    private src?: TileRef,
    private speed: number = -1,
    private waitTicks = 0,
  ) {}

  init(mg: Game, ticks: number): void {
    if (!mg.hasPlayer(this.senderID)) {
      console.warn(`NukeExecution: sender ${this.senderID} not found`);
      this.active = false;
      return;
    }

    this.mg = mg;
    this.player = mg.player(this.senderID);
    this.random = new PseudoRandom(ticks);
    if (this.speed == -1) {
      this.speed = this.mg.config().defaultNukeSpeed();
    }
    this.pathFinder = new AirPathFinder(mg, this.random);
  }

  public target(): Player | TerraNullius {
    return this.mg.owner(this.dst);
  }

  private tilesToDestroy(): Set<TileRef> {
    const magnitude = this.mg.config().nukeMagnitudes(this.nuke.type());
    const rand = new PseudoRandom(this.mg.ticks());
    const inner2 = magnitude.inner * magnitude.inner;
    const outer2 = magnitude.outer * magnitude.outer;
    return this.mg.bfs(this.dst, (_, n: TileRef) => {
      const d2 = this.mg.euclideanDistSquared(this.dst, n);
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
        const alliance = this.player.allianceWith(other);
        if (alliance != null) {
          this.player.breakAlliance(alliance);
        }
        if (other != this.player) {
          other.updateRelation(this.player, -100);
        }
      }
    }
  }

  tick(ticks: number): void {
    if (this.nuke == null) {
      const spawn = this.src ?? this.player.canBuild(this.type, this.dst);
      if (spawn == false) {
        consolex.warn(`cannot build Nuke`);
        this.active = false;
        return;
      }
      this.nuke = this.player.buildUnit(this.type, 0, spawn, {
        detonationDst: this.dst,
      });
      if (this.mg.hasOwner(this.dst)) {
        const target = this.mg.owner(this.dst) as Player;
        if (this.type == UnitType.AtomBomb) {
          this.mg.displayMessage(
            `${this.player.name()} - atom bomb inbound`,
            MessageType.ERROR,
            target.id(),
          );
        }
        if (this.type == UnitType.HydrogenBomb) {
          this.mg.displayMessage(
            `${this.player.name()} - hydrogen bomb inbound`,
            MessageType.ERROR,
            target.id(),
          );
        }

        this.mg
          .stats()
          .increaseNukeCount(
            this.senderID,
            target.id(),
            this.nuke.type() as NukeType,
          );
      }

      // after sending an nuke set the missilesilo on cooldown
      const silo = this.player
        .units(UnitType.MissileSilo)
        .find((silo) => silo.tile() === spawn);
      if (silo) {
        silo.setCooldown(true);
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

    for (let i = 0; i < this.speed; i++) {
      // Move to next tile
      const nextTile = this.pathFinder.nextTile(this.nuke.tile(), this.dst);
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
        if (this.mg.euclideanDistSquared(this.dst, unit.tile()) < outer2) {
          unit.delete();
        }
      }
    }
    this.active = false;
    this.nuke.delete(false);
  }

  owner(): Player {
    return this.player;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
