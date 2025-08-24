import {
  Execution,
  Game,
  isUnit,
  OwnerComp,
  Unit,
  UnitParams,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { PseudoRandom } from "../PseudoRandom";
import { PathFindResultType } from "../pathfinding/AStar";
import { PathFinder } from "../pathfinding/PathFinding";
import { ShellExecution } from "./ShellExecution";

export class WarshipExecution implements Execution {
  private random: PseudoRandom | undefined;
  private warship: Unit | undefined;
  private mg: Game | undefined;
  private pathfinder: PathFinder | undefined;
  private lastShellAttack = 0;
  private readonly alreadySentShell = new Set<Unit>();

  constructor(
    private readonly input: (UnitParams<UnitType.Warship> & OwnerComp) | Unit,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    this.pathfinder = PathFinder.Mini(mg, 10_000, true, 100);
    this.random = new PseudoRandom(mg.ticks());
    if (isUnit(this.input)) {
      this.warship = this.input;
    } else {
      const spawn = this.input.owner.canBuild(
        UnitType.Warship,
        this.input.patrolTile,
      );
      if (spawn === false) {
        console.warn(
          `Failed to spawn warship for ${this.input.owner.name()} at ${this.input.patrolTile}`,
        );
        return;
      }
      this.warship = this.input.owner.buildUnit(
        UnitType.Warship,
        spawn,
        this.input,
      );
    }
  }

  tick(ticks: number): void {
    if (this.warship === undefined) throw new Error("Not initialized");
    if (this.warship.health() <= 0) {
      this.warship.delete();
      return;
    }
    const hasPort = this.warship.owner().unitCount(UnitType.Port) > 0;
    if (hasPort) {
      this.warship.modifyHealth(1);
    }

    this.warship.setTargetUnit(this.findTargetUnit());
    if (this.warship.targetUnit()?.type() === UnitType.TradeShip) {
      this.huntDownTradeShip();
      return;
    }

    this.patrol();

    if (this.warship.targetUnit() !== undefined) {
      this.shootTarget();
      return;
    }
  }

  private findTargetUnit(): Unit | undefined {
    if (this.mg === undefined) throw new Error("Not initialized");
    if (this.warship === undefined) throw new Error("Not initialized");
    const hasPort = this.warship.owner().unitCount(UnitType.Port) > 0;
    const patrolRangeSquared = this.mg.config().warshipPatrolRange() ** 2;

    const ships = this.mg.nearbyUnits(
      this.warship.tile(),
      this.mg.config().warshipTargettingRange(),
      [UnitType.TransportShip, UnitType.Warship, UnitType.TradeShip],
    );
    const potentialTargets: { unit: Unit; distSquared: number }[] = [];
    for (const { unit, distSquared } of ships) {
      if (
        unit.owner() === this.warship.owner() ||
        unit === this.warship ||
        unit.owner().isFriendly(this.warship.owner()) ||
        this.alreadySentShell.has(unit)
      ) {
        continue;
      }
      if (unit.type() === UnitType.TradeShip) {
        if (
          !hasPort ||
          unit.isSafeFromPirates() ||
          unit.targetUnit()?.owner() === this.warship.owner() || // trade ship is coming to my port
          unit.targetUnit()?.owner().isFriendly(this.warship.owner()) // trade ship is coming to my ally
        ) {
          continue;
        }
        const patrolTile = this.warship.patrolTile();
        if (
          patrolTile !== undefined &&
          this.mg.euclideanDistSquared(patrolTile, unit.tile()) >
            patrolRangeSquared
        ) {
          // Prevent warship from chasing trade ship that is too far away from
          // the patrol tile to prevent warships from wandering around the map.
          continue;
        }
      }
      potentialTargets.push({ distSquared, unit });
    }

    return potentialTargets.sort((a, b) => {
      const { unit: unitA, distSquared: distA } = a;
      const { unit: unitB, distSquared: distB } = b;

      // Prioritize Transport Ships above all other units
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

      // Then prioritize Warships.
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

      // If both are the same type, sort by distance (lower `distSquared` means closer)
      return distA - distB;
    })[0]?.unit;
  }

  private shootTarget() {
    if (this.mg === undefined) throw new Error("Not initialized");
    if (this.warship === undefined) throw new Error("Not initialized");
    const targetUnit = this.warship.targetUnit();
    if (targetUnit === undefined) return;
    const shellAttackRate = this.mg.config().warshipShellAttackRate();
    if (this.mg.ticks() - this.lastShellAttack > shellAttackRate) {
      if (targetUnit?.type() !== UnitType.TransportShip) {
        // Warships don't need to reload when attacking transport ships.
        this.lastShellAttack = this.mg.ticks();
      }
      this.mg.addExecution(
        new ShellExecution(
          this.warship.tile(),
          this.warship.owner(),
          this.warship,
          targetUnit,
        ),
      );
      if (!targetUnit.hasHealth()) {
        // Don't send multiple shells to target that can be oneshotted
        this.alreadySentShell.add(targetUnit);
        this.warship.setTargetUnit(undefined);
        return;
      }
    }
  }

  private huntDownTradeShip() {
    if (this.pathfinder === undefined) throw new Error("Not initialized");
    if (this.warship === undefined) throw new Error("Not initialized");
    const targetUnit = this.warship.targetUnit();
    if (targetUnit === undefined) return;
    for (let i = 0; i < 2; i++) {
      // target is trade ship so capture it.
      const result = this.pathfinder.nextTile(
        this.warship.tile(),
        targetUnit.tile(),
        5,
      );
      switch (result.type) {
        case PathFindResultType.Completed:
          this.warship.owner().captureUnit(targetUnit);
          this.warship.setTargetUnit(undefined);
          this.warship.move(this.warship.tile());
          return;
        case PathFindResultType.NextTile:
          this.warship.move(result.node);
          break;
        case PathFindResultType.Pending:
          this.warship.touch();
          break;
        case PathFindResultType.PathNotFound:
          console.log("path not found to target");
          break;
      }
    }
  }

  private patrol() {
    if (this.pathfinder === undefined) throw new Error("Not initialized");
    if (this.warship === undefined) throw new Error("Not initialized");
    let targetTile = this.warship.targetTile();
    if (targetTile === undefined) {
      targetTile = this.randomTile();
      this.warship.setTargetTile(targetTile);
      if (targetTile === undefined) {
        return;
      }
    }
    const result = this.pathfinder.nextTile(this.warship.tile(), targetTile);
    switch (result.type) {
      case PathFindResultType.Completed:
        this.warship.setTargetTile(undefined);
        this.warship.move(result.node);
        break;
      case PathFindResultType.NextTile:
        this.warship.move(result.node);
        break;
      case PathFindResultType.Pending:
        this.warship.touch();
        return;
      case PathFindResultType.PathNotFound:
        console.warn("path not found to target tile");
        this.warship.setTargetTile(undefined);
        break;
    }
  }

  isActive(): boolean {
    return this.warship?.isActive() ?? false;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  randomTile(allowShoreline = false): TileRef | undefined {
    if (this.mg === undefined) throw new Error("Not initialized");
    if (this.random === undefined) throw new Error("Not initialized");
    if (this.warship === undefined) throw new Error("Not initialized");
    let warshipPatrolRange = this.mg.config().warshipPatrolRange();
    const maxAttemptBeforeExpand = 500;
    let attempts = 0;
    let expandCount = 0;
    const patrolTile = this.warship.patrolTile();
    if (patrolTile === undefined) return;
    while (expandCount < 3) {
      const x =
        this.mg.x(patrolTile) +
        this.random.nextInt(-warshipPatrolRange / 2, warshipPatrolRange / 2);
      const y =
        this.mg.y(patrolTile) +
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
      `Failed to find random tile for warship for ${this.warship.owner().name()}`,
    );
    if (!allowShoreline) {
      // If we failed to find a tile on the ocean, try again but allow shoreline
      return this.randomTile(true);
    }
    return undefined;
  }
}
