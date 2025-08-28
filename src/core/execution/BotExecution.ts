import { Execution, Game, Player } from "../game/Game";
import { BotBehavior } from "./utils/BotBehavior";
import { PseudoRandom } from "../PseudoRandom";
import { simpleHash } from "../Util";

export class BotExecution implements Execution {
  private active = true;
  private readonly random: PseudoRandom;
  private mg: Game | undefined;
  private neighborsTerraNullius = true;

  private behavior: BotBehavior | null = null;
  private readonly attackRate: number;
  private readonly attackTick: number;
  private readonly triggerRatio: number;
  private readonly reserveRatio: number;
  private readonly expandRatio: number;

  constructor(private readonly bot: Player) {
    this.random = new PseudoRandom(simpleHash(bot.id()));
    this.attackRate = this.random.nextInt(40, 80);
    this.attackTick = this.random.nextInt(0, this.attackRate);
    this.triggerRatio = this.random.nextInt(50, 60) / 100;
    this.reserveRatio = this.random.nextInt(30, 40) / 100;
    this.expandRatio = this.random.nextInt(10, 20) / 100;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  init(mg: Game) {
    this.mg = mg;
  }

  tick(ticks: number) {
    if (ticks % this.attackRate !== this.attackTick) return;

    if (!this.bot.isAlive()) {
      this.active = false;
      return;
    }

    if (this.behavior === null) {
      if (this.mg === undefined) throw new Error("Not initialized");
      this.behavior = new BotBehavior(
        this.random,
        this.mg,
        this.bot,
        this.triggerRatio,
        this.reserveRatio,
        this.expandRatio,
      );

      // Send an attack on the first tick
      this.behavior.sendAttack(this.mg.terraNullius());
      return;
    }

    this.behavior.handleAllianceRequests();
    this.behavior.handleAllianceExtensionRequests();
    this.maybeAttack();
  }

  private maybeAttack() {
    if (this.behavior === null) {
      throw new Error("Not initialized");
    }
    const toAttack = this.behavior.getNeighborTraitorToAttack();
    if (toAttack !== null) {
      const odds = this.bot.isFriendly(toAttack) ? 6 : 3;
      if (this.random.chance(odds)) {
        this.behavior.sendAttack(toAttack);
        return;
      }
    }

    if (this.neighborsTerraNullius) {
      if (this.mg === undefined) throw new Error("Not initialized");
      if (this.bot.sharesBorderWith(this.mg.terraNullius())) {
        this.behavior.sendAttack(this.mg.terraNullius());
        return;
      }
      this.neighborsTerraNullius = false;
    }

    this.behavior.forgetOldEnemies();
    const enemy = this.behavior.selectRandomEnemy();
    if (!enemy) return;
    if (!this.bot.sharesBorderWith(enemy)) return;
    this.behavior.sendAttack(enemy);
  }

  isActive(): boolean {
    return this.active;
  }
}
