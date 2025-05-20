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

export class WarshipExecution implements Execution {
  private random: PseudoRandom;

  private _owner: Player;
  private active = true;
  private warship: Unit | null = null;
  private mg: Game;

  private target: Unit | undefined = undefined;
  private pathfinder: PathFinder | null = null;

  private patrolTile: TileRef | undefined;

  private lastShellAttack = 0;
  private alreadySentShell = new Set<Unit>();

  constructor(
    private playerID: PlayerID,
    private patrolCenterTile: TileRef,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    if (!mg.hasPlayer(this.playerID)) {
      console.log(`WarshipExecution: player ${this.playerID} not found`);
      this.active = false;
      return;
    }
    this.pathfinder = PathFinder.Mini(mg, 5000);
    this._owner = mg.player(this.playerID);
    this.patrolTile = this.patrolCenterTile;
    this.random = new PseudoRandom(mg.ticks());
  }

  // Only for warships with "moveTarget" set
  goToMoveTarget(target: TileRef) {
    if (this.warship === null || this.pathfinder === null) {
      throw new Error("Warship not initialized");
    }
    // Patrol unless we are hunting down a tradeship
    const result = this.pathfinder.nextTile(this.warship.tile(), target);
    switch (result.type) {
      case PathFindResultType.Completed:
        this.warship.setTargetTile(undefined);
        this.warship.touch();
        return;
      case PathFindResultType.NextTile:
        this.warship.move(result.tile);
        break;
      case PathFindResultType.Pending:
        this.warship.touch();
        break;
      case PathFindResultType.PathNotFound:
        consolex.log(`path not found to target`);
        break;
    }
  }

  private shoot() {
    if (
      this.mg === null ||
      this.warship === null ||
      this.target === undefined
    ) {
      throw new Error("Warship not initialized");
    }
    const shellAttackRate = this.mg.config().warshipShellAttackRate();
    if (this.mg.ticks() - this.lastShellAttack > shellAttackRate) {
      this.lastShellAttack = this.mg.ticks();
      this.mg.addExecution(
        new ShellExecution(
          this.warship.tile(),
          this.warship.owner(),
          this.warship,
          this.target,
        ),
      );
      if (!this.target.hasHealth()) {
        // Don't send multiple shells to target that can be oneshotted
        this.alreadySentShell.add(this.target);
        this.target = undefined;
        return;
      }
    }
  }

  private patrol() {
    if (this.warship === null || this.pathfinder === null) {
      throw new Error("Warship not initialized");
    }
    if (this.patrolTile === undefined) {
      this.patrolTile = this.randomTile();
      if (this.patrolTile === undefined) {
        return;
      }
    }
    this.warship.setTargetUnit(this.target);
    if (
      this.target === undefined ||
      this.target.type() !== UnitType.TradeShip
    ) {
      // Patrol unless we are hunting down a tradeship
      const result = this.pathfinder.nextTile(
        this.warship.tile(),
        this.patrolTile,
      );
      switch (result.type) {
        case PathFindResultType.Completed:
          this.patrolTile = undefined;
          this.warship.touch();
          break;
        case PathFindResultType.NextTile:
          this.warship.move(result.tile);
          break;
        case PathFindResultType.Pending:
          this.warship.touch();
          return;
        case PathFindResultType.PathNotFound:
          consolex.log(`path not found to patrol tile`);
          this.patrolTile = undefined;
          break;
      }
    }
  }

  tick(ticks: number): void {
    if (this.pathfinder === null) throw new Error("Warship not initialized");
    if (this.warship === null) {
      if (this.patrolTile === undefined) {
        console.log(
          `WarshipExecution: no patrol tile for ${this._owner.name()}`,
        );
        this.active = false;
        return;
      }
      const spawn = this._owner.canBuild(UnitType.Warship, this.patrolTile);
      if (spawn === false) {
        this.active = false;
        return;
      }
      this.warship = this._owner.buildUnit(UnitType.Warship, spawn, {});
      return;
    }
    if (!this.warship.isActive()) {
      this.active = false;
      return;
    }
    if (this.target !== undefined && !this.target.isActive()) {
      this.target = undefined;
    }
    const hasPort = this._owner.units(UnitType.Port).length > 0;
    const warship = this.warship;
    if (warship === undefined) throw new Error("Warship not initialized");
    const ships = this.mg
      .nearbyUnits(
        this.warship.tile(),
        this.mg.config().warshipTargettingRange(),
        [UnitType.TransportShip, UnitType.Warship, UnitType.TradeShip],
      )
      .filter(
        ({ unit }) =>
          unit.owner() !== warship.owner() &&
          unit !== warship &&
          !unit.owner().isFriendly(warship.owner()) &&
          !this.alreadySentShell.has(unit) &&
          (unit.type() !== UnitType.TradeShip ||
            (hasPort &&
              this.warship !== null &&
              unit.targetUnit()?.owner() !== this.warship.owner() &&
              !unit.targetUnit()?.owner().isFriendly(this.warship.owner()) &&
              unit.isSafeFromPirates() !== true)),
      );

    this.target = ships.sort((a, b) => {
      const { unit: unitA, distSquared: distA } = a;
      const { unit: unitB, distSquared: distB } = b;

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
    })[0]?.unit;

    const moveTarget = this.warship.targetTile();
    if (moveTarget) {
      this.goToMoveTarget(moveTarget);
      // If we have a "move target" then we cannot target trade ships as it
      // requires moving.
      if (this.target && this.target.type() === UnitType.TradeShip) {
        this.target = undefined;
      }
    } else if (!this.target || this.target.type() !== UnitType.TradeShip) {
      this.patrol();
    }

    if (
      this.target === undefined ||
      !this.target.isActive() ||
      this.target.owner() === this._owner ||
      this.target.isSafeFromPirates() === true
    ) {
      // In case another warship captured or destroyed target, or the target escaped into safe waters
      this.target = undefined;
      return;
    }

    this.warship.setTargetUnit(this.target);

    // If we have a move target we do not want to go after trading ships
    if (!this.target) {
      return;
    }

    if (this.target.type() !== UnitType.TradeShip) {
      this.shoot();
      return;
    }

    for (let i = 0; i < 2; i++) {
      // target is trade ship so capture it.
      const result = this.pathfinder.nextTile(
        this.warship.tile(),
        this.target.tile(),
        5,
      );
      switch (result.type) {
        case PathFindResultType.Completed:
          this._owner.captureUnit(this.target);
          this.target = undefined;
          this.warship.move(this.warship.tile());
          return;
        case PathFindResultType.NextTile:
          this.warship.move(result.tile);
          break;
        case PathFindResultType.Pending:
          this.warship.move(this.warship.tile());
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

  randomTile(allowShoreline: boolean = false): TileRef | undefined {
    if (this.mg === null) {
      throw new Error("Warship not initialized");
    }
    let warshipPatrolRange = this.mg.config().warshipPatrolRange();
    const maxAttemptBeforeExpand: number = 500;
    let attempts: number = 0;
    let expandCount: number = 0;
    while (expandCount < 3) {
      const x =
        this.mg.x(this.patrolCenterTile) +
        this.random.nextInt(-warshipPatrolRange / 2, warshipPatrolRange / 2);
      const y =
        this.mg.y(this.patrolCenterTile) +
        this.random.nextInt(-warshipPatrolRange / 2, warshipPatrolRange / 2);
      if (!this.mg.isValidCoord(x, y)) {
        continue;
      }
      const tile = this.mg.ref(x, y);
      if (
        !this.mg.isOcean(tile) ||
        (!allowShoreline && this.mg.isShoreline(tile))
      ) {
        attempts++;
        if (attempts === maxAttemptBeforeExpand) {
          expandCount++;
          attempts = 0;
          warshipPatrolRange =
            warshipPatrolRange + Math.floor(warshipPatrolRange / 2);
        }
        continue;
      }
      return tile;
    }
    console.warn(
      `Failed to find random tile for warship for ${this._owner.name()}`,
    );
    if (!allowShoreline) {
      // If we failed to find a tile on the ocean, try again but allow shoreline
      return this.randomTile(true);
    }
    return undefined;
  }
}
