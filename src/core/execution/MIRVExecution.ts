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
import { AirPathFinder } from "../pathfinding/PathFinding";
import { PseudoRandom } from "../PseudoRandom";
import { simpleHash } from "../Util";
import { NukeExecution } from "./NukeExecution";

export class MirvExecution implements Execution {
  private active = true;

  private mg: Game;

  private mirvRange = 1500;
  private warheadCount = 350;

  private random: PseudoRandom;

  private pathFinder: AirPathFinder;

  private targetPlayer: Player | TerraNullius;

  private separateDst: TileRef;

  constructor(private nuke: Unit) {}

  init(mg: Game, ticks: number): void {
    this.random = new PseudoRandom(
      mg.ticks() + simpleHash(this.nuke.owner().id()),
    );
    this.mg = mg;
    this.pathFinder = new AirPathFinder(mg, this.random);
    this.targetPlayer = this.mg.owner(this.nuke.detonationDst());

    this.mg
      .stats()
      .increaseNukeCount(
        this.nuke.owner().id(),
        this.targetPlayer.id(),
        UnitType.MIRV,
      );

    this.mg.displayMessage(
      `⚠️⚠️⚠️ ${this.nuke.owner().name()} - MIRV INBOUND ⚠️⚠️⚠️`,
      MessageType.ERROR,
      this.targetPlayer.id(),
    );
  }

  tick(ticks: number): void {
    for (let i = 0; i < 4; i++) {
      const result = this.pathFinder.nextTile(
        this.nuke.tile(),
        this.separateDst,
      );
      if (result === true) {
        this.separate();
        this.active = false;
        return;
      } else {
        this.nuke.move(result);
      }
    }
  }

  private separate() {
    const dsts: TileRef[] = [this.nuke.detonationDst()];
    let attempts = 1000;
    while (attempts > 0 && dsts.length < this.warheadCount) {
      attempts--;
      const potential = this.randomLand(this.nuke.detonationDst(), dsts);
      if (potential == null) {
        continue;
      }
      dsts.push(potential);
    }
    console.log(`dsts: ${dsts.length}`);
    dsts.sort(
      (a, b) =>
        this.mg.manhattanDist(b, this.nuke.detonationDst()) -
        this.mg.manhattanDist(a, this.nuke.detonationDst()),
    );

    for (const [i, dst] of dsts.entries()) {
      this.mg.addExecution(
        new NukeExecution(
          this.nuke.owner().buildUnit({
            type: UnitType.MIRVWarhead,
            detonationDst: dst,
            dstTile: this.nuke.tile(),
          }),
          15 + Math.floor((i / this.warheadCount) * 5),
          //   this.random.nextInt(5, 9),
          this.random.nextInt(0, 15),
        ),
      );
    }
    if (this.targetPlayer.isPlayer()) {
      const alliance = this.nuke.owner().allianceWith(this.targetPlayer);
      if (alliance != null) {
        this.nuke.owner().breakAlliance(alliance);
      }
      if (this.targetPlayer != this.nuke.owner()) {
        this.targetPlayer.updateRelation(this.nuke.owner(), -100);
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
      if (this.mg.owner(tile) != this.targetPlayer) {
        continue;
      }
      for (const t of taken) {
        if (this.mg.manhattanDist(tile, t) < 25) {
          continue;
        }
      }
      return tile;
    }
    console.log("couldn't find place, giving up");
    return null;
  }

  owner(): Player {
    return this.nuke.owner();
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
