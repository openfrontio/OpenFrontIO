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
import { WaterPathFinder } from "../pathfinding/PathFinder";
import { PathStatus } from "../pathfinding/types";
import { PseudoRandom } from "../PseudoRandom";
import { findMinimumBy } from "../Util";
import { ShellExecution } from "./ShellExecution";

export class WarshipExecution implements Execution {
  private random: PseudoRandom;
  private warship: Unit;
  private mg: Game;
  private pathfinder: WaterPathFinder;
  private lastShellAttack = 0;
  private alreadySentShell = new Set<Unit>();
  private retreatPortTile: TileRef | undefined;
  private retreatingForRepair = false;
  private docked = false;
  private activeHealingRemainder = 0;

  constructor(
    private input: (UnitParams<UnitType.Warship> & OwnerComp) | Unit,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    this.pathfinder = new WaterPathFinder(mg);
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
    const healthBeforeHealing = this.warship.health();

    this.healWarship();

    if (this.docked) {
      if (this.currentRetreatPort() === undefined) {
        this.docked = false;
        this.cancelRepairRetreat();
      }
      if (this.isFullyHealed()) {
        this.docked = false;
        this.cancelRepairRetreat();
      }
      if (this.docked) {
        return;
      }
    }

    if (this.handleRepairRetreat()) {
      return;
    }

    // Priority 1: Check if need to heal before doing anything else
    if (this.shouldStartRepairRetreat(healthBeforeHealing)) {
      this.startRepairRetreat();
      if (this.handleRepairRetreat()) {
        return;
      }
    }

    this.warship.setTargetUnit(this.findTargetUnit());

    // Always patrol for movement
    this.patrol();

    // Movement can change what is actually in range, so recompute before acting.
    this.warship.setTargetUnit(this.findTargetUnit());

    // Priority 1: Shoot transport ship if in range
    if (this.warship.targetUnit()?.type() === UnitType.TransportShip) {
      this.shootTarget();
      return;
    }

    // Priority 2: Fight enemy warship if in range
    if (this.warship.targetUnit()?.type() === UnitType.Warship) {
      this.shootTarget();
      return;
    }

    // Priority 3: Hunt trade ship only if not healing and no enemy warship
    if (this.warship.targetUnit()?.type() === UnitType.TradeShip) {
      this.huntDownTradeShip();
      return;
    }
  }

  private healWarship(): void {
    const owner = this.warship.owner();
    const passiveHealing = this.mg.config().warshipPassiveHealing();
    const passiveHealingRange = this.mg.config().warshipPassiveHealingRange();
    const warshipTile = this.warship.tile();

    const isNearPort = this.mg
      .nearbyUnits(warshipTile, passiveHealingRange, [UnitType.Port])
      .some(({ unit }) => unit.owner() === owner);

    if (isNearPort) {
      this.warship.modifyHealth(passiveHealing);
    }

    if (this.docked) {
      this.applyActiveDockedHealing();
    }
  }

  private isFullyHealed(): boolean {
    const maxHealth = this.mg.config().unitInfo(UnitType.Warship).maxHealth;
    if (typeof maxHealth !== "number") {
      console.warn("Warship maxHealth is not a number, disabling retreat");
      return true;
    }
    return this.warship.health() >= maxHealth;
  }

  private shouldStartRepairRetreat(
    healthBeforeHealing = this.warship.health(),
  ): boolean {
    if (this.retreatingForRepair) {
      return false;
    }
    if (
      healthBeforeHealing >= this.mg.config().warshipRetreatHealthThreshold()
    ) {
      return false;
    }
    // Only retreat if there's a friendly port
    const ports = this.warship.owner().units(UnitType.Port);
    return ports.length > 0;
  }

  private findNearestPort(): TileRef | undefined {
    const ports = this.warship.owner().units(UnitType.Port);
    if (ports.length === 0) {
      return undefined;
    }

    const warshipTile = this.warship.tile();
    const warshipComponent = this.mg.getWaterComponent(warshipTile);
    if (warshipComponent === null) {
      throw new Error(`Warship at tile ${warshipTile} has no water component`);
    }

    const nearest = findMinimumBy(
      ports,
      (port) => this.mg.euclideanDistSquared(warshipTile, port.tile()),
      (port) => {
        const portComponent = this.mg.getWaterComponent(port.tile());
        if (portComponent === null) {
          throw new Error(`Port at tile ${port.tile()} has no water component`);
        }
        return portComponent === warshipComponent;
      },
    );

    return nearest?.tile();
  }

  private startRepairRetreat(): void {
    const portTile = this.findNearestPort();
    if (portTile === undefined) {
      return;
    }
    this.retreatingForRepair = true;
    this.retreatPortTile = portTile;
    this.docked = false;
    this.activeHealingRemainder = 0;
    this.warship.setRetreating(true);
    this.warship.setTargetUnit(undefined);
  }

  private cancelRepairRetreat(clearTargetTile = true): void {
    this.retreatingForRepair = false;
    this.activeHealingRemainder = 0;
    this.warship.setRetreating(false);
    this.retreatPortTile = undefined;
    if (clearTargetTile) {
      this.warship.setTargetTile(undefined);
    }
  }

  private handleRepairRetreat(): boolean {
    if (!this.retreatingForRepair) {
      return false;
    }

    if (this.isFullyHealed()) {
      this.cancelRepairRetreat();
      return false;
    }

    if (!this.refreshRetreatPortTile()) {
      this.cancelRepairRetreat();
      return false;
    }

    this.warship.setTargetUnit(undefined);

    const retreatPortTile = this.retreatPortTile;
    if (retreatPortTile === undefined) {
      return false;
    }

    const dockingRadius = this.mg.config().warshipDockingRange();
    const dockingRadiusSq = dockingRadius * dockingRadius;
    const distToPort = this.mg.euclideanDistSquared(
      this.warship.tile(),
      retreatPortTile,
    );

    if (distToPort <= dockingRadiusSq) {
      // Check if the port has capacity available (excluding this warship from capacity check)
      const port = this.warship
        .owner()
        .units(UnitType.Port)
        .find((p) => p.tile() === retreatPortTile);
      if (port && !this.isPortFullOfHealing(port, this.warship)) {
        // Port has capacity - dock here
        this.warship.setTargetTile(undefined);
        this.docked = true;
        return true;
      } else {
        // Port is full - don't cancel retreat, keep waiting near port
        return true;
      }
    }

    this.warship.setTargetTile(retreatPortTile);
    const result = this.pathfinder.next(this.warship.tile(), retreatPortTile);
    switch (result.status) {
      case PathStatus.COMPLETE:
        this.warship.move(result.node);
        if (result.node === retreatPortTile) {
          this.warship.setTargetTile(undefined);
        }
        break;
      case PathStatus.NEXT:
        this.warship.move(result.node);
        break;
      case PathStatus.NOT_FOUND:
        this.retreatPortTile = this.findNearestAvailablePortTile(this.warship);
        if (this.retreatPortTile === undefined) {
          this.cancelRepairRetreat();
        }
        break;
    }

    return true;
  }

  private refreshRetreatPortTile(): boolean {
    const ports = this.warship.owner().units(UnitType.Port);
    if (ports.length === 0) {
      return false;
    }

    // Check if current retreat port still exists
    const currentPortExists =
      this.retreatPortTile !== undefined &&
      ports.some((port) => port.tile() === this.retreatPortTile);

    if (!currentPortExists) {
      this.retreatPortTile = this.findNearestAvailablePortTile(this.warship);
      return this.retreatPortTile !== undefined;
    }

    // Check if current port is now full of healing (not counting arrived warships)
    const currentPort = ports.find((p) => p.tile() === this.retreatPortTile);
    if (currentPort && this.isPortFullOfHealing(currentPort)) {
      // Current port is at healing capacity, look for alternatives
      const alternativePort = this.findNearestAvailablePortTile();
      if (alternativePort) {
        this.retreatPortTile = alternativePort;
      }
      return this.retreatPortTile !== undefined;
    }

    // Check if a significantly closer port is available
    const closerPort = this.findBetterPortTile();
    if (closerPort && closerPort !== this.retreatPortTile) {
      this.retreatPortTile = closerPort;
      return true;
    }

    return true;
  }

  private isPortFullOfHealing(port: Unit, excludeShip?: Unit): boolean {
    const maxShipsHealing = port.level();
    return this.dockedShipsAtPort(port, excludeShip).length >= maxShipsHealing;
  }

  private dockedShipsAtPort(port: Unit, excludeShip?: Unit): Unit[] {
    const dockingRadius = this.mg.config().warshipDockingRange();
    const owner = this.warship.owner();

    return this.mg
      .nearbyUnits(port.tile(), dockingRadius, [UnitType.Warship])
      .filter(({ unit: ship }) => {
        if (excludeShip && ship === excludeShip) return false;
        if (ship.owner() !== owner) return false;
        if (!ship.retreating()) return false;
        if (ship.targetTile() !== undefined) return false;
        return true;
      })
      .map(({ unit }) => unit);
  }

  private applyActiveDockedHealing(): void {
    const dockedPort = this.currentRetreatPort();
    if (!dockedPort) {
      return;
    }

    const dockedShips = this.dockedShipsAtPort(dockedPort);

    const healingPool =
      dockedPort.level() * this.mg.config().warshipPortHealingBonusPerLevel();
    if (healingPool <= 0 || dockedShips.length === 0) {
      return;
    }

    // Preserve fractional split healing over time with a per-ship remainder.
    const activeHealing = healingPool / dockedShips.length;
    this.activeHealingRemainder += activeHealing;
    const integerHealing = Math.floor(this.activeHealingRemainder);
    if (integerHealing <= 0) {
      return;
    }

    this.activeHealingRemainder -= integerHealing;
    this.warship.modifyHealth(integerHealing);
  }

  private currentRetreatPort(): Unit | undefined {
    if (this.retreatPortTile === undefined) {
      return undefined;
    }

    return this.warship
      .owner()
      .units(UnitType.Port)
      .find((port) => port.tile() === this.retreatPortTile);
  }

  private findBetterPortTile(): TileRef | undefined {
    const warshipTile = this.warship.tile();
    const currentDistance = this.retreatPortTile
      ? this.mg.euclideanDistSquared(warshipTile, this.retreatPortTile)
      : Infinity;
    const bestTile = this.findNearestAvailablePortTile(this.warship);
    if (!bestTile) {
      return undefined;
    }
    const bestDistance = this.mg.euclideanDistSquared(warshipTile, bestTile);
    if (
      bestDistance <
      currentDistance * this.mg.config().warshipPortSwitchThreshold()
    ) {
      return bestTile;
    }
    return undefined;
  }

  private findNearestAvailablePortTile(
    excludeShip?: Unit,
  ): TileRef | undefined {
    const ports = this.warship.owner().units(UnitType.Port);
    if (ports.length === 0) {
      return undefined;
    }

    const warshipTile = this.warship.tile();
    const warshipComponent = this.mg.getWaterComponent(warshipTile);
    if (warshipComponent === null) {
      throw new Error(`Warship at tile ${warshipTile} has no water component`);
    }

    let bestTile: TileRef | undefined = undefined;
    let bestDistance = Infinity;
    for (const port of ports) {
      if (this.isPortFullOfHealing(port, excludeShip)) {
        continue;
      }

      const portTile = port.tile();
      if (!this.mg.hasWaterComponent(portTile, warshipComponent)) {
        continue;
      }

      const distance = this.mg.euclideanDistSquared(warshipTile, portTile);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestTile = portTile;
      }
    }

    return bestTile;
  }

  private findTargetUnit(): Unit | undefined {
    const mg = this.mg;
    const config = mg.config();
    const owner = this.warship.owner();
    const hasPort = owner.unitCount(UnitType.Port) > 0;
    const patrolTile = this.warship.patrolTile()!;
    const patrolRangeSquared = config.warshipPatrolRange() ** 2;

    // Lazy: only computed if a TradeShip candidate forces the component check.
    // `undefined` = not yet computed; `null` = computed, no component found.
    let warshipComponent: number | null | undefined = undefined;

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

        if (warshipComponent === undefined) {
          warshipComponent = mg.getWaterComponent(this.warship.tile());
        }
        if (
          warshipComponent !== null &&
          !mg.hasWaterComponent(unit.tile(), warshipComponent)
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
      case PathStatus.NOT_FOUND: {
        console.log(`path not found to target`);
        this.warship.setTargetTile(undefined);
        break;
      }
    }
  }

  isActive(): boolean {
    return this.warship?.isActive();
  }

  isDocked(): boolean {
    return this.docked;
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

    const patrolTile = this.warship.patrolTile();
    if (patrolTile === undefined) {
      return undefined;
    }

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
        !this.mg.isWater(tile) ||
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
