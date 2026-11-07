import { TileRef } from "@openfront/engine-api/game/GameMap";
import { MessageType, UnitType } from "@openfront/engine-api/game/GameTypes";
import { applyPercentBonus, TANK } from "@openfront/engine-lib/game/ModRules";
import {
  zInt,
  zPlayerRef,
  zRef,
  zTile,
} from "@openfront/engine-lib/snapshot/SnapshotType";
import { z } from "zod";
import {
  Execution,
  Game,
  isUnit,
  OwnerComp,
  Unit,
  UnitParams,
} from "../game/Game";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";
import { stepLand } from "./ModMovement";

// How many tiles of an attack's front are sampled when checking whether it is
// within range. Border sets can be huge; the sample keeps the check cheap and
// is deterministic because sets iterate in insertion order.
const ATTACK_FRONT_SAMPLE = 64;
// Ticks a tank keeps its "in combat" mark after firing.
const COMBAT_MARK_TICKS = 30;
// Ticks a tank gives up a chase for once it gets stuck on terrain.
const STUCK_LIMIT = 30;
const GIVE_UP_TICKS = 120;

/**
 * The land counterpart of the Warship. A tank holds ground around its patrol
 * tile and
 *  - shoots enemy tanks that come into range,
 *  - shoots down the troops of enemy attacks aimed at its owner's land,
 *  - chases enemy trains and takes them over when it catches one.
 */
export class TankExecution implements Execution {
  private active = true;
  private mg: Game;
  private tank: Unit;
  private lastShot = 0;
  private stuckTicks = 0;
  private giveUpUntil = 0;

  constructor(private input: (UnitParams<UnitType.Tank> & OwnerComp) | Unit) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    if (isUnit(this.input)) {
      this.tank = this.input;
      return;
    }
    const spawn = this.input.owner.canBuild(
      UnitType.Tank,
      this.input.patrolTile,
    );
    if (spawn === false) {
      console.warn(
        `Failed to spawn tank for ${this.input.owner.name()} at ${this.input.patrolTile}`,
      );
      this.active = false;
      return;
    }
    this.tank = this.input.owner.buildUnit(UnitType.Tank, spawn, this.input);
  }

  tick(ticks: number): void {
    if (this.tank === undefined || !this.tank.isActive()) {
      this.active = false;
      return;
    }
    this.repair(ticks);
    this.clearCombatMark(ticks);

    const reloaded = ticks - this.lastShot >= TANK.shotInterval;

    const enemyTank = this.findEnemyTank();
    if (enemyTank !== undefined) {
      this.tank.setTargetUnit(enemyTank);
      const dist = this.mg.euclideanDistSquared(
        this.tank.tile(),
        enemyTank.tile(),
      );
      if (dist <= TANK.shootRange * TANK.shootRange) {
        if (reloaded) this.shootTank(enemyTank, ticks);
      } else {
        this.driveTowards(enemyTank.tile(), ticks);
      }
      return;
    }
    this.tank.setTargetUnit(undefined);

    if (reloaded && this.shootAttackers(ticks)) {
      return;
    }

    if (ticks >= this.giveUpUntil) {
      const train = this.findEnemyTrain();
      if (train !== undefined) {
        this.tank.setTargetUnit(train);
        if (
          this.mg.euclideanDistSquared(this.tank.tile(), train.tile()) <=
          TANK.trainCaptureRange * TANK.trainCaptureRange
        ) {
          this.stealTrain(train);
        } else {
          this.driveTowards(train.tile(), ticks);
        }
        return;
      }
    }

    // Nothing to do: drive to the patrol spot (a move order sets it) and park.
    const patrol = this.tank.warshipState().patrolTile ?? this.tank.tile();
    if (
      this.mg.euclideanDistSquared(this.tank.tile(), patrol) >
      TANK.holdRadius * TANK.holdRadius
    ) {
      this.driveTowards(patrol, ticks);
    }
  }

  /** Slowly repairs while parked on the owner's own land. */
  private repair(ticks: number): void {
    if (ticks % 10 !== 0) return;
    if (this.tank.health() >= this.tank.maxHealth()) return;
    if (this.mg.owner(this.tank.tile()) === this.tank.owner()) {
      this.tank.modifyHealth(10);
    }
  }

  private clearCombatMark(ticks: number): void {
    if (
      this.tank.warshipState().isInCombat === true &&
      ticks - this.lastShot > COMBAT_MARK_TICKS
    ) {
      this.tank.updateWarshipState({ isInCombat: false });
    }
  }

  private findEnemyTank(): Unit | undefined {
    const owner = this.tank.owner();
    let best: Unit | undefined;
    let bestDist = Infinity;
    for (const { unit, distSquared } of this.mg.nearbyUnits(
      this.tank.tile(),
      TANK.targetingRange,
      [UnitType.Tank],
    )) {
      if (
        unit === this.tank ||
        unit.owner() === owner ||
        !owner.canAttackPlayer(unit.owner(), true)
      ) {
        continue;
      }
      if (distSquared < bestDist) {
        best = unit;
        bestDist = distSquared;
      }
    }
    return best;
  }

  private findEnemyTrain(): Unit | undefined {
    const owner = this.tank.owner();
    let best: Unit | undefined;
    let bestDist = Infinity;
    for (const { unit, distSquared } of this.mg.nearbyUnits(
      this.tank.tile(),
      TANK.targetingRange,
      [UnitType.Train],
    )) {
      if (
        unit.owner() === owner ||
        !owner.canAttackPlayer(unit.owner(), true)
      ) {
        continue;
      }
      if (distSquared < bestDist) {
        best = unit;
        bestDist = distSquared;
      }
    }
    return best;
  }

  private gunnerPercent(): number {
    return (
      this.mg
        .zombieRaid()
        ?.buffPercent(this.tank.owner().smallID(), "gunner") ?? 0
    );
  }

  private markCombat(ticks: number): void {
    this.lastShot = ticks;
    this.tank.updateWarshipState({ isInCombat: true });
  }

  private shootTank(target: Unit, ticks: number): void {
    this.markCombat(ticks);
    target.modifyHealth(
      -applyPercentBonus(TANK.damageToTank, this.gunnerPercent()),
      this.tank.owner(),
    );
  }

  /** Fires at the front of an enemy attack on our owner's land. */
  private shootAttackers(ticks: number): boolean {
    const owner = this.tank.owner();
    const rangeSq = TANK.attackDefenseRange * TANK.attackDefenseRange;
    for (const attack of owner.incomingAttacks()) {
      if (!attack.isActive() || attack.troops() <= 0) continue;
      let inRange = false;
      let sampled = 0;
      for (const tile of attack.borderTiles()) {
        if (this.mg.euclideanDistSquared(this.tank.tile(), tile) <= rangeSq) {
          inRange = true;
          break;
        }
        if (++sampled >= ATTACK_FRONT_SAMPLE) break;
      }
      if (!inRange) continue;
      this.markCombat(ticks);
      const killed = applyPercentBonus(
        TANK.troopsKilledPerShot,
        this.gunnerPercent(),
      );
      attack.setTroops(Math.max(0, attack.troops() - killed));
      return true;
    }
    return false;
  }

  /** Takes over the engine and every car trailing it. */
  private stealTrain(engine: Unit): void {
    const thief = this.tank.owner();
    const victim = engine.owner();
    const rangeSq = TANK.trainCarRange * TANK.trainCarRange;
    const toTake: Unit[] = [engine];
    for (const { unit } of this.mg.nearbyUnits(
      engine.tile(),
      TANK.trainCarRange,
      [UnitType.Train],
    )) {
      if (
        unit !== engine &&
        unit.owner() === victim &&
        this.mg.euclideanDistSquared(unit.tile(), engine.tile()) <= rangeSq
      ) {
        toTake.push(unit);
      }
    }
    for (const unit of toTake) {
      thief.captureUnit(unit);
    }
    this.mg.displayMessage(
      "events_display.train_captured",
      MessageType.CAPTURED_ENEMY_UNIT,
      victim.id(),
      undefined,
      { name: thief.displayName() },
      engine.id(),
      thief.id(),
    );
    this.tank.setTargetUnit(undefined);
    this.tank.touch();
  }

  /** One tile per few ticks over land. Gives up a chase when stuck. */
  private driveTowards(goal: TileRef, ticks: number): void {
    if ((ticks + this.tank.id()) % TANK.ticksPerStep !== 0) return;
    const next = stepLand(this.mg, this.tank.tile(), goal);
    if (next === undefined) {
      if (++this.stuckTicks >= STUCK_LIMIT) {
        this.stuckTicks = 0;
        this.giveUpUntil = ticks + GIVE_UP_TICKS;
        this.tank.setTargetUnit(undefined);
      }
      return;
    }
    this.stuckTicks = 0;
    this.tank.move(next);
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return TankExecutionSnapshot.write({
      active: this.active,
      initialized: this.mg !== undefined,
      input: isUnit(this.input)
        ? { unit: w.unit(this.input) }
        : {
            owner: w.player(this.input.owner),
            patrolTile: this.input.patrolTile,
          },
      tank: this.tank === undefined ? null : w.unit(this.tank),
      lastShot: this.lastShot,
      stuckTicks: this.stuckTicks,
      giveUpUntil: this.giveUpUntil,
    });
  }

  restoreSnapshot(s: TankState, r: SnapshotReader): void {
    this.active = s.active;
    if (s.initialized) this.mg = r.game;
    this.input =
      "unit" in s.input
        ? r.unit(s.input.unit)
        : { owner: r.player(s.input.owner), patrolTile: s.input.patrolTile };
    if (s.tank !== null) this.tank = r.unit(s.tank);
    this.lastShot = s.lastShot;
    this.stuckTicks = s.stuckTicks;
    this.giveUpUntil = s.giveUpUntil;
  }
}

const TankStateSchema = z.object({
  active: z.boolean(),
  initialized: z.boolean(),
  // A unit once spawned; the owner and patrol tile while it is still pending.
  input: z.union([
    z.object({ unit: zRef() }),
    z.object({ owner: zPlayerRef(), patrolTile: zTile() }),
  ]),
  tank: zRef().nullable(),
  lastShot: zInt(),
  stuckTicks: zInt(),
  giveUpUntil: zInt(),
});
type TankState = z.infer<typeof TankStateSchema>;

export const TankExecutionSnapshot = execSnapshotType({
  name: "Tank",
  version: 1,
  schema: TankStateSchema,
  cls: () => TankExecution,
});
