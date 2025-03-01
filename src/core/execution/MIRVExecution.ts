import { consolex } from "../Consolex";
import {
  Execution,
  Game,
  MessageType,
  Player,
  PlayerID,
  TerraNullius,
  Unit,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { PathFindResultType } from "../pathfinding/AStar";
import { PathFinder } from "../pathfinding/PathFinding";
import { PseudoRandom } from "../PseudoRandom";
import { simpleHash } from "../Util";
import { NukeExecution } from "./NukeExecution";

export class MirvExecution implements Execution {
  private player: Player;

  private active = true;

  private mg: Game;

  private nuke: Unit;

  private mirvRange = 1500;
  private warheadCount = 350;

  private random: PseudoRandom;

  private pathFinder: PathFinder;

  private targetPlayer: Player | TerraNullius;

  private separateDst: TileRef;

  constructor(
    private senderID: PlayerID,
    private dst: TileRef,
  ) {}

  init(mg: Game, ticks: number): void {
    if (!mg.hasPlayer(this.senderID)) {
      console.warn(`MIRVExecution: player ${this.senderID} not found`);
      this.active = false;
      return;
    }

    this.random = new PseudoRandom(mg.ticks() + simpleHash(this.senderID));
    this.mg = mg;
    this.pathFinder = PathFinder.Mini(mg, 10_000, true);
    this.player = mg.player(this.senderID);
    this.targetPlayer = this.mg.owner(this.dst);
  }

  tick(ticks: number): void {
    if (this.nuke == null) {
      const spawn = this.player.canBuild(UnitType.MIRV, this.dst);
      if (spawn == false) {
        consolex.warn(`cannot build MIRV`);
        this.active = false;
        return;
      }
      this.nuke = this.player.buildUnit(UnitType.MIRV, 0, spawn);
      const x = Math.floor(
        (this.mg.x(this.dst) + this.mg.x(this.mg.x(this.nuke.tile()))) / 2,
      );
      const y = Math.max(0, this.mg.y(this.dst) - 500) + 50;
      this.separateDst = this.mg.ref(x, y);

      this.mg.displayMessage(
        `⚠️⚠️⚠️ ${this.player.name()} - MIRV INBOUND ⚠️⚠️⚠️`,
        MessageType.ERROR,
        this.targetPlayer.id(),
      );
    }

    for (let i = 0; i < 4; i++) {
      const result = this.pathFinder.nextTile(
        this.nuke.tile(),
        this.separateDst,
      );
      switch (result.type) {
        case PathFindResultType.Completed:
          this.nuke.move(result.tile);
          this.separate();
          this.active = false;
          return;
        case PathFindResultType.NextTile:
          this.nuke.move(result.tile);
          break;
        case PathFindResultType.Pending:
          break;
        case PathFindResultType.PathNotFound:
          consolex.warn(
            `nuke cannot find path from ${this.nuke.tile()} to ${this.dst}`,
          );
          this.active = false;
          return;
      }
    }
  }

  private separate() {
    const dsts: TileRef[] = [this.dst];
    let attempts = 1000;
    while (attempts > 0 && dsts.length < this.warheadCount) {
      attempts--;
      const potential = this.randomLand(this.dst, dsts);
      if (potential == null) {
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
          this.senderID,
          dst,
          this.nuke.tile(),
          15 + Math.floor((i / this.warheadCount) * 5),
          //   this.random.nextInt(5, 9),
          this.random.nextInt(0, 15),
        ),
      );
    }
    if (this.targetPlayer.isPlayer()) {
      const alliance = this.player.allianceWith(this.targetPlayer);
      if (alliance != null) {
        this.player.breakAlliance(alliance);
      }
      if (this.targetPlayer != this.player) {
        this.targetPlayer.updateRelation(this.player, -100);
      }
    }
    this.nuke.delete(false);
  }

  randomLand(ref: TileRef, taken: TileRef[]): TileRef | null {
    let tries = 0;
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
      console.log(`got coord ${x}, ${y}`);
      const tile = this.mg.ref(x, y);
      if (!this.mg.isLand(tile)) {
        continue;
      }
      if (this.mg.euclideanDist(tile, ref) > this.mirvRange) {
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
    console.log("could find place giving up");
    return null;
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
