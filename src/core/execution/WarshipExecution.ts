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
import { boatPathFromTileToWater } from "../game/TransportShipUtils";
import { PseudoRandom } from "../PseudoRandom";
import { ShellExecution } from "./ShellExecution";

export class WarshipExecution implements Execution {
  private random: PseudoRandom;
  private warship: Unit;
  private mg: Game;
  private lastShellAttack = 0;
  private alreadySentShell = new Set<Unit>();

  private path: TileRef[] = [];
  private pathIndex = 0;
  private pathDst: TileRef | null = null;

  constructor(
    private input: (UnitParams<UnitType.Warship> & OwnerComp) | Unit,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
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
    this.path = [];
    this.pathIndex = 0;
    this.pathDst = null;
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
    const hasPort = this.warship.owner().unitCount(UnitType.Port) > 0;
    const patrolRangeSquared = this.mg.config().warshipPatrolRange() ** 2;

    const ships = this.mg.nearbyUnits(
      this.warship.tile()!,
      this.mg.config().warshipTargettingRange(),
      [UnitType.TransportShip, UnitType.Warship, UnitType.TradeShip],
    );
    const potentialTargets: { unit: Unit; distSquared: number }[] = [];
    for (const { unit, distSquared } of ships) {
      if (
        unit.owner() === this.warship.owner() ||
        unit === this.warship ||
        unit.owner().isFriendly(this.warship.owner(), true) ||
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
        if (
          this.mg.euclideanDistSquared(
            this.warship.patrolTile()!,
            unit.tile(),
          ) > patrolRangeSquared
        ) {
          // Prevent warship from chasing trade ship that is too far away from
          // the patrol tile to prevent warships from wandering around the map.
          continue;
        }
      }
      potentialTargets.push({ unit: unit, distSquared });
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
      const curr = this.warship.tile();
      const dst = this.warship.targetUnit()!.tile();

      if (curr === null) {
        return;
      }

      if (curr !== null && this.mg.manhattanDist(curr, dst) < 5) {
        this.warship.owner().captureUnit(this.warship.targetUnit()!);
        this.warship.setTargetUnit(undefined);
        this.warship.move(this.warship.tile());
        return;
      }

      if (this.pathDst !== dst || this.path.length === 0) {
        const newPath = boatPathFromTileToWater(this.mg, curr, dst);
        if (newPath === null || newPath.length < 2) {
          console.log(`path not found to target`);
          this.path = [];
          this.pathIndex = 0;
          this.pathDst = null;
          break;
        }
        this.path = newPath;
        this.pathIndex = 0;
        this.pathDst = dst;
      }

      const next = this.path[this.pathIndex + 1];
      if (next === undefined) {
        this.path = [];
        this.pathIndex = 0;
        this.pathDst = null;
        break;
      }
      this.warship.move(next);
      this.pathIndex++;
    }
  }

  private patrol() {
    if (this.warship.targetTile() === undefined) {
      this.warship.setTargetTile(this.randomTile());
      if (this.warship.targetTile() === undefined) {
        return;
      }
    }

    const curr = this.warship.tile();
    const dst = this.warship.targetTile()!;

    if (curr === null) return;
    if (curr === dst) {
      this.warship.setTargetTile(undefined);
      return;
    }

    if (this.pathDst !== dst || this.path.length === 0) {
      const newPath = boatPathFromTileToWater(this.mg, curr, dst);
      if (newPath === null || newPath.length < 2) {
        console.warn(`path not found to target tile`);
        this.warship.setTargetTile(undefined);
        this.path = [];
        this.pathIndex = 0;
        this.pathDst = null;
        return;
      }
      this.path = newPath;
      this.pathIndex = 0;
      this.pathDst = dst;
    }

    const next = this.path[this.pathIndex + 1];
    if (next === undefined) {
      this.warship.setTargetTile(undefined);
      this.path = [];
      this.pathIndex = 0;
      this.pathDst = null;
      return;
    }
    this.warship.move(next);
    this.pathIndex++;

    if (next === dst) {
      this.warship.setTargetTile(undefined);
      this.path = [];
      this.pathIndex = 0;
      this.pathDst = null;
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
