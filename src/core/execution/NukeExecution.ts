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
import { PseudoRandom } from "../PseudoRandom";

export class NukeExecution implements Execution {
  private player: Player;
  private active = true;
  private mg: Game;
  private nuke: Unit;

  private random: PseudoRandom;

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
  }

  public target(): Player | TerraNullius {
    return this.mg.owner(this.dst);
  }

  private tilesToDestroy(): Set<TileRef> {
    const magnitude = this.mg.config().nukeMagnitudes(this.nuke.type());
    const rand = new PseudoRandom(this.mg.ticks());
    return this.mg.bfs(this.dst, (_, n: TileRef) => {
      const d = this.mg.euclideanDist(this.dst, n);
      return (d <= magnitude.inner || rand.chance(2)) && d <= magnitude.outer;
    });
  }

  private getAttackedTiles() {
    const toDestroy = this.tilesToDestroy();

    const attacked = new Map<Player, number>();
    for (const tile of toDestroy) {
      const owner = this.mg.owner(tile);
      if (owner.isPlayer()) {
        const mp = this.mg.player(owner.id());
        const prev = attacked.get(mp) ?? 0;
        attacked.set(mp, prev + 1);
      }
    }

    return attacked;
  }

  private breakAlliances() {
    for (const [other, tilesDestroyed] of this.getAttackedTiles()) {
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

    this.breakAlliances();

    if (this.waitTicks > 0) {
      this.waitTicks--;
      return;
    }

    const r = (this.mg.y(this.dst) * this.mg.x(this.dst)) % 10;
    const s = this.speed + (this.mg.ticks() % r);

    for (let i = 0; i < this.speed; i++) {
      const x = this.mg.x(this.nuke.tile());
      const y = this.mg.y(this.nuke.tile());
      const dstX = this.mg.x(this.dst);
      const dstY = this.mg.y(this.dst);

      // If we've reached the destination, detonate
      if (x === dstX && y === dstY) {
        this.detonate();
        return;
      }

      // Calculate next position
      let nextX = x;
      let nextY = y;

      const ratio = Math.floor(
        1 + Math.abs(dstY - y) / (Math.abs(dstX - x) + 1),
      );

      if (this.random.chance(ratio) && x != dstX) {
        if (x < dstX) nextX++;
        else if (x > dstX) nextX--;
      } else {
        if (y < dstY) nextY++;
        else if (y > dstY) nextY--;
      }

      // Move to next tile
      const nextTile = this.mg.ref(nextX, nextY);
      if (nextTile !== undefined) {
        this.nuke.move(nextTile);
      } else {
        consolex.warn(`invalid tile position ${nextX},${nextY}`);
        this.active = false;
        return;
      }
    }
  }

  private detonate() {
    const magnitude = this.mg.config().nukeMagnitudes(this.nuke.type());
    const toDestroy = this.tilesToDestroy();

    for (const tile of toDestroy) {
      const owner = this.mg.owner(tile);
      if (owner.isPlayer()) {
        const mp = this.mg.player(owner.id());
        mp.relinquish(tile);
        mp.removeTroops(
          this.mg.config().nukeDeathFactor(mp.troops(), mp.numTilesOwned()),
        );
        mp.removeWorkers(
          this.mg.config().nukeDeathFactor(mp.workers(), mp.numTilesOwned()),
        );
        mp.outgoingAttacks().forEach((attack) => {
          const deaths = this.mg
            .config()
            .nukeDeathFactor(attack.troops(), mp.numTilesOwned());
          attack.setTroops(attack.troops() - deaths);
        });
        mp.units(UnitType.TransportShip).forEach((attack) => {
          const deaths = this.mg
            .config()
            .nukeDeathFactor(attack.troops(), mp.numTilesOwned());
          attack.setTroops(attack.troops() - deaths);
        });
      }

      if (this.mg.isLand(tile)) {
        this.mg.setFallout(tile, true);
      }
    }

    for (const unit of this.mg.units()) {
      if (
        unit.type() != UnitType.AtomBomb &&
        unit.type() != UnitType.HydrogenBomb &&
        unit.type() != UnitType.MIRVWarhead &&
        unit.type() != UnitType.MIRV
      ) {
        if (this.mg.euclideanDist(this.dst, unit.tile()) < magnitude.outer) {
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
