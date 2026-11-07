import { TileRef } from "@openfront/engine-api/game/GameMap";
import { UnitType } from "@openfront/engine-api/game/GameTypes";
import {
  buffIndex,
  CURE_TARGET,
  emptyBuffStacks,
  SurvivorBuffKind,
  survivorBuffPercent,
} from "@openfront/engine-lib/game/ModRules";

/** A unit that died while the outbreak was on and is waiting to rise again. */
export interface PendingDeath {
  type: UnitType;
  tile: TileRef;
  formerOwnerSmallID: number;
}

/** Unit types that rise again as zombies when they die. */
export const REANIMATED_UNIT_TYPES: readonly UnitType[] = [
  UnitType.Tank,
  UnitType.FighterJet,
  UnitType.Warship,
] as const;

/**
 * Everything the Zombie Raid mode tracks about a running game. The
 * authoritative copy is owned and snapshotted by ZombieRaidExecution; the Game
 * only holds a reference so units and rules can read it.
 */
export class ZombieRaidState {
  /** Tick at which the outbreak starts. */
  outbreakTick = 0;
  outbroken = false;
  /** Small id of the zombie faction, 0 until the outbreak creates it. */
  zombieSmallID = 0;
  survivorsRescued = 0;
  /** Cure research points per player small id. */
  readonly cure = new Map<number, number>();
  /** Rescued survivors per player small id, indexed like SURVIVOR_BUFF_KINDS. */
  readonly buffs = new Map<number, number[]>();
  readonly pendingDeaths: PendingDeath[] = [];

  curePoints(smallID: number): number {
    return this.cure.get(smallID) ?? 0;
  }

  isCured(smallID: number): boolean {
    return this.curePoints(smallID) >= CURE_TARGET;
  }

  stacks(smallID: number, kind: SurvivorBuffKind): number {
    return this.buffs.get(smallID)?.[buffIndex(kind)] ?? 0;
  }

  /** Percent bonus the player gets from rescued survivors of `kind`. */
  buffPercent(smallID: number, kind: SurvivorBuffKind): number {
    return survivorBuffPercent(this.stacks(smallID, kind));
  }

  addStack(smallID: number, kind: SurvivorBuffKind): void {
    let stacks = this.buffs.get(smallID);
    if (stacks === undefined) {
      stacks = emptyBuffStacks();
      this.buffs.set(smallID, stacks);
    }
    stacks[buffIndex(kind)]++;
  }
}
