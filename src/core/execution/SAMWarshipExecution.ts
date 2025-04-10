import { consolex } from "../Consolex";
import {
  Execution,
  Game,
  MessageType,
  Player,
  PlayerID,
  Unit,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { PathFindResultType } from "../pathfinding/AStar";
import { PathFinder } from "../pathfinding/PathFinding";
import { PseudoRandom } from "../PseudoRandom";
import { SAMMissileExecution } from "./SAMMissileExecution";

export class SAMWarshipExecution implements Execution {
  private random: PseudoRandom;

  private player: Player;
  private active: boolean = true;
  private SAMWarship: Unit = null;
  private mg: Game = null;

  private target: Unit = null;
  private pseudoRandom: PseudoRandom;
  private pathfinder: PathFinder;

  private patrolTile: TileRef;

  // TODO: put in config
  private searchRange = 100;

  constructor(
    private playerID: PlayerID,
    private patrolCenterTile: TileRef,
  ) {}

  init(mg: Game, ticks: number): void {
    if (!mg.hasPlayer(this.playerID)) {
      console.log(`SAMWarshipExecution: player ${this.playerID} not found`);
      this.active = false;
      return;
    }
    this.pathfinder = PathFinder.Mini(mg, 5000, false);
    this.player = mg.player(this.playerID);
    this.mg = mg;
    this.patrolTile = this.patrolCenterTile;
    this.random = new PseudoRandom(mg.ticks());
  }

  // Only for warships with "moveTarget" set
  goToMoveTarget(target: TileRef): boolean {
    // Patrol unless we are hunting down a tradeship
    const result = this.pathfinder.nextTile(this.SAMWarship.tile(), target);
    switch (result.type) {
      case PathFindResultType.Completed:
        this.SAMWarship.setMoveTarget(null);
        return;
      case PathFindResultType.NextTile:
        this.SAMWarship.move(result.tile);
        break;
      case PathFindResultType.Pending:
        break;
      case PathFindResultType.PathNotFound:
        consolex.log(`path not found to target`);
        break;
    }
  }

  private patrol() {
    const result = this.pathfinder.nextTile(
      this.SAMWarship.tile(),
      this.patrolTile,
    );
    switch (result.type) {
      case PathFindResultType.Completed:
        this.patrolTile = this.randomTile();
        break;
      case PathFindResultType.NextTile:
        this.SAMWarship.move(result.tile);
        break;
      case PathFindResultType.Pending:
        return;
      case PathFindResultType.PathNotFound:
        consolex.log(`path not found to patrol tile`);
        this.patrolTile = this.randomTile();
        break;
    }
  }

  tick(ticks: number): void {
    if (this.SAMWarship == null) {
      const spawn = this.player.canBuild(UnitType.SAMWarship, this.patrolTile);
      if (spawn == false) {
        this.active = false;
        return;
      }
      this.SAMWarship = this.player.buildUnit(UnitType.SAMWarship, 0, spawn, {
        cooldownDuration: this.mg.config().SAMCooldown(),
      });
      return;
    }

    if (!this.SAMWarship.isActive()) {
      this.active = false;
      return;
    }

    if (!this.pseudoRandom) {
      this.pseudoRandom = new PseudoRandom(this.SAMWarship.id());
    }

    const nukes = this.mg
      .nearbyUnits(this.SAMWarship.tile(), this.searchRange, [
        UnitType.AtomBomb,
        UnitType.HydrogenBomb,
      ])
      .filter(
        ({ unit }) =>
          unit.owner() === this.player && !this.player.isFriendly(unit.owner()),
      );

    this.target =
      nukes.sort((a, b) => {
        const { unit: unitA, distSquared: distA } = a;
        const { unit: unitB, distSquared: distB } = b;

        // Prioritize Hydrogen Bombs
        if (
          unitA.type() === UnitType.HydrogenBomb &&
          unitB.type() !== UnitType.HydrogenBomb
        )
          return -1;
        if (
          unitA.type() !== UnitType.HydrogenBomb &&
          unitB.type() === UnitType.HydrogenBomb
        )
          return 1;

        // If both are the same type, sort by distance (lower `distSquared` means closer)
        return distA - distB;
      })[0]?.unit ?? null;

    if (
      this.SAMWarship.isCooldown() &&
      this.SAMWarship.ticksLeftInCooldown(this.mg.config().SAMCooldown()) == 0
    ) {
      this.SAMWarship.setCooldown(false);
    }

    if (this.SAMWarship.moveTarget()) {
      this.goToMoveTarget(this.SAMWarship.moveTarget());
      // If we have a "move target" then we cannot target trade ships as it
      // requires moving.
    } else {
      this.patrol();
    }

    if (!this.target) {
      return;
    }

    if (!this.SAMWarship.isCooldown() && !this.target.targetedBySAM()) {
      this.SAMWarship.setCooldown(true);
      const random = this.pseudoRandom.next();
      const hit = random < this.mg.config().samHittingChance();
      if (!hit) {
        this.mg.displayMessage(
          `Missile failed to intercept ${this.target.type()}`,
          MessageType.ERROR,
          this.SAMWarship.owner().id(),
        );
      } else {
        this.target.setTargetedBySAM(true);
        this.mg.addExecution(
          new SAMMissileExecution(
            this.SAMWarship.tile(),
            this.SAMWarship.owner(),
            this.SAMWarship,
            this.target,
          ),
        );
      }
    }
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  randomTile(): TileRef {
    while (true) {
      const x =
        this.mg.x(this.patrolCenterTile) +
        this.random.nextInt(-this.searchRange / 2, this.searchRange / 2);
      const y =
        this.mg.y(this.patrolCenterTile) +
        this.random.nextInt(-this.searchRange / 2, this.searchRange / 2);
      if (!this.mg.isValidCoord(x, y)) {
        continue;
      }
      const tile = this.mg.ref(x, y);
      if (!this.mg.isOcean(tile)) {
        continue;
      }
      return tile;
    }
  }
}
