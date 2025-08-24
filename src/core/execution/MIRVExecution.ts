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
import { PseudoRandom } from "../PseudoRandom";
import { ParabolaPathFinder } from "../pathfinding/PathFinding";
import { simpleHash } from "../Util";
import { NukeExecution } from "./NukeExecution";

export class MirvExecution implements Execution {
  private active = true;

  private mg: Game | undefined;

  private nuke: Unit | null = null;

  private readonly mirvRange = 1500;
  private readonly warheadCount = 350;

  private random: PseudoRandom | undefined;

  private pathFinder: ParabolaPathFinder | undefined;

  private targetPlayer: Player | TerraNullius | undefined;

  private separateDst: TileRef | undefined;

  private speed = -1;

  constructor(
    private readonly player: Player,
    private readonly dst: TileRef,
  ) {}

  init(mg: Game, ticks: number): void {
    this.random = new PseudoRandom(mg.ticks() + simpleHash(this.player.id()));
    this.mg = mg;
    this.pathFinder = new ParabolaPathFinder(mg);
    this.targetPlayer = this.mg.owner(this.dst);
    this.speed = this.mg.config().defaultNukeSpeed();

    // Record stats
    this.mg.stats().bombLaunch(this.player, this.targetPlayer, UnitType.MIRV);

    // Betrayal on launch
    if (this.targetPlayer.isPlayer()) {
      const alliance = this.player.allianceWith(this.targetPlayer);
      if (alliance !== null) {
        this.player.breakAlliance(alliance);
      }
      if (this.targetPlayer !== this.player) {
        this.targetPlayer.updateRelation(this.player, -100);
      }
    }
  }

  tick(ticks: number): void {
    if (this.mg === undefined) throw new Error("Not initialized");
    if (this.pathFinder === undefined) throw new Error("Not initialized");
    if (this.targetPlayer === undefined) throw new Error("Not initialized");
    if (this.nuke === null) {
      const spawn = this.player.canBuild(UnitType.MIRV, this.dst);
      if (spawn === false) {
        console.warn("cannot build MIRV");
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
    if (this.mg === undefined) throw new Error("Not initialized");
    if (this.random === undefined) throw new Error("Not initialized");
    if (this.nuke === null) throw new Error("Not initialized");
    const dsts: TileRef[] = [this.dst];
    let attempts = 1000;
    while (attempts > 0 && dsts.length < this.warheadCount) {
      attempts--;
      const potential = this.randomLand(this.dst, dsts);
      if (potential === null) {
        continue;
      }
      dsts.push(potential);
    }
    console.log(`dsts: ${dsts.length}`);
    const game = this.mg;
    dsts.sort(
      (a, b) =>
        game.manhattanDist(b, this.dst) - game.manhattanDist(a, this.dst),
    );
    console.log(`got ${dsts.length} dsts!!`);

    for (const [i, dst] of dsts.entries()) {
      this.mg.addExecution(
        new NukeExecution(
          UnitType.MIRVWarhead,
          this.player,
          dst,
          this.nuke.tile(),
          15 + Math.floor((i / this.warheadCount) * 5),
          //   this.random.nextInt(5, 9),
          this.random.nextInt(0, 15),
        ),
      );
    }
    this.nuke.delete(false);
  }

  randomLand(ref: TileRef, taken: TileRef[]): TileRef | null {
    if (this.mg === undefined) throw new Error("Not initialized");
    if (this.random === undefined) throw new Error("Not initialized");
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
      if (this.proximityCheck(tile, taken)) {
        continue;
      }
      return tile;
    }
    console.log("couldn't find place, giving up");
    return null;
  }

  private proximityCheck(tile: TileRef, taken: TileRef[]): boolean {
    if (this.mg === undefined) throw new Error("Not initialized");
    for (const t of taken) {
      if (this.mg.manhattanDist(tile, t) < 55) {
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
