import { z } from "zod";
import { Execution, Game, Player, Structures } from "../game/Game";
import { PseudoRandom } from "../PseudoRandom";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";
import {
  VersionedSchema,
  zNum,
  zPlayerRef,
  zRandom,
} from "../snapshot/SnapshotType";
import { simpleHash } from "../Util";
import { AllianceExtensionExecution } from "./alliance/AllianceExtensionExecution";
import { DeleteUnitExecution } from "./DeleteUnitExecution";
import { AiAttackBehavior } from "./utils/AiAttackBehavior";

export class TribeExecution implements Execution {
  private active = true;
  private random: PseudoRandom;
  private mg: Game;
  private neighborsTerraNullius = true;

  private attackBehavior: AiAttackBehavior | null = null;
  private attackRate: number;
  private attackTick: number;
  private triggerRatio: number;
  private reserveRatio: number;
  private expandRatio: number;

  constructor(private tribe: Player) {
    this.random = new PseudoRandom(simpleHash(tribe.id()));
    this.attackRate = this.random.nextInt(40, 80);
    this.attackTick = this.random.nextInt(0, this.attackRate);
    this.triggerRatio = this.random.nextInt(50, 60) / 100;
    this.reserveRatio = this.random.nextInt(30, 40) / 100;
    this.expandRatio = this.random.nextInt(10, 20) / 100;
  }

  playerID(): string {
    return this.tribe.id();
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  init(mg: Game) {
    this.mg = mg;
  }

  tick(ticks: number) {
    if (ticks % this.attackRate !== this.attackTick) return;

    if (!this.tribe.isAlive()) {
      //removeOnDeath is called from tribe's PlayerExecution
      this.active = false;
      return;
    }

    if (this.attackBehavior === null) {
      this.attackBehavior = new AiAttackBehavior(
        this.random,
        this.mg,
        this.tribe,
        this.triggerRatio,
        this.reserveRatio,
        this.expandRatio,
      );

      // Send an attack on the first tick
      this.attackBehavior.sendAttack(this.mg.terraNullius());
      return;
    }

    this.acceptAllAllianceRequests();
    this.deleteNextStructure();
    this.maybeAttack();
  }

  private acceptAllAllianceRequests() {
    // Accept all alliance requests
    for (const req of this.tribe.incomingAllianceRequests()) {
      req.accept();
    }

    // Accept all alliance extension requests
    for (const alliance of this.tribe.alliances()) {
      // Alliance expiration tracked by Events Panel, only human ally can click Request to Renew
      // Skip if no expiration yet/ ally didn't request extension yet / tribe already agreed to extend
      if (!alliance.onlyOneAgreedToExtend()) continue;

      const human = alliance.other(this.tribe);
      this.mg.addExecution(
        new AllianceExtensionExecution(this.tribe, human.id()),
      );
    }
  }

  private deleteNextStructure() {
    if (!this.tribe.canDeleteUnit()) return;
    for (const unit of this.tribe.units()) {
      if (!Structures.has(unit.type())) continue;
      if (unit.isMarkedForDeletion()) continue;
      this.mg.addExecution(new DeleteUnitExecution(this.tribe, unit.id()));
      return;
    }
  }

  private maybeAttack() {
    if (this.attackBehavior === null) {
      throw new Error("not initialized");
    }
    const toAttack = this.attackBehavior.getNeighborTraitorToAttack();
    if (toAttack !== null) {
      const odds = this.tribe.isFriendly(toAttack) ? 6 : 3;
      if (this.random.chance(odds)) {
        // Check and break alliance before attacking if needed
        const alliance = this.tribe.allianceWith(toAttack);

        if (alliance !== null) {
          this.tribe.breakAlliance(alliance);
        }

        if (this.attackBehavior.sendAttack(toAttack)) return;
      }
    }

    if (this.neighborsTerraNullius) {
      if (this.tribe.nearby().some((n) => !n.isPlayer())) {
        if (this.attackBehavior.sendAttack(this.mg.terraNullius())) return;
      } else {
        this.neighborsTerraNullius = false;
      }
    }

    this.attackBehavior.attackRandomTarget();
  }

  isActive(): boolean {
    return this.active;
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return TribeExecutionSnapshot.write({
      active: this.active,
      tribe: w.player(this.tribe),
      random: w.random(this.random),
      initialized: this.mg !== undefined,
      neighborsTerraNullius: this.neighborsTerraNullius,
      attackBehavior: this.attackBehavior?.snapshot(w) ?? null,
      attackRate: this.attackRate,
      attackTick: this.attackTick,
      triggerRatio: this.triggerRatio,
      reserveRatio: this.reserveRatio,
      expandRatio: this.expandRatio,
    });
  }

  restoreSnapshot(s: TribeState, r: SnapshotReader): void {
    this.active = s.active;
    this.tribe = r.player(s.tribe);
    // One PRNG shared with the attack behavior, as in a live game.
    this.random = r.random(s.random);
    if (s.initialized) this.mg = r.game;
    this.neighborsTerraNullius = s.neighborsTerraNullius;
    if (s.attackBehavior === null) {
      this.attackBehavior = null;
    } else {
      const attack = Object.create(
        AiAttackBehavior.prototype,
      ) as AiAttackBehavior;
      attack.restoreSnapshot(s.attackBehavior, r, this.random, this.tribe);
      this.attackBehavior = attack;
    }
    this.attackRate = s.attackRate;
    this.attackTick = s.attackTick;
    this.triggerRatio = s.triggerRatio;
    this.reserveRatio = s.reserveRatio;
    this.expandRatio = s.expandRatio;
  }
}

const TribeStateSchema = z.object({
  active: z.boolean(),
  tribe: zPlayerRef(),
  random: zRandom(),
  initialized: z.boolean(),
  neighborsTerraNullius: z.boolean(),
  attackBehavior: VersionedSchema.nullable(),
  attackRate: zNum(),
  attackTick: zNum(),
  triggerRatio: zNum(),
  reserveRatio: zNum(),
  expandRatio: zNum(),
});
type TribeState = z.infer<typeof TribeStateSchema>;

export const TribeExecutionSnapshot = execSnapshotType({
  name: "Tribe",
  version: 1,
  schema: TribeStateSchema,
  cls: () => TribeExecution,
});
