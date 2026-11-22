import { TileRef } from "@openfront/engine-api/game/GameMap";
import {
  MessageType,
  Structures,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import {
  AA_GUN_RANGE,
  AIR_ASSAULT_TROOP_DIVISOR,
  AIR_TO_AIR_HIT_PERCENT,
  AIR_TO_AIR_MISSILE_DAMAGE,
  AIR_TO_AIR_MISSILE_SPEED,
  AIRBASE_DOCKING_RANGE,
  AircraftSpec,
  aircraftSpec,
  AircraftType,
  BINGO_FUEL_MARGIN,
  BOMB_STRUCTURE_RADIUS,
  BOMB_TROOP_KILL_PERMILLE,
  isAircraftType,
  ORBIT_POINTS,
  orbitWaypoint,
  refuelPerTick,
  repairPerTick,
  stepToward,
} from "@openfront/engine-lib/game/AirRules";
import {
  zInt,
  zPlayerRef,
  zRef,
  zTile,
} from "@openfront/engine-lib/snapshot/SnapshotType";
import { z } from "zod";
import { Execution, Game, isUnit, Player, Unit } from "../../game/Game";
import { UnitTypeSchema } from "../../snapshot/CommonSchemas";
import { execSnapshotType } from "../../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../../snapshot/SnapshotContext";
import { AttackExecution } from "../AttackExecution";
import { ShellExecution } from "../ShellExecution";
import {
  airbaseAt,
  chebyshevDist,
  isHostileTo,
  isTrackedBy,
  nearestAirbase,
} from "./AirCombat";
import { GuidedMissileExecution } from "./GuidedMissileExecution";

/** What an aircraft hunts, best first (index = priority). */
const FIGHTER_TARGETS: readonly UnitType[] = [
  UnitType.Bomber,
  UnitType.Fighter,
  UnitType.TransportHelicopter,
  UnitType.AttackHelicopter,
];

// Trade ships are left to warships, which capture rather than sink them.
const ATTACK_HELICOPTER_TARGETS: readonly UnitType[] = [
  UnitType.TransportShip,
  UnitType.TransportHelicopter,
  UnitType.Warship,
  UnitType.AttackHelicopter,
];

export interface AircraftOrder {
  owner: Player;
  type: AircraftType;
  /** The station to patrol, the strike target, or the landing zone. */
  patrolTile: TileRef;
}

/**
 * AIR update: one execution drives every aircraft type through the same
 * sortie cycle, on top of the patrol state warships use (WarshipState):
 *
 *   docked (at an airbase: refuel, repair, rearm)
 *     → patrolling (flying the mission: station, strike or landing zone)
 *     → retreating (returning to base on bingo fuel or empty magazines)
 *     → docked …
 *
 * Fuel burns one unit per airborne tick. An aircraft with no airbase to
 * return to crashes when its tank runs dry. A move order (MoveWarshipIntent)
 * changes the patrol tile; ordering an aircraft onto its own airbase stands
 * it down there.
 *
 * Roles:
 * - Fighter: orbits its station and fires guided missiles at hostile
 *   aircraft it sees, or that friendly radar tracks within its commit range.
 * - Attack helicopter: hovers on station and rockets boats, warships and
 *   helicopters within its own sensor range.
 * - Bomber: flies to a hostile target tile, drops its load (every hostile
 *   structure nearby loses a level, the owner loses troops), flies home and
 *   repeats until re-tasked.
 * - Transport helicopter: lands its troops at the landing zone (an attack
 *   on that tile's owner, or reinforcements on friendly land), then returns
 *   to base; a new order loads a fresh detachment.
 */
export class AircraftExecution implements Execution {
  private mg: Game;
  private aircraft: Unit;
  private active = true;
  private lastShot = -1000;
  private orbitIndex = 0;
  private target: Unit | undefined;
  private lastObservedPatrolTile: TileRef | undefined;
  /** Transport helicopters: a landing still has to be flown. */
  private missionPending = true;

  constructor(private input: AircraftOrder | Unit) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    if (isUnit(this.input)) {
      this.aircraft = this.input;
    } else {
      const { owner, type, patrolTile } = this.input;
      const spawn = owner.canBuild(type, patrolTile);
      if (spawn === false) {
        console.warn(`cannot launch ${type} for ${owner.name()}`);
        this.active = false;
        return;
      }
      if (type === UnitType.TransportHelicopter) {
        const troops = Math.floor(owner.troops() / AIR_ASSAULT_TROOP_DIVISOR);
        if (troops < 1) {
          this.active = false;
          return;
        }
        // buildUnit takes the troops from the owner.
        this.aircraft = owner.buildUnit(type, spawn, { patrolTile, troops });
      } else {
        this.aircraft = owner.buildUnit(type, spawn, { patrolTile });
      }
      // Newly built aircraft start on the ground, fully turned around.
      this.aircraft.updateWarshipState({ state: "docked", retreatPort: spawn });
    }
    this.lastObservedPatrolTile = this.aircraft.warshipState().patrolTile;
  }

  private spec(): AircraftSpec {
    return aircraftSpec(this.aircraft.type() as AircraftType);
  }

  private owner(): Player {
    return this.aircraft.owner();
  }

  tick(ticks: number): void {
    const aircraft = this.aircraft;
    if (aircraft === undefined || !aircraft.isActive()) {
      this.active = false;
      return;
    }
    this.observeOrders();

    if (aircraft.warshipState().state === "docked") {
      this.turnAround();
      return;
    }

    // Airborne: burn fuel; an empty tank is a crash.
    const fuel = aircraft.aircraftState().fuel - 1;
    if (fuel <= 0) {
      this.crash();
      return;
    }
    aircraft.updateAircraftState({ fuel });

    if (aircraft.warshipState().state === "retreating") {
      this.flyHome();
      return;
    }
    if (this.shouldReturnToBase()) {
      this.startReturn();
      this.flyHome();
      return;
    }

    switch (aircraft.type()) {
      case UnitType.Fighter:
        this.fighterMission();
        break;
      case UnitType.AttackHelicopter:
        this.attackHelicopterMission();
        break;
      case UnitType.Bomber:
        this.bomberMission();
        break;
      case UnitType.TransportHelicopter:
        this.transportMission();
        break;
    }
  }

  // -------------------------------------------------------------------------
  // Orders and the sortie cycle
  // -------------------------------------------------------------------------

  private observeOrders(): void {
    const patrolTile = this.aircraft.warshipState().patrolTile;
    if (patrolTile !== this.lastObservedPatrolTile) {
      this.lastObservedPatrolTile = patrolTile;
      this.target = undefined;
      this.aircraft.setTargetUnit(undefined);
      this.missionPending = true;
    }
  }

  /** Whether the current order sends the aircraft anywhere. */
  private hasMission(): boolean {
    const patrolTile = this.aircraft.warshipState().patrolTile;
    if (patrolTile === undefined) return false;
    // Ordered onto one of its own airbases: stand down there.
    if (airbaseAt(this.mg, this.owner(), patrolTile) !== undefined) {
      return false;
    }
    if (this.aircraft.type() === UnitType.TransportHelicopter) {
      return this.missionPending;
    }
    return true;
  }

  private currentBase(): Unit | undefined {
    const baseTile = this.aircraft.warshipState().retreatPort;
    if (baseTile === undefined) return undefined;
    const base = airbaseAt(this.mg, this.owner(), baseTile);
    return base !== undefined && base.tile() === baseTile ? base : undefined;
  }

  private turnAround(): void {
    const aircraft = this.aircraft;
    const base = this.currentBase();
    if (base === undefined) {
      // The airbase was destroyed or captured: fly to another one.
      this.startReturn();
      return;
    }
    if (aircraft.tile() !== base.tile()) aircraft.move(base.tile());

    const spec = this.spec();
    const state = aircraft.aircraftState();
    const level = base.level();
    if (state.fuel < spec.maxFuel) {
      aircraft.updateAircraftState({
        fuel: Math.min(
          spec.maxFuel,
          state.fuel + refuelPerTick(spec.maxFuel, level),
        ),
      });
    }
    if (aircraft.health() < aircraft.maxHealth()) {
      aircraft.modifyHealth(repairPerTick(level));
    }
    const ready =
      aircraft.aircraftState().fuel >= spec.maxFuel &&
      aircraft.health() >= aircraft.maxHealth();
    if (!ready) return;
    // Rearm once fuelled and repaired.
    aircraft.updateAircraftState({ ammo: spec.ammo, flares: spec.flares });

    if (!this.hasMission()) return;
    if (aircraft.type() === UnitType.TransportHelicopter) {
      if (!this.embarkTroops()) return;
    }
    aircraft.updateWarshipState({
      state: "patrolling",
      retreatPort: undefined,
    });
  }

  /** Transport helicopters load a fresh detachment for each new landing. */
  private embarkTroops(): boolean {
    if (this.aircraft.troops() > 0) return true;
    const owner = this.owner();
    const troops = Math.floor(owner.troops() / AIR_ASSAULT_TROOP_DIVISOR);
    if (troops < 1) return false;
    owner.removeTroops(troops);
    this.aircraft.setTroops(troops);
    return true;
  }

  private shouldReturnToBase(): boolean {
    const aircraft = this.aircraft;
    const spec = this.spec();
    const state = aircraft.aircraftState();
    if (spec.ammo > 0 && state.ammo === 0) return true;
    if (!this.hasMission()) return true;
    const base = nearestAirbase(this.mg, this.owner(), aircraft.tile());
    if (base === undefined) return false; // Nowhere to go: fly on.
    const ticksHome = Math.ceil(
      chebyshevDist(this.mg, aircraft.tile(), base.tile()) / spec.speed,
    );
    return state.fuel <= ticksHome + BINGO_FUEL_MARGIN;
  }

  private startReturn(): void {
    const base = nearestAirbase(this.mg, this.owner(), this.aircraft.tile());
    this.target = undefined;
    this.aircraft.setTargetUnit(undefined);
    this.aircraft.updateWarshipState({
      state: base === undefined ? "patrolling" : "retreating",
      retreatPort: base?.tile(),
    });
  }

  private flyHome(): void {
    let base = this.currentBase();
    if (base === undefined) {
      base = nearestAirbase(this.mg, this.owner(), this.aircraft.tile());
      if (base === undefined) {
        // No airbase left: loiter on station until the fuel runs out.
        this.aircraft.updateWarshipState({
          state: "patrolling",
          retreatPort: undefined,
        });
        this.holdStation();
        return;
      }
      this.aircraft.updateWarshipState({ retreatPort: base.tile() });
    }
    this.moveToward(base.tile());
    if (
      chebyshevDist(this.mg, this.aircraft.tile(), base.tile()) <=
      AIRBASE_DOCKING_RANGE
    ) {
      this.aircraft.move(base.tile());
      this.aircraft.updateWarshipState({ state: "docked" });
    }
  }

  private crash(): void {
    this.active = false;
    // Troops aboard are lost with the aircraft.
    this.aircraft.delete(true);
  }

  // -------------------------------------------------------------------------
  // Movement
  // -------------------------------------------------------------------------

  private moveToward(goal: TileRef): void {
    const speed = this.spec().speed;
    for (let i = 0; i < speed; i++) {
      const tile = this.aircraft.tile();
      if (tile === goal) return;
      this.aircraft.move(stepToward(this.mg, tile, goal));
    }
  }

  /** Helicopters hover over their station; jets orbit it. */
  private holdStation(): void {
    const station = this.aircraft.warshipState().patrolTile;
    if (station === undefined) return;
    if (this.spec().hovers) {
      this.moveToward(station);
      return;
    }
    let waypoint = orbitWaypoint(this.mg, station, this.orbitIndex);
    if (chebyshevDist(this.mg, this.aircraft.tile(), waypoint) <= 1) {
      this.orbitIndex = (this.orbitIndex + 1) % ORBIT_POINTS;
      waypoint = orbitWaypoint(this.mg, station, this.orbitIndex);
    }
    this.moveToward(waypoint);
  }

  // -------------------------------------------------------------------------
  // Roles
  // -------------------------------------------------------------------------

  private fighterMission(): void {
    const target = this.acquireTarget(FIGHTER_TARGETS, true);
    if (target === undefined) {
      this.holdStation();
      return;
    }
    this.aircraft.updateWarshipState({ isInCombat: true });
    const spec = this.spec();
    const distSq = this.mg.euclideanDistSquared(
      this.aircraft.tile(),
      target.tile(),
    );
    if (distSq > (spec.weaponRange * spec.weaponRange) / 4) {
      // Close to half weapon range for a high-probability shot.
      this.moveToward(target.tile());
    } else {
      this.holdStation();
    }
    if (distSq <= spec.weaponRange * spec.weaponRange && this.canFire()) {
      this.fire();
      this.mg.addExecution(
        GuidedMissileExecution.fire(
          this.aircraft.tile(),
          this.owner(),
          target,
          {
            speed: AIR_TO_AIR_MISSILE_SPEED,
            damage: AIR_TO_AIR_MISSILE_DAMAGE,
            hitPercent: AIR_TO_AIR_HIT_PERCENT,
          },
        ),
      );
    }
  }

  private attackHelicopterMission(): void {
    const target = this.acquireTarget(ATTACK_HELICOPTER_TARGETS, false);
    if (target === undefined) {
      this.holdStation();
      return;
    }
    this.aircraft.updateWarshipState({ isInCombat: true });
    const spec = this.spec();
    const distSq = this.mg.euclideanDistSquared(
      this.aircraft.tile(),
      target.tile(),
    );
    if (distSq > spec.weaponRange * spec.weaponRange) {
      this.moveToward(target.tile());
      return;
    }
    if (this.canFire()) {
      this.fire();
      this.mg.addExecution(
        new ShellExecution(
          this.aircraft.tile(),
          this.owner(),
          this.aircraft,
          target,
        ),
      );
      // Boats have no health: one rocket sinks them, so pick a new target.
      if (!target.hasHealth()) {
        this.target = undefined;
        this.aircraft.setTargetUnit(undefined);
      }
    }
  }

  private bomberMission(): void {
    const aimPoint = this.aircraft.warshipState().patrolTile!;
    if (!this.isHostileGround(aimPoint)) {
      this.holdStation();
      return;
    }
    this.moveToward(aimPoint);
    if (this.aircraft.tile() === aimPoint) {
      this.dropBombs(aimPoint);
      this.aircraft.updateAircraftState({ ammo: 0 });
      this.startReturn();
    }
  }

  private transportMission(): void {
    const zone = this.aircraft.warshipState().patrolTile!;
    this.moveToward(zone);
    if (this.aircraft.tile() !== zone) return;
    if (this.land(zone)) {
      this.missionPending = false;
      this.startReturn();
    }
  }

  // -------------------------------------------------------------------------
  // Weapons
  // -------------------------------------------------------------------------

  private canFire(): boolean {
    return (
      this.aircraft.aircraftState().ammo > 0 &&
      this.mg.ticks() - this.lastShot >= this.spec().reload
    );
  }

  private fire(): void {
    this.lastShot = this.mg.ticks();
    this.aircraft.updateAircraftState({
      ammo: this.aircraft.aircraftState().ammo - 1,
    });
  }

  /**
   * Keeps the current target while it stays valid, otherwise picks the best
   * new one near the station. With `useRadar`, contacts tracked by friendly
   * radar count as seen anywhere within the commit range; without it the
   * aircraft relies on its own sensor.
   */
  private acquireTarget(
    types: readonly UnitType[],
    useRadar: boolean,
  ): Unit | undefined {
    const spec = this.spec();
    const station = this.aircraft.warshipState().patrolTile!;
    const owner = this.owner();
    const commitSq = spec.commitRange * spec.commitRange;
    const sensorSq = spec.sensorRange * spec.sensorRange;
    const visible = (unit: Unit): boolean => {
      if (!unit.isActive() || !isHostileTo(owner, unit)) return false;
      if (this.mg.euclideanDistSquared(station, unit.tile()) > commitSq) {
        return false;
      }
      // Do not chase a contact into a hostile flak envelope.
      if (this.isFlakDefended(unit.tile())) return false;
      if (
        this.mg.euclideanDistSquared(this.aircraft.tile(), unit.tile()) <=
        sensorSq
      ) {
        return true;
      }
      return (
        useRadar &&
        isAircraftType(unit.type()) &&
        isTrackedBy(this.mg, owner, unit)
      );
    };

    if (this.target !== undefined && visible(this.target)) {
      return this.target;
    }

    const searchRange = useRadar ? spec.commitRange : spec.sensorRange;
    const center = useRadar ? station : this.aircraft.tile();
    let best: Unit | undefined;
    let bestPriority = Infinity;
    let bestDistSq = Infinity;
    for (const { unit } of this.mg.nearbyUnits(center, searchRange, types)) {
      const priority = types.indexOf(unit.type());
      const distSq = this.mg.euclideanDistSquared(
        this.aircraft.tile(),
        unit.tile(),
      );
      if (
        priority > bestPriority ||
        (priority === bestPriority && distSq >= bestDistSq)
      ) {
        continue;
      }
      if (!visible(unit)) continue;
      best = unit;
      bestPriority = priority;
      bestDistSq = distSq;
    }
    this.target = best;
    this.aircraft.setTargetUnit(best);
    return best;
  }

  /**
   * Whether hostile AA guns cover `tile`. Aircraft hold their station even
   * under flak (that is the order they were given), but do not pursue a
   * contact into it.
   */
  private isFlakDefended(tile: TileRef): boolean {
    const owner = this.owner();
    return this.mg.anyUnitNearby(tile, AA_GUN_RANGE, [UnitType.AAGun], (gun) =>
      isHostileTo(owner, gun),
    );
  }

  private isHostileGround(tile: TileRef): boolean {
    if (this.mg.isSpawnImmunityActive()) return false;
    const owner = this.mg.owner(tile);
    return (
      owner.isPlayer() &&
      owner !== this.owner() &&
      this.owner().canAttackPlayer(owner as Player, true)
    );
  }

  private dropBombs(aimPoint: TileRef): void {
    const attacker = this.owner();
    for (const { unit } of this.mg.nearbyUnits(
      aimPoint,
      BOMB_STRUCTURE_RADIUS,
      Structures.types,
      undefined,
      true,
    )) {
      if (!unit.isActive() || !isHostileTo(attacker, unit)) continue;
      unit.decreaseLevel(attacker);
    }
    const victim = this.mg.owner(aimPoint);
    if (victim.isPlayer()) {
      const struck = victim as Player;
      struck.removeTroops(
        Math.floor((struck.troops() * BOMB_TROOP_KILL_PERMILLE) / 1000),
      );
      this.mg.displayMessage(
        "events_display.bomber_strike",
        MessageType.UNIT_DESTROYED,
        struck.id(),
        undefined,
        { name: attacker.displayName() },
      );
    }
  }

  /** Unloads at the landing zone. Returns false if it cannot land there. */
  private land(zone: TileRef): boolean {
    const aircraft = this.aircraft;
    const owner = this.owner();
    const troops = aircraft.troops();
    if (troops <= 0) return true;
    if (!this.mg.isLand(zone) || this.mg.isImpassable(zone)) return false;
    const zoneOwner = this.mg.owner(zone);
    if (zoneOwner === owner) {
      owner.addTroops(troops);
    } else if (
      zoneOwner.isPlayer() &&
      (owner.isFriendly(zoneOwner as Player) ||
        !owner.canAttackPlayer(zoneOwner as Player))
    ) {
      // Allied or protected land: hold the troops and hover.
      return false;
    } else {
      if (zoneOwner.isPlayer() && this.mg.isSpawnImmunityActive()) {
        return false;
      }
      owner.conquer(zone);
      this.mg.addExecution(
        new AttackExecution(troops, owner, zoneOwner.id(), zone, false),
      );
    }
    aircraft.setTroops(0);
    return true;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return AircraftExecutionSnapshot.write({
      input: isUnit(this.input)
        ? { unit: w.unit(this.input) }
        : {
            owner: w.player(this.input.owner),
            type: this.input.type,
            patrolTile: this.input.patrolTile,
          },
      active: this.active,
      initialized: this.mg !== undefined,
      aircraft: this.aircraft === undefined ? null : w.unit(this.aircraft),
      lastShot: this.lastShot,
      orbitIndex: this.orbitIndex,
      target: w.unitOrNull(this.target ?? null),
      lastObservedPatrolTile: this.lastObservedPatrolTile,
      missionPending: this.missionPending,
    });
  }

  restoreSnapshot(s: AircraftState, r: SnapshotReader): void {
    this.input =
      "unit" in s.input
        ? r.unit(s.input.unit)
        : {
            owner: r.player(s.input.owner),
            type: s.input.type as AircraftType,
            patrolTile: s.input.patrolTile,
          };
    this.active = s.active;
    if (s.initialized) this.mg = r.game;
    if (s.aircraft !== null) this.aircraft = r.unit(s.aircraft);
    this.lastShot = s.lastShot;
    this.orbitIndex = s.orbitIndex;
    this.target = r.unitOrNull(s.target) ?? undefined;
    this.lastObservedPatrolTile = s.lastObservedPatrolTile;
    this.missionPending = s.missionPending;
  }
}

const AircraftStateSchema = z.object({
  input: z.union([
    z.object({ unit: zRef() }),
    z.object({
      owner: zPlayerRef(),
      type: UnitTypeSchema,
      patrolTile: zTile(),
    }),
  ]),
  active: z.boolean(),
  initialized: z.boolean(),
  aircraft: zRef().nullable(),
  lastShot: zInt(),
  orbitIndex: zInt(),
  target: zRef().nullable(),
  lastObservedPatrolTile: zTile().optional(),
  missionPending: z.boolean(),
});
type AircraftState = z.infer<typeof AircraftStateSchema>;

export const AircraftExecutionSnapshot = execSnapshotType({
  name: "Aircraft",
  version: 1,
  schema: AircraftStateSchema,
  cls: () => AircraftExecution,
});
