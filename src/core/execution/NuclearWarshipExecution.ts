import { consolex } from "../Consolex";
import {
  Execution,
  Game,
  Player,
  PlayerID,
  Unit,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { PathFindResultType } from "../pathfinding/AStar";
import { PathFinder } from "../pathfinding/PathFinding";
import { PseudoRandom } from "../PseudoRandom";
import { ShellExecution } from "./ShellExecution";

export class NuclearWarshipExecution implements Execution {
  private random: PseudoRandom;

  private player: Player;
  private active = true;
  private nuclearWarship: Unit = null;
  private mg: Game = null;

  private target: Unit = null;
  private pathfinder: PathFinder;

  private patrolTile: TileRef;

  // TODO: put in config
  private searchRange = 100;

  private shellAttackRate = 5;
  private lastShellAttack = 0;

  private alreadySentShell = new Set<Unit>();

  constructor(
    private playerID: PlayerID,
    private patrolCenterTile: TileRef,
  ) {}

  init(mg: Game, ticks: number): void {
    if (!mg.hasPlayer(this.playerID)) {
      console.log(`NuclearWarshipExecution: player ${this.playerID} not found`);
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
    const result = this.pathfinder.nextTile(this.nuclearWarship.tile(), target);
    switch (result.type) {
      case PathFindResultType.Completed:
        this.nuclearWarship.setMoveTarget(null);
        return;
      case PathFindResultType.NextTile:
        this.nuclearWarship.move(result.tile);
        break;
      case PathFindResultType.Pending:
        break;
      case PathFindResultType.PathNotFound:
        consolex.log(`path not found to target`);
        break;
    }
  }

  private shoot() {
    if (this.mg.ticks() - this.lastShellAttack > this.shellAttackRate) {
      this.lastShellAttack = this.mg.ticks();
      this.mg.addExecution(
        new ShellExecution(
          this.nuclearWarship.tile(),
          this.nuclearWarship.owner(),
          this.nuclearWarship,
          this.target,
        ),
      );
      if (!this.target.hasHealth()) {
        // Don't send multiple shells to target that can be oneshotted
        this.alreadySentShell.add(this.target);
        this.target = null;
        return;
      }
    }
  }

  private patrol() {
    this.nuclearWarship.setWarshipTarget(this.target);
    if (this.target == null || this.target.type() != UnitType.TradeShip) {
      // Patrol unless we are hunting down a tradeship
      const result = this.pathfinder.nextTile(
        this.nuclearWarship.tile(),
        this.patrolTile,
      );
      switch (result.type) {
        case PathFindResultType.Completed:
          this.patrolTile = this.randomTile();
          break;
        case PathFindResultType.NextTile:
          this.nuclearWarship.move(result.tile);
          break;
        case PathFindResultType.Pending:
          return;
        case PathFindResultType.PathNotFound:
          consolex.log(`path not found to patrol tile`);
          this.patrolTile = this.randomTile();
          break;
      }
    }
  }

  tick(ticks: number): void {
    if (this.nuclearWarship == null) {
      const spawn = this.player.canBuild(
        UnitType.NuclearWarship,
        this.patrolTile,
      );
      if (spawn == false) {
        this.active = false;
        return;
      }
      this.nuclearWarship = this.player.buildUnit(
        UnitType.NuclearWarship,
        0,
        spawn,
        {
          cooldownDuration: this.mg.config().SiloCooldown(),
        },
      );
      return;
    }
    if (!this.nuclearWarship.isActive()) {
      this.active = false;
      return;
    }
    if (this.target != null && !this.target.isActive()) {
      this.target = null;
    }
    const hasPort = this.player.units(UnitType.Port).length > 0;
    const ships = this.mg
      .nearbyUnits(
        this.nuclearWarship.tile(),
        130, // Search range
        [UnitType.TransportShip, UnitType.NuclearWarship, UnitType.TradeShip],
      )
      .filter(
        ({ unit }) =>
          unit.owner() !== this.nuclearWarship.owner() &&
          unit !== this.nuclearWarship &&
          !unit.owner().isFriendly(this.nuclearWarship.owner()) &&
          !this.alreadySentShell.has(unit) &&
          (unit.type() !== UnitType.TradeShip || hasPort) &&
          (unit.type() !== UnitType.TradeShip ||
            unit.dstPort()?.owner() !== this.player),
      );
    console.log(this.nuclearWarship.isCooldown());
    if (
      this.nuclearWarship.isCooldown() &&
      this.nuclearWarship.ticksLeftInCooldown(
        this.mg.config().SiloCooldown(),
      ) == 0
    ) {
      this.nuclearWarship.setCooldown(false);
    }
    this.target =
      ships.sort((a, b) => {
        const { unit: unitA, distSquared: distA } = a;
        const { unit: unitB, distSquared: distB } = b;

        // Prioritize Nuclear Warships
        if (
          unitA.type() === UnitType.NuclearWarship &&
          unitB.type() !== UnitType.NuclearWarship
        )
          return -1;
        if (
          unitA.type() !== UnitType.NuclearWarship &&
          unitB.type() === UnitType.NuclearWarship
        )
          return 1;

        // Prioritize Warships
        if (
          unitA.type() === UnitType.Warship &&
          unitB.type() !== UnitType.Warship
        )
          return -1;
        if (
          unitA.type() !== UnitType.Warship &&
          unitB.type() === UnitType.Warship
        )
          return 1;

        // Then favor Transport Ships over Trade Ships
        if (
          unitA.type() === UnitType.TransportShip &&
          unitB.type() !== UnitType.TransportShip
        )
          return -1;
        if (
          unitA.type() !== UnitType.TransportShip &&
          unitB.type() === UnitType.TransportShip
        )
          return 1;

        // If both are the same type, sort by distance (lower `distSquared` means closer)
        return distA - distB;
      })[0]?.unit ?? null;

    if (this.nuclearWarship.moveTarget()) {
      this.goToMoveTarget(this.nuclearWarship.moveTarget());
      // If we have a "move target" then we cannot target trade ships as it
      // requires moving.
      if (this.target && this.target.type() == UnitType.TradeShip) {
        this.target = null;
      }
    } else if (!this.target || this.target.type() != UnitType.TradeShip) {
      this.patrol();
    }

    if (
      this.target == null ||
      !this.target.isActive() ||
      this.target.owner() == this.player
    ) {
      // In case another destroyer captured or destroyed target
      this.target = null;
      return;
    }

    this.nuclearWarship.setWarshipTarget(this.target);

    // If we have a move target we do not want to go after trading ships
    if (!this.target) {
      return;
    }

    if (this.target.type() != UnitType.TradeShip) {
      this.shoot();
      return;
    }

    for (let i = 0; i < 2; i++) {
      // target is trade ship so capture it.
      const result = this.pathfinder.nextTile(
        this.nuclearWarship.tile(),
        this.target.tile(),
        5,
      );
      switch (result.type) {
        case PathFindResultType.Completed:
          this.player.captureUnit(this.target);
          this.target = null;
          return;
        case PathFindResultType.NextTile:
          this.nuclearWarship.move(result.tile);
          break;
        case PathFindResultType.Pending:
          break;
        case PathFindResultType.PathNotFound:
          consolex.log(`path not found to target`);
          break;
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
