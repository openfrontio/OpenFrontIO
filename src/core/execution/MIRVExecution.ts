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
import { BuildExecution } from "./BuildExecution";

export class MirvExecution implements Execution {
  private mg: Game;

  private nuke: Unit;

  private mirvRange = 1500;
  private warheadCount = 350;

  private random: PseudoRandom;

  private pathFinder: AirPathFinder;

  private targetPlayer: Player | TerraNullius;

  private separateDst: TileRef;

  constructor(private mirv: Unit) {}

  init(mg: Game, ticks: number): void {
    this.random = new PseudoRandom(
      mg.ticks() + simpleHash(this.mirv.owner().id()),
    );
    this.mg = mg;
    this.pathFinder = new AirPathFinder(mg, this.random);
    this.targetPlayer = this.mg.owner(this.mirv.detonationDst());

    this.mg
      .stats()
      .increaseNukeCount(
        this.mirv.owner().id(),
        this.targetPlayer.id(),
        UnitType.MIRV,
      );
    this.mg.displayMessage(
      `⚠️⚠️⚠️ ${this.mirv.owner().name()} - MIRV INBOUND ⚠️⚠️⚠️`,
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
        return;
      } else {
        this.nuke.move(result);
      }
    }
  }

  private separate() {
    const dsts: TileRef[] = [this.mirv.detonationDst()];
    let attempts = 1000;
    while (attempts > 0 && dsts.length < this.warheadCount) {
      attempts--;
      const potential = this.randomLand(this.mirv.detonationDst(), dsts);
      if (potential == null) {
        continue;
      }
      dsts.push(potential);
    }
    dsts.sort(
      (a, b) =>
        this.mg.manhattanDist(b, this.mirv.detonationDst()) -
        this.mg.manhattanDist(a, this.mirv.detonationDst()),
    );

    for (const [i, dst] of dsts.entries()) {
      this.mg.addExecution(
        new BuildExecution(this.mirv.owner().id(), dst, UnitType.MIRVWarhead),
      );
    }
    if (this.targetPlayer.isPlayer()) {
      const alliance = this.mirv.owner().allianceWith(this.targetPlayer);
      if (alliance != null) {
        this.mirv.owner().breakAlliance(alliance);
      }
      if (this.targetPlayer != this.mirv.owner()) {
        this.targetPlayer.updateRelation(this.mirv.owner(), -100);
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

  isActive(): boolean {
    return this.mirv.isActive();
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
