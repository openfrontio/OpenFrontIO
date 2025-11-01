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

  private mirvRange = 1500;
  private warheadCount = 350;

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
    // Pass the map wrapping flags into the ParabolaPathFinder so MIRV paths
    // account for maps that wrap horizontally and/or vertically.
    this.pathFinder = new ParabolaPathFinder(
      mg,
      mg.wrapsHorizontally(),
      mg.wrapsVertically(),
    );
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
      // Compute a midpoint (separateDst) between spawn and dst, but choose the
      // wrapped image of dst that yields the shortest displacement from spawn.
      const spawnX = this.mg.x(spawn);
      const spawnY = this.mg.y(spawn);
      let dstX = this.mg.x(this.dst);
      let dstY = this.mg.y(this.dst);
      const w = this.mg.width();
      const h = this.mg.height();

      if (this.mg.wrapsHorizontally()) {
        const rawDx = dstX - spawnX;
        const altDx1 = dstX - w - spawnX; // wrapped left
        const altDx2 = dstX + w - spawnX; // wrapped right
        const bestDx =
          Math.abs(rawDx) <= Math.abs(altDx1) &&
          Math.abs(rawDx) <= Math.abs(altDx2)
            ? rawDx
            : Math.abs(altDx1) <= Math.abs(altDx2)
              ? altDx1
              : altDx2;
        dstX = spawnX + bestDx;
      }

      if (this.mg.wrapsVertically()) {
        const rawDy = dstY - spawnY;
        const altDy1 = dstY - h - spawnY; // wrapped up
        const altDy2 = dstY + h - spawnY; // wrapped down
        const bestDy =
          Math.abs(rawDy) <= Math.abs(altDy1) &&
          Math.abs(rawDy) <= Math.abs(altDy2)
            ? rawDy
            : Math.abs(altDy1) <= Math.abs(altDy2)
              ? altDy1
              : altDy2;
        dstY = spawnY + bestDy;
      }

      const midX = Math.floor((spawnX + dstX) / 2);
      const midY = Math.max(0, Math.floor(dstY) - 500) + 50;

      // Fold midpoint back into map coordinates if necessary
      let finalX = midX;
      let finalY = midY;
      if (this.mg.wrapsHorizontally()) {
        finalX = ((finalX % w) + w) % w;
      }
      if (this.mg.wrapsVertically()) {
        finalY = ((finalY % h) + h) % h;
      }

      this.separateDst = this.mg.ref(finalX, finalY);
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
    dsts.sort(
      (a, b) =>
        this.mg.manhattanDist(b, this.dst) - this.mg.manhattanDist(a, this.dst),
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
