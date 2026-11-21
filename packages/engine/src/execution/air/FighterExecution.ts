import { TileRef } from "@openfront/engine-api/game/GameMap";
import { AirUnits, UnitType } from "@openfront/engine-api/game/GameTypes";
import { PseudoRandom } from "@openfront/engine-lib/PseudoRandom";
import {
  zInt,
  zPlayerRef,
  zRandom,
  zRef,
  zTile,
} from "@openfront/engine-lib/snapshot/SnapshotType";
import { z } from "zod";
import { Execution, Game, isUnit, Player, Unit } from "../../game/Game";
import { execSnapshotType } from "../../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../../snapshot/SnapshotContext";
import { flightDistance, flyToward, isHostileAircraft } from "./AirUtils";

/**
 * A fighter flies combat air patrol around its home base (an airbase, or a
 * carrier it follows) and intercepts enemy aircraft that come within
 * fighterDetectionRange, never straying past fighterLeash from home. It dies
 * with its base.
 */
export class FighterExecution implements Execution {
  private active = true;
  private mg: Game;
  private fighter: Unit | null = null;
  private target: Unit | null = null;
  private patrolPoint: TileRef | null = null;
  private lastShotTick = -1000;
  private random: PseudoRandom;

  constructor(
    private player: Player,
    private home: Unit,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    this.random = new PseudoRandom(ticks + this.home.id() * 7919);
  }

  tick(ticks: number): void {
    const config = this.mg.config();
    if (this.fighter === null) {
      if (!this.home.isActive() || this.home.isUnderConstruction()) {
        this.active = false;
        return;
      }
      if (this.player.canBuild(UnitType.Fighter, this.home.tile()) === false) {
        this.active = false;
        return;
      }
      this.fighter = this.player.buildUnit(UnitType.Fighter, this.home.tile(), {
        targetUnit: this.home,
      });
      return;
    }

    if (!this.fighter.isActive()) {
      this.active = false;
      return;
    }
    if (!this.home.isActive()) {
      this.fighter.delete(false);
      this.active = false;
      return;
    }
    // A captured base's fighters go with it.
    this.player = this.fighter.owner();

    const homeTile = this.home.tile();
    if (this.target !== null && !this.validTarget(this.target, homeTile)) {
      this.target = null;
    }
    this.target ??= this.acquireTarget(homeTile);

    const speed = config.fighterSpeed();
    if (this.target !== null) {
      flyToward(this.mg, this.fighter, this.target.tile(), speed);
      const close =
        flightDistance(this.mg, this.fighter.tile(), this.target.tile()) <=
        config.fighterGunRange();
      if (close && ticks - this.lastShotTick >= config.fighterFireTicks()) {
        this.lastShotTick = ticks;
        // modifyHealth destroys the target when it reaches zero.
        this.target.modifyHealth(-config.fighterDamage(), this.player);
        if (!this.target.isActive()) {
          this.target = null;
        }
      }
      return;
    }

    // Combat air patrol: random points around home.
    if (
      this.patrolPoint === null ||
      flightDistance(this.mg, this.patrolPoint, homeTile) >
        config.fighterPatrolRadius() * 2
    ) {
      this.patrolPoint = this.randomPatrolPoint(homeTile);
    }
    if (flyToward(this.mg, this.fighter, this.patrolPoint, speed)) {
      this.patrolPoint = null;
    }
  }

  private validTarget(target: Unit, homeTile: TileRef): boolean {
    return (
      isHostileAircraft(this.player, target) &&
      flightDistance(this.mg, homeTile, target.tile()) <=
        this.mg.config().fighterLeash()
    );
  }

  private acquireTarget(homeTile: TileRef): Unit | null {
    if (this.fighter === null) return null;
    const found = this.mg.nearbyUnits(
      this.fighter.tile(),
      this.mg.config().fighterDetectionRange(),
      AirUnits.types,
      ({ unit }) =>
        isUnit(unit) &&
        isHostileAircraft(this.player, unit) &&
        flightDistance(this.mg, homeTile, unit.tile()) <=
          this.mg.config().fighterLeash(),
    );
    if (found.length === 0) return null;
    found.sort(
      (a, b) => a.distSquared - b.distSquared || a.unit.id() - b.unit.id(),
    );
    return found[0].unit as Unit;
  }

  private randomPatrolPoint(homeTile: TileRef): TileRef {
    const r = this.mg.config().fighterPatrolRadius();
    const x = Math.max(
      0,
      Math.min(
        this.mg.width() - 1,
        this.mg.x(homeTile) + this.random.nextInt(-r, r + 1),
      ),
    );
    const y = Math.max(
      0,
      Math.min(
        this.mg.height() - 1,
        this.mg.y(homeTile) + this.random.nextInt(-r, r + 1),
      ),
    );
    return this.mg.ref(x, y);
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return FighterExecutionSnapshot.write({
      active: this.active,
      init:
        this.mg === undefined ? null : { random: w.random(this.random) },
      player: w.player(this.player),
      home: w.unit(this.home),
      fighter: w.unitOrNull(this.fighter),
      target: w.unitOrNull(this.target),
      patrolPoint: this.patrolPoint,
      lastShotTick: this.lastShotTick,
    });
  }

  restoreSnapshot(s: FighterState, r: SnapshotReader): void {
    this.active = s.active;
    if (s.init !== null) {
      this.mg = r.game;
      this.random = r.random(s.init.random);
    }
    this.player = r.player(s.player);
    this.home = r.unit(s.home);
    this.fighter = r.unitOrNull(s.fighter);
    this.target = r.unitOrNull(s.target);
    this.patrolPoint = s.patrolPoint;
    this.lastShotTick = s.lastShotTick;
  }
}

const FighterStateSchema = z.object({
  active: z.boolean(),
  init: z.object({ random: zRandom() }).nullable(),
  player: zPlayerRef(),
  home: zRef(),
  fighter: zRef().nullable(),
  target: zRef().nullable(),
  patrolPoint: zTile().nullable(),
  lastShotTick: zInt(),
});
type FighterState = z.infer<typeof FighterStateSchema>;

export const FighterExecutionSnapshot = execSnapshotType({
  name: "Fighter",
  version: 1,
  schema: FighterStateSchema,
  cls: () => FighterExecution,
});
