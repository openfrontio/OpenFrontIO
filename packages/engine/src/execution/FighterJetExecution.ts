import { TileRef } from "@openfront/engine-api/game/GameMap";
import { UnitType } from "@openfront/engine-api/game/GameTypes";
import {
  applyPercentBonus,
  FIGHTER_JET,
} from "@openfront/engine-lib/game/ModRules";
import {
  zInt,
  zPlayerRef,
  zRef,
  zTile,
} from "@openfront/engine-lib/snapshot/SnapshotType";
import { findClosestBy } from "@openfront/engine-lib/Util";
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
import { stepAir } from "./ModMovement";

const COMBAT_MARK_TICKS = 30;
// Within this many tiles a jet counts as on top of its target.
const STRIKE_RANGE = 6;

/**
 * Air superiority fighter. Launched from an airport, it patrols around its
 * patrol tile and
 *  - steals enemy cargo planes it catches,
 *  - dogfights enemy fighter jets,
 *  - bombs enemy tanks.
 * A damaged jet flies home to its nearest airport to repair.
 */
export class FighterJetExecution implements Execution {
  private active = true;
  private mg: Game;
  private jet: Unit;
  private lastShot = 0;
  private repairing = false;

  constructor(
    private input: (UnitParams<UnitType.FighterJet> & OwnerComp) | Unit,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    if (isUnit(this.input)) {
      this.jet = this.input;
      return;
    }
    const spawn = this.input.owner.canBuild(
      UnitType.FighterJet,
      this.input.patrolTile,
    );
    if (spawn === false) {
      console.warn(
        `Failed to spawn fighter jet for ${this.input.owner.name()} at ${this.input.patrolTile}`,
      );
      this.active = false;
      return;
    }
    this.jet = this.input.owner.buildUnit(
      UnitType.FighterJet,
      spawn,
      this.input,
    );
  }

  tick(ticks: number): void {
    if (this.jet === undefined || !this.jet.isActive()) {
      this.active = false;
      return;
    }
    if (
      this.jet.warshipState().isInCombat === true &&
      ticks - this.lastShot > COMBAT_MARK_TICKS
    ) {
      this.jet.updateWarshipState({ isInCombat: false });
    }

    if (this.handleRepair()) {
      return;
    }

    const target = this.findTarget();
    if (target === undefined) {
      this.jet.setTargetUnit(undefined);
      this.returnToPatrol();
      return;
    }
    this.jet.setTargetUnit(target);
    this.engage(target, ticks);
  }

  /** Returns true while the jet is heading to, or sitting at, an airport. */
  private handleRepair(): boolean {
    const owner = this.jet.owner();
    const threshold = Math.floor(
      (this.jet.maxHealth() * FIGHTER_JET.retreatHealthPercent) / 100,
    );
    const airport = findClosestBy(
      owner.units(UnitType.Airport),
      (a) => this.mg.manhattanDist(a.tile(), this.jet.tile()),
      (a) => a.isActive() && !a.isUnderConstruction(),
    );

    if (!this.repairing) {
      if (this.jet.health() < threshold && airport !== null) {
        this.repairing = true;
      } else {
        return false;
      }
    }
    if (airport === null || this.jet.health() >= this.jet.maxHealth()) {
      this.repairing = false;
      return false;
    }
    const home = airport.tile();
    if (
      this.mg.euclideanDistSquared(this.jet.tile(), home) <=
      FIGHTER_JET.repairRange * FIGHTER_JET.repairRange
    ) {
      this.jet.modifyHealth(FIGHTER_JET.repairPerTick);
    } else {
      this.flyTowards(home);
    }
    return true;
  }

  private findTarget(): Unit | undefined {
    const owner = this.jet.owner();
    let best: Unit | undefined;
    let bestPriority = Infinity;
    let bestDist = Infinity;
    for (const { unit, distSquared } of this.mg.nearbyUnits(
      this.jet.tile(),
      FIGHTER_JET.targetingRange,
      [UnitType.CargoPlane, UnitType.FighterJet, UnitType.Tank],
    )) {
      if (
        unit === this.jet ||
        !unit.isActive() ||
        unit.owner() === owner ||
        !owner.canAttackPlayer(unit.owner(), true)
      ) {
        continue;
      }
      const priority =
        unit.type() === UnitType.CargoPlane
          ? 0
          : unit.type() === UnitType.FighterJet
            ? 1
            : 2;
      if (
        priority < bestPriority ||
        (priority === bestPriority && distSquared < bestDist)
      ) {
        best = unit;
        bestPriority = priority;
        bestDist = distSquared;
      }
    }
    return best;
  }

  private engage(target: Unit, ticks: number): void {
    const dist = this.mg.euclideanDistSquared(this.jet.tile(), target.tile());
    if (target.type() === UnitType.CargoPlane) {
      if (dist <= FIGHTER_JET.captureRange * FIGHTER_JET.captureRange) {
        this.jet.owner().captureUnit(target);
        this.jet.setTargetUnit(undefined);
        this.jet.touch();
        return;
      }
      this.flyTowards(target.tile());
      return;
    }

    if (dist > STRIKE_RANGE * STRIKE_RANGE) {
      this.flyTowards(target.tile());
      return;
    }
    if (ticks - this.lastShot < FIGHTER_JET.shotInterval) return;
    this.lastShot = ticks;
    this.jet.updateWarshipState({ isInCombat: true });
    const gunner =
      this.mg.zombieRaid()?.buffPercent(this.jet.owner().smallID(), "gunner") ??
      0;
    const base =
      target.type() === UnitType.FighterJet
        ? FIGHTER_JET.damageToJet
        : FIGHTER_JET.damageToTank;
    target.modifyHealth(-applyPercentBonus(base, gunner), this.jet.owner());
  }

  private returnToPatrol(): void {
    const patrol = this.jet.warshipState().patrolTile ?? this.jet.tile();
    if (
      this.mg.euclideanDistSquared(this.jet.tile(), patrol) >
      STRIKE_RANGE * STRIKE_RANGE
    ) {
      this.flyTowards(patrol);
    }
  }

  private flyTowards(goal: TileRef): void {
    let cur = this.jet.tile();
    for (let i = 0; i < FIGHTER_JET.speed && cur !== goal; i++) {
      cur = stepAir(this.mg, cur, goal);
    }
    if (cur !== this.jet.tile()) this.jet.move(cur);
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return FighterJetExecutionSnapshot.write({
      active: this.active,
      initialized: this.mg !== undefined,
      input: isUnit(this.input)
        ? { unit: w.unit(this.input) }
        : {
            owner: w.player(this.input.owner),
            patrolTile: this.input.patrolTile,
          },
      jet: this.jet === undefined ? null : w.unit(this.jet),
      lastShot: this.lastShot,
      repairing: this.repairing,
    });
  }

  restoreSnapshot(s: FighterJetState, r: SnapshotReader): void {
    this.active = s.active;
    if (s.initialized) this.mg = r.game;
    this.input =
      "unit" in s.input
        ? r.unit(s.input.unit)
        : { owner: r.player(s.input.owner), patrolTile: s.input.patrolTile };
    if (s.jet !== null) this.jet = r.unit(s.jet);
    this.lastShot = s.lastShot;
    this.repairing = s.repairing;
  }
}

const FighterJetStateSchema = z.object({
  active: z.boolean(),
  initialized: z.boolean(),
  // A unit once spawned; the owner and patrol tile while it is still pending.
  input: z.union([
    z.object({ unit: zRef() }),
    z.object({ owner: zPlayerRef(), patrolTile: zTile() }),
  ]),
  jet: zRef().nullable(),
  lastShot: zInt(),
  repairing: z.boolean(),
});
type FighterJetState = z.infer<typeof FighterJetStateSchema>;

export const FighterJetExecutionSnapshot = execSnapshotType({
  name: "FighterJet",
  version: 1,
  schema: FighterJetStateSchema,
  cls: () => FighterJetExecution,
});
