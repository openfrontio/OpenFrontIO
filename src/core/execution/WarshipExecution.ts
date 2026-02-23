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
import { PathFinding } from "../pathfinding/PathFinder";
import { PathStatus, SteppingPathFinder } from "../pathfinding/types";
import { PseudoRandom } from "../PseudoRandom";
import { ShellExecution } from "./ShellExecution";

export class WarshipExecution implements Execution {
  private random: PseudoRandom;
  private warship: Unit;
  private mg: Game;
  private pathfinder: SteppingPathFinder<TileRef>;
  private lastShellAttack = 0;
  private alreadySentShell = new Set<Unit>();

  constructor(
    private input: (UnitParams<UnitType.Warship> & OwnerComp) | Unit,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    this.pathfinder = PathFinding.Water(mg);
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
    const mg = this.mg;
    const config = mg.config();
    const owner = this.warship.owner();
    const hasPort = owner.unitCount(UnitType.Port) > 0;
    const patrolTile = this.warship.patrolTile()!;
    const patrolRangeSquared = config.warshipPatrolRange() ** 2;

    const ships = mg.nearbyUnits(
      this.warship.tile()!,
      config.warshipTargettingRange(),
      [UnitType.TransportShip, UnitType.Warship, UnitType.TradeShip],
    );

    let bestUnit: Unit | undefined = undefined;
    let bestTypePriority = 0;
    let bestDistSquared = 0;

    for (const { unit, distSquared } of ships) {
      if (
        unit.owner() === owner ||
        unit === this.warship ||
        !owner.canAttackPlayer(unit.owner(), true) ||
        this.alreadySentShell.has(unit)
      ) {
        continue;
      }

      const type = unit.type();
      if (type === UnitType.TradeShip) {
        if (
          !hasPort ||
          unit.isSafeFromPirates() ||
          unit.targetUnit()?.owner() === owner || // trade ship is coming to my port
          unit.targetUnit()?.owner().isFriendly(owner) // trade ship is coming to my ally
        ) {
          continue;
        }
        if (
          mg.euclideanDistSquared(patrolTile, unit.tile()) > patrolRangeSquared
        ) {
          // Prevent warship from chasing trade ship that is too far away from
          // the patrol tile to prevent warships from wandering around the map.
          continue;
        }
      }

      const typePriority =
        type === UnitType.TransportShip ? 0 : type === UnitType.Warship ? 1 : 2;

      if (bestUnit === undefined) {
        bestUnit = unit;
        bestTypePriority = typePriority;
        bestDistSquared = distSquared;
        continue;
      }

      // Match existing `sort()` semantics:
      // - Lower priority is better (TransportShip < Warship < TradeShip).
      // - For same type, smaller distance is better.
      // - For exact ties, keep the first encountered (stable sort behavior).
      if (
        typePriority < bestTypePriority ||
        (typePriority === bestTypePriority && distSquared < bestDistSquared)
      ) {
        bestUnit = unit;
        bestTypePriority = typePriority;
        bestDistSquared = distSquared;
      }
    }

    return bestUnit;
  }

  private shootTarget() {
    const shellAttackRate = this.mg.config().warshipShellAttackRate();
    if (this.mg.ticks() - this.lastShellAttack > shellAttackRate) {
      if (this.warship.targetUnit()?.type() !== UnitType.TransportShip) {
        // Warships don't need to reload when attacking transport ships.
        this.lastShellAttack = this.mg.ticks();
      }
      this.mg.addExecution(
        new ShellExecution(
          this.warship.tile(),
          this.warship.owner(),
          this.warship,
          this.warship.targetUnit()!,
        ),
      );
      if (!this.warship.targetUnit()!.hasHealth()) {
        // Don't send multiple shells to target that can be oneshotted
        this.alreadySentShell.add(this.warship.targetUnit()!);
        this.warship.setTargetUnit(undefined);
        return;
      }
    }
  }

  private huntDownTradeShip() {
    for (let i = 0; i < 2; i++) {
      // target is trade ship so capture it.
      const result = this.pathfinder.next(
        this.warship.tile(),
        this.warship.targetUnit()!.tile(),
        5,
      );
      switch (result.status) {
        case PathStatus.COMPLETE:
          this.warship.owner().captureUnit(this.warship.targetUnit()!);
          this.warship.setTargetUnit(undefined);
          this.warship.move(this.warship.tile());
          return;
        case PathStatus.NEXT:
          this.warship.move(result.node);
          break;
        case PathStatus.PENDING:
          this.warship.touch();
          break;
        case PathStatus.NOT_FOUND: {
          console.log(`path not found to target`);
          break;
        }
      }
    }
  }

  private patrol() {
    if (this.warship.targetTile() === undefined) {
      this.warship.setTargetTile(this.randomTile());
      if (this.warship.targetTile() === undefined) {
        return;
      }
    }

    const result = this.pathfinder.next(
      this.warship.tile(),
      this.warship.targetTile()!,
    );
    switch (result.status) {
      case PathStatus.COMPLETE:
        this.warship.setTargetTile(undefined);
        this.warship.move(result.node);
        break;
      case PathStatus.NEXT:
        this.warship.move(result.node);
        break;
      case PathStatus.PENDING:
        this.warship.touch();
        return;
      case PathStatus.NOT_FOUND: {
        console.log(`path not found to target`);
        break;
      }
    }
  }

  isActive(): boolean {
    return this.warship?.isActive();
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  randomTile(allowShoreline: boolean = false): TileRef | undefined {
    let warshipPatrolRange = this.mg.config().warshipPatrolRange();
    const maxAttemptBeforeExpand: number = 500;
    let attempts: number = 0;
    let expandCount: number = 0;

    // Get warship's water component for connectivity check
    const warshipComponent = this.mg.getWaterComponent(this.warship.tile());

    while (expandCount < 3) {
      const x =
        this.mg.x(this.warship.patrolTile()!) +
        this.random.nextInt(-warshipPatrolRange / 2, warshipPatrolRange / 2);
      const y =
        this.mg.y(this.warship.patrolTile()!) +
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
      // Check water component connectivity
      if (
        warshipComponent !== null &&
        !this.mg.hasWaterComponent(tile, warshipComponent)
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
