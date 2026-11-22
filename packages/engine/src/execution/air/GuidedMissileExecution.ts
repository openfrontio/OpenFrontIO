import { TileRef } from "@openfront/engine-api/game/GameMap";
import { MessageType, UnitType } from "@openfront/engine-api/game/GameTypes";
import {
  FLARE_DECOY_PERCENT,
  GUIDED_MISSILE_LIFETIME,
  isAircraftType,
  stepToward,
} from "@openfront/engine-lib/game/AirRules";
import { PseudoRandom } from "@openfront/engine-lib/PseudoRandom";
import {
  zInt,
  zPlayerRef,
  zRandom,
  zRef,
  zTile,
} from "@openfront/engine-lib/snapshot/SnapshotType";
import { z } from "zod";
import { Execution, Game, Player, Unit } from "../../game/Game";
import { execSnapshotType } from "../../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../../snapshot/SnapshotContext";

export interface GuidedMissileProfile {
  /** Tiles per tick. */
  speed: number;
  damage: number;
  /** Percent chance to hit when not decoyed. */
  hitPercent: number;
}

/**
 * AIR update: a guided missile homing on an aircraft — fired by SAM
 * launchers at high flyers and by fighters at any aircraft.
 *
 * It reuses the SAMMissile unit (and its sprite) for the projectile. On
 * reaching the target, a flare (if the target has any left) is expended and
 * may decoy the missile; otherwise the missile hits with `hitPercent`
 * probability. Rolls come from a seeded PRNG kept in the snapshot.
 */
export class GuidedMissileExecution implements Execution {
  private active = true;
  private missile: Unit | undefined;
  private mg: Game;
  private random: PseudoRandom;
  private expiresAt = -1;

  constructor(
    private spawn: TileRef,
    private _owner: Player,
    private target: Unit,
    private speed: number,
    private damage: number,
    private hitPercent: number,
  ) {}

  static fire(
    spawn: TileRef,
    owner: Player,
    target: Unit,
    profile: GuidedMissileProfile,
  ): GuidedMissileExecution {
    return new GuidedMissileExecution(
      spawn,
      owner,
      target,
      profile.speed,
      profile.damage,
      profile.hitPercent,
    );
  }

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    this.random = new PseudoRandom(ticks * 7919 + this.target.id());
    this.expiresAt = ticks + GUIDED_MISSILE_LIFETIME;
  }

  tick(ticks: number): void {
    this.missile ??= this._owner.buildUnit(UnitType.SAMMissile, this.spawn, {
      targetUnit: this.target,
    });
    if (!this.missile.isActive()) {
      this.active = false;
      return;
    }
    if (
      !this.target.isActive() ||
      this.target.owner() === this._owner ||
      ticks >= this.expiresAt
    ) {
      this.finish();
      return;
    }
    for (let i = 0; i < this.speed; i++) {
      const goal = this.target.tile();
      if (this.missile.tile() === goal) {
        this.resolveImpact();
        return;
      }
      this.missile.move(stepToward(this.mg, this.missile.tile(), goal));
    }
    if (this.missile.tile() === this.target.tile()) {
      this.resolveImpact();
    }
  }

  private resolveImpact(): void {
    const target = this.target;
    if (isAircraftType(target.type())) {
      const { flares } = target.aircraftState();
      if (flares > 0) {
        target.updateAircraftState({ flares: flares - 1 });
        if (this.random.nextInt(0, 100) < FLARE_DECOY_PERCENT) {
          this.mg.displayMessage(
            "events_display.missile_decoyed",
            MessageType.SAM_MISS,
            target.owner().id(),
          );
          this.finish();
          return;
        }
      }
    }
    if (this.random.nextInt(0, 100) < this.hitPercent) {
      this.missile!.setReachedTarget();
      target.modifyHealth(-this.damage, this._owner);
    }
    this.finish();
  }

  private finish(): void {
    if (this.missile?.isActive()) this.missile.delete(false);
    this.active = false;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return GuidedMissileExecutionSnapshot.write({
      active: this.active,
      initialized: this.mg !== undefined,
      missile: w.unitOrNull(this.missile ?? null),
      random: this.random === undefined ? null : w.random(this.random),
      expiresAt: this.expiresAt,
      spawn: this.spawn,
      owner: w.player(this._owner),
      target: w.unit(this.target),
      speed: this.speed,
      damage: this.damage,
      hitPercent: this.hitPercent,
    });
  }

  restoreSnapshot(s: GuidedMissileState, r: SnapshotReader): void {
    this.active = s.active;
    if (s.initialized) this.mg = r.game;
    if (s.missile !== null) this.missile = r.unit(s.missile);
    if (s.random !== null) this.random = r.random(s.random);
    this.expiresAt = s.expiresAt;
    this.spawn = s.spawn;
    this._owner = r.player(s.owner);
    this.target = r.unit(s.target);
    this.speed = s.speed;
    this.damage = s.damage;
    this.hitPercent = s.hitPercent;
  }
}

const GuidedMissileStateSchema = z.object({
  active: z.boolean(),
  initialized: z.boolean(),
  missile: zRef().nullable(),
  random: zRandom().nullable(),
  expiresAt: zInt(),
  spawn: zTile(),
  owner: zPlayerRef(),
  target: zRef(),
  speed: zInt(),
  damage: zInt(),
  hitPercent: zInt(),
});
type GuidedMissileState = z.infer<typeof GuidedMissileStateSchema>;

export const GuidedMissileExecutionSnapshot = execSnapshotType({
  name: "GuidedMissile",
  version: 1,
  schema: GuidedMissileStateSchema,
  cls: () => GuidedMissileExecution,
});
