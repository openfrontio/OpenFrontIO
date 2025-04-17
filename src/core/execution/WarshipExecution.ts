import { consolex } from "../Consolex";
import {
  Execution,
  Game,
  Player,
  PlayerID,
  Speed,
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
  private warship: Unit = null;
  private mg: Game = null;

  private target: Unit = null;
  private pathfinder: PathFinder;

  private patrolTile: TileRef;
  private patrolRange: number;
  private speed: Speed;
  private atTargetDist: number;
  private fireRange: number;
  private fireRate: number;
  private lastShellAttack = 0;
  private alreadySentShell = new Set<Unit>();

  constructor(
    private playerID: PlayerID,
    private patrolCenterTile: TileRef,
  ) {}

  init(mg: Game, ticks: number): void {
    if (!mg.hasPlayer(this.playerID)) {
      console.log(`WarshipExecution: player ${this.playerID} not found`);
      this.active = false;
      return;
    }
    this.pathfinder = PathFinder.Mini(mg, 5000, false);
    this._owner = mg.player(this.playerID);
    this.mg = mg;
    this.patrolTile = this.patrolCenterTile;
    this.random = new PseudoRandom(mg.ticks());
    this.patrolRange = this.mg.config().unitInfo(UnitType.Warship).patrolRange;
    this.fireRange = this.mg.config().unitInfo(UnitType.Warship).fireRange;
    this.fireRate = this.mg.config().unitInfo(UnitType.Warship).fireRate;
    this.speed = this.mg.config().unitInfo(UnitType.Warship).speed;
    this.atTargetDist = this.mg
      .config()
      .unitInfo(UnitType.Warship).atTargetDist;
  }

  // Only for warships with "moveTarget" set

  tick(ticks: number): void {
    // create warship unit if not extant, uncreate if not active
    if (this.warship == null) {
      const spawn = this._owner.canBuild(UnitType.Warship, this.patrolTile);
      if (spawn == false) {
        this.active = false;
        return;
      }
      this.warship = this._owner.buildUnit(UnitType.Warship, 0, spawn);
      return;
    }
    if (!this.warship.isActive()) {
      this.active = false;
      return;
    }

    // check the many conditions under which target should be nulled
    if (this.target != null && !this.target.isActive()) {
      this.target = null;
    }
    if (
      this.target &&
      this.target.type() == UnitType.TradeShip &&
      this.warship.moveTarget()
    ) {
      // warship assigned moveTarget, target is tradeship
      this.target = null;
    }

    if (
      this.target == null ||
      !this.target.isActive() ||
      this.target.owner() == this._owner ||
      this.target.isSafeFromPirates() == true
    ) {
      // target was captured, destroyed, or escaped into safe waters
      this.target = null;
    }

    this.acquireTarget();
    this.warship.setWarshipTarget(this.target);

    if (this.target.type() == UnitType.TradeShip) {
      this.patrolTile = null;
    } else if (this.target != null) {
      this.shoot();
    }

    const moveResult: PathFindResultType = this.moveDuringTick(this.evalDst());

    switch (moveResult) {
      case PathFindResultType.Completed:
        // target was tradeship, capture it.
        if (this.target && this.target.type() == UnitType.TradeShip) {
          this._owner.captureUnit(this.target);
          this.target = null;
        }
        // arrived at moveTarget, clear it
        if (this.warship.moveTarget) {
          this.warship.setMoveTarget(null);
        }
        break;

      case PathFindResultType.PathNotFound:
        consolex.log(`path not found to target tile`);
    }
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  private acquireTarget(): void {
    const hasPort = this._owner.units(UnitType.Port).length > 0;

    const ships = this.mg
      .nearbyUnits(this.warship.tile(), this.fireRange, [
        UnitType.TransportShip,
        UnitType.Warship,
        UnitType.TradeShip,
      ])
      .filter(
        ({ unit }) =>
          unit.owner() !== this.warship.owner() &&
          unit !== this.warship &&
          !unit.owner().isFriendly(this.warship.owner()) &&
          !this.alreadySentShell.has(unit) &&
          (unit.type() !== UnitType.TradeShip ||
            (hasPort &&
              unit.dstPort()?.owner() !== this.warship.owner() &&
              !unit.dstPort()?.owner().isFriendly(this.warship.owner()) &&
              unit.isSafeFromPirates() !== true &&
              this.warship.moveTarget == null)),
      );

    ships.sort((a, b) => {
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
    });

    this.target = ships[0]?.unit ?? null;
  }

  private shoot() {
    if (this.mg.ticks() - this.lastShellAttack > this.fireRate) {
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
        this.target = null;
        return;
      }
    }
  }

  private evalDst(): TileRef {
    if (this.warship.moveTarget()) {
      this.patrolTile = null;
      return this.warship.moveTarget();
    }
    if (this.target.type() == UnitType.TradeShip) {
      this.patrolTile = null;
      return this.target.tile();
    }
    this.patrolTile = this.randomTile();
    return this.patrolTile;
  }

  private moveDuringTick(dst: TileRef): PathFindResultType | null {
    for (let i = 1; i < this.speed.tilesPerTick; i++) {
      const result = this.pathfinder.nextTile(
        this.warship.tile(),
        dst,
        this.atTargetDist,
      );
      switch (result.type) {
        case PathFindResultType.NextTile:
          this.warship.move(result.tile);
          break;
        case PathFindResultType.Pending:
          break;
        case PathFindResultType.Completed:
        case PathFindResultType.PathNotFound:
          return result.type;
      }
    }
  }

  private randomTile(): TileRef {
    let basePatrolRange = this.patrolRange;
    const maxAttemptBeforeExpand: number = this.patrolRange * 2;
    let attemptCount: number = 0;
    while (true) {
      const x =
        this.mg.x(this.patrolCenterTile) +
        this.random.nextInt(-basePatrolRange / 2, basePatrolRange / 2);
      const y =
        this.mg.y(this.patrolCenterTile) +
        this.random.nextInt(-basePatrolRange / 2, basePatrolRange / 2);
      if (!this.mg.isValidCoord(x, y)) {
        continue;
      }
      const tile = this.mg.ref(x, y);
      if (!this.mg.isOcean(tile) || this.mg.isShoreline(tile)) {
        attemptCount++;
        if (attemptCount === maxAttemptBeforeExpand) {
          attemptCount = 0;
          basePatrolRange = basePatrolRange + Math.floor(basePatrolRange / 2);
        }
        continue;
      }
      return tile;
    }
  }
}
