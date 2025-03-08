import { consolex } from "../Consolex";
import {
  type Execution,
  type Game,
  MessageType,
  type Player,
  type PlayerID,
  type TerraNullius,
  type Unit,
  UnitType,
} from "../game/Game";
import type { TileRef } from "../game/GameMap";
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

    this.mg
      .stats()
      .increaseNukeCount(
        this.player.id(),
        this.targetPlayer.id(),
        UnitType.MIRV,
      );
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
      const x = Math.floor(Math.floor(this.mg.width() / 2));
      const y = Math.min(this.mg.height(), 50);
      this.separateDst = this.mg.ref(x, y);

      this.mg.displayMessage(
        `⚠️⚠️⚠️ ${this.player.name()} - MIRV LAUNCH DETECTED ⚠️⚠️⚠️`,
        MessageType.ERROR,
        null,
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
      const potential = this.randomLand(dsts);
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

  randomLand(taken: TileRef[]): TileRef | null {
    let tries = 0;
    while (tries < 100) {
      tries++;
      const x = this.random.nextInt(0, this.mg.width());
      const y = this.random.nextInt(0, this.mg.height());
      if (!this.mg.isValidCoord(x, y)) {
        continue;
      }
      console.log(`got coord ${x}, ${y}`);
      const tile = this.mg.ref(x, y);
      if (!this.mg.isLand(tile)) {
        continue;
      }
      const owner = this.mg.owner(tile);
      if (!owner.isPlayer()) {
        continue;
      }
      if (owner == this.player || this.player.allianceWith(owner)) {
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
