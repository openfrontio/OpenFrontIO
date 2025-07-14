import {
  Execution,
  Game,
  MessageType,
  nukeTypes,
  Player,
  Unit,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { ParabolaPathFinder } from "../pathfinding/PathFinding";
import { PseudoRandom } from "../PseudoRandom";
import { simpleHash } from "../Util";
import { NukeExecution } from "./NukeExecution";

export class MirvExecution implements Execution {
  private active = true;

  private mg: Game;

  private nuke: Unit | null = null;

  private mirvRange = 1500;
  private warheadCount = 350;

  private random: PseudoRandom;

  private pathFinder: ParabolaPathFinder;

  private targetPlayer: Player;

  private separateDst: TileRef;

  private speed: number = -1;

  constructor(
    private player: Player,
    private dst: TileRef,
  ) {}

  init(mg: Game, ticks: number): void {
    this.random = new PseudoRandom(mg.ticks() + simpleHash(this.player.id()));
    this.mg = mg;
    this.pathFinder = new ParabolaPathFinder(mg);
    const target = this.mg.owner(this.dst);
    if (!target.isPlayer()) {
      console.warn(`cannot MIRV unowned land`);
      this.active = false;
      return;
    }
    this.targetPlayer = target as Player;
    this.speed = this.mg.config().defaultNukeSpeed();

    // Record stats
    this.mg.stats().bombLaunch(this.player, this.targetPlayer, UnitType.MIRV);
  }

  tick(ticks: number): void {
    if (this.nuke === null) {
      const spawn = this.player.canBuild(UnitType.MIRV, this.dst);
      if (spawn === false) {
        console.warn(`cannot build MIRV`);
        this.active = false;
        return;
      }
      this.nuke = this.player.buildUnit(UnitType.MIRV, spawn, {});
      const x = Math.floor(
        (this.mg.x(this.dst) + this.mg.x(this.mg.x(this.nuke.tile()))) / 2,
      );
      const y = Math.max(0, this.mg.y(this.dst) - 500) + 50;
      this.separateDst = this.mg.ref(x, y);
      this.pathFinder.computeControlPoints(spawn, this.separateDst);

      this.mg.displayIncomingUnit(
        this.nuke.id(),
        // TODO TranslateText
        `⚠️⚠️⚠️ ${this.player.name()} - MIRV INBOUND ⚠️⚠️⚠️`,
        MessageType.MIRV_INBOUND,
        this.targetPlayer.id(),
      );
    }

    const result = this.pathFinder.nextTile(this.speed);
    if (result === true) {
      this.separate();
      this.active = false;
      // Record stats
      this.mg.stats().bombLand(this.player, this.targetPlayer, UnitType.MIRV);
      return;
    } else {
      this.nuke.move(result);
    }
  }

  private separate() {
    if (this.nuke === null) throw new Error("uninitialized");
    const dsts: TileRef[] = [this.dst];
    for (const unit of this.targetPlayer.units()) {
      if (
        unit.type() === UnitType.TradeShip ||
        nukeTypes.includes(unit.type())
      ) {
        continue;
      }
      if (this.isNukeTooCloseToExisting(unit.tile(), dsts)) {
        continue;
      }
      dsts.push(unit.tile());
    }

    let attempts = 1000;
    while (attempts > 0 && dsts.length < this.warheadCount) {
      attempts--;
      const potential = this.randomLand(this.dst, dsts);
      if (potential === null) {
        continue;
      }
      dsts.push(potential);
    }
    dsts.sort(
      (a, b) =>
        this.mg.manhattanDist(b, this.dst) - this.mg.manhattanDist(a, this.dst),
    );
    console.log(`MIRV created: ${dsts.length} warheads`);

    for (const [i, dst] of dsts.entries()) {
      this.mg.addExecution(
        new NukeExecution(
          UnitType.MIRVWarhead,
          this.player,
          dst,
          this.nuke.tile(),
          15 + Math.floor((i / this.warheadCount) * 5),
          this.random.nextInt(0, 15),
        ),
      );
    }
    if (this.targetPlayer.isPlayer()) {
      const alliance = this.player.allianceWith(this.targetPlayer);
      if (alliance !== null) {
        this.player.breakAlliance(alliance);
      }
      if (this.targetPlayer !== this.player) {
        this.targetPlayer.updateRelation(this.player, -100);
      }
    }
    this.nuke.delete(false);
  }

  randomLand(ref: TileRef, taken: TileRef[]): TileRef | null {
    let tries = 0;
    const mirvRange2 = this.mirvRange * this.mirvRange;
    while (tries < 100) {
      tries++;
      const x = this.random.nextInt(
        this.mg.x(ref) - this.mirvRange,
        this.mg.x(ref) + this.mirvRange,
      );
      const y = this.random.nextInt(
        this.mg.y(ref) - this.mirvRange,
        this.mg.y(ref) + this.mirvRange,
      );
      if (!this.mg.isValidCoord(x, y)) {
        continue;
      }
      const tile = this.mg.ref(x, y);
      if (!this.mg.isLand(tile)) {
        continue;
      }
      if (this.mg.euclideanDistSquared(tile, ref) > mirvRange2) {
        continue;
      }
      if (this.mg.owner(tile) !== this.targetPlayer) {
        continue;
      }
      if (this.isNukeTooCloseToExisting(tile, taken)) {
        continue;
      }
      return tile;
    }
    console.log("couldn't find place, giving up");
    return null;
  }

  private isNukeTooCloseToExisting(tile: TileRef, taken: TileRef[]): boolean {
    for (const t of taken) {
      if (this.mg.manhattanDist(tile, t) < 25) {
        return true;
      }
    }
    return false;
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
