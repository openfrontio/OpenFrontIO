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
import { simpleHash } from "../Util";
import { NukeExecution } from "./NukeExecution";

export class MirvExecution implements Execution {
  private active = true;

  private mg: Game;

  private nuke: Unit | null = null;

  private range = 1500;
  private rangeSquared = this.range * this.range;
  private minimumSpread = 55;
  private warheadCount = 350;

  private baseX: number;
  private baseY: number;

  private random: PseudoRandom;

  private pathFinder: ParabolaPathFinder;

  private targetPlayer: Player | TerraNullius;

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
    this.targetPlayer = this.mg.owner(this.dst);
    this.speed = this.mg.config().defaultNukeSpeed();

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
    if (this.nuke === null) {
      const spawn = this.player.canBuild(UnitType.MIRV, this.dst);
      if (spawn === false) {
        console.warn(`cannot build MIRV`);
        this.active = false;
        return;
      }
      this.nuke = this.player.buildUnit(UnitType.MIRV, spawn, {
        targetTile: this.dst,
      });
      this.mg.stats().bombLaunch(this.player, this.targetPlayer, UnitType.MIRV);
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
    if (this.nuke === null) {
      throw new Error("uninitialized");
    }

    this.baseX = this.mg.x(this.dst);
    this.baseY = this.mg.y(this.dst);

    const destinations = this.selectDestinations();
    for (const [i, dst] of destinations.entries()) {
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

  private selectDestinations(): TileRef[] {
    const targets: TileRef[] = [this.dst];

    for (let attempt = 0; attempt < 1000; attempt++) {
      const target = this.tryGenerateTarget(targets);
      if (target) targets.push(target);
      if (targets.length >= this.warheadCount) break;
    }

    return targets.sort(
      (a, b) =>
        this.mg.manhattanDist(b, this.dst) - this.mg.manhattanDist(a, this.dst),
    );
  }

  private tryGenerateTarget(taken: TileRef[]): TileRef | undefined {
    for (let attempt = 0; attempt < 100; attempt++) {
      const r1 = this.random.next();
      const r2 = (r1 * 15485863) % 1;

      const x = Math.round(r1 * this.range * 2 - this.range + this.baseX);
      const y = Math.round(r2 * this.range * 2 - this.range + this.baseY);

      if (!this.mg.isValidCoord(x, y)) {
        continue;
      }

      const tile = this.mg.ref(x, y);

      if (!this.mg.isLand(tile)) {
        continue;
      }

      if ((x - this.baseX) ** 2 + (y - this.baseY) ** 2 > this.rangeSquared) {
        continue;
      }

      if (this.mg.owner(tile) !== this.targetPlayer) {
        continue;
      }

      if (this.isOverlapping(x, y, taken)) {
        continue;
      }

      return tile;
    }
  }

  private isOverlapping(x: number, y: number, taken: TileRef[]): boolean {
    for (const existingTile of taken) {
      const existingTileX = this.mg.x(existingTile);
      const existingTileY = this.mg.y(existingTile);
      const manhattanDistance =
        Math.abs(x - existingTileX) + Math.abs(y - existingTileY);

      if (manhattanDistance < this.minimumSpread) {
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
