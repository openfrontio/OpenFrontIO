import {
  Execution,
  Game,
  Player,
  PlayerType,
  Relation,
  TerraNullius,
  Tick,
} from "../game/Game";
import { PseudoRandom } from "../PseudoRandom";
import { simpleHash } from "../Util";
import { AttackExecution } from "./AttackExecution";

export class BotExecution implements Execution {
  private active = true;
  private random: PseudoRandom;
  private mg: Game;
  private neighborsTerraNullius = true;

  private enemy: Player | null = null;
  private lastEnemyUpdateTick: Tick;
  private attackRate: number;
  private attackTick: number;
  private triggerRatio: number;
  private reserveRatio: number;

  constructor(private bot: Player) {
    this.random = new PseudoRandom(simpleHash(bot.id()));
    this.attackRate = this.random.nextInt(40, 80);
    this.attackTick = this.random.nextInt(0, this.attackRate);
    this.triggerRatio = this.random.nextInt(60, 90) / 100;
    this.reserveRatio = this.random.nextInt(30, 60) / 100;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  init(mg: Game, ticks: number) {
    this.mg = mg;
    this.bot.setTargetTroopRatio(0.7);
  }

  tick(ticks: number) {
    if (ticks % this.attackRate != this.attackTick) return;

    if (!this.bot.isAlive()) {
      this.active = false;
      return;
    }

    this.handleAllianceRequests();
    this.maybeAttack();
  }

  private handleAllianceRequests() {
    this.bot.incomingAllianceRequests().forEach((ar) => {
      const requestorIsMuchLarger =
        ar.requestor().numTilesOwned() > this.bot.numTilesOwned() * 3;
      if (
        ar.requestor().isTraitor() ||
        this.bot.relation(ar.requestor()) < Relation.Neutral ||
        (!requestorIsMuchLarger && ar.requestor().alliances().length >= 3)
      ) {
        ar.reject();
      } else {
        ar.accept();
      }
    });
  }

  private maybeAttack() {
    if (this.neighborsTerraNullius) {
      for (const b of this.bot.borderTiles()) {
        for (const n of this.mg.neighbors(b)) {
          if (!this.mg.hasOwner(n) && this.mg.isLand(n)) {
            this.sendAttack(this.mg.terraNullius());
            return;
          }
        }
      }
      this.neighborsTerraNullius = false;
    }

    if (this.mg.ticks() - this.lastEnemyUpdateTick > 100) {
      this.enemy = null;
    }

    // Switch enemies if we're under attack
    const incomingAttacks = this.bot.incomingAttacks();
    if (incomingAttacks.length > 0) {
      this.enemy = incomingAttacks
        .sort((a, b) => b.troops() - a.troops())[0]
        .attacker();
      this.lastEnemyUpdateTick = this.mg.ticks();
    }

    if (this.enemy === null) {
      // Save up troops until we reach the trigger ratio
      const maxPop = this.mg.config().maxPopulation(this.bot);
      const ratio = this.bot.population() / maxPop;
      if (ratio < this.triggerRatio) return;

      // Choose a new enemy randomly
      const border = Array.from(this.bot.borderTiles())
        .flatMap((t) => this.mg.neighbors(t))
        .filter(
          (t) => this.mg.isLand(t) && this.mg.ownerID(t) != this.bot.smallID(),
        );
      if (border.length > 0) {
        const toAttack = this.random.randElement(border);
        const owner = this.mg.owner(toAttack);
        if (!owner.isPlayer()) {
          this.sendAttack(this.mg.terraNullius());
          this.neighborsTerraNullius = true;
          return;
        }
        this.enemy = owner;
        this.lastEnemyUpdateTick = this.mg.ticks();
      }

      // Select a traitor as an enemy
      const traitors = this.bot
        .neighbors()
        .filter((n) => n.isPlayer() && n.isTraitor()) as Player[];
      if (traitors.length > 0) {
        const toAttack = this.random.randElement(traitors);
        const odds = this.bot.isFriendly(toAttack) ? 6 : 3;
        if (this.random.chance(odds)) {
          this.enemy = toAttack;
          this.lastEnemyUpdateTick = this.mg.ticks();
        }
      }
    }

    if (this.enemy) {
      if (this.bot.isFriendly(this.enemy) && this.random.chance(50)) {
        this.enemy = null;
        return;
      }
      if (this.enemy.type() == PlayerType.FakeHuman) {
        if (!this.random.chance(2)) {
          return;
        }
      }
      this.sendAttack(this.enemy);
    }
  }

  private sendAttack(toAttack: Player | TerraNullius) {
    if (toAttack.isPlayer() && this.bot.isOnSameTeam(toAttack)) return;
    const maxPop = this.mg.config().maxPopulation(this.bot);
    const max = maxPop * this.bot.targetTroopRatio();
    const target = max * this.reserveRatio;
    const troops = this.bot.troops() - target;
    if (troops < 1) return;
    this.mg.addExecution(
      new AttackExecution(
        troops,
        this.bot.id(),
        toAttack.isPlayer() ? toAttack.id() : null,
      ),
    );
  }

  isActive(): boolean {
    return this.active;
  }
}
