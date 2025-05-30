import { Execution, Game, Player } from "../game/Game";
import { PseudoRandom } from "../PseudoRandom";
import { simpleHash } from "../Util";
import { BotBehavior } from "./utils/BotBehavior";

export class BotExecution implements Execution {
  private active = true;
  private random: PseudoRandom;
  private mg: Game;
  private neighborsTerraNullius = true;

  private behavior: BotBehavior | null = null;
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

  init(mg: Game) {
    this.mg = mg;
    this.bot.setTargetTroopRatio(0.7);
  }

  tick(ticks: number) {
    if (ticks % this.attackRate !== this.attackTick) return;

    if (!this.bot.isAlive()) {
      this.active = false;
      return;
    }

    if (this.behavior === null) {
      this.behavior = new BotBehavior(
        this.random,
        this.mg,
        this.bot,
        this.triggerRatio,
        this.reserveRatio,
      );
    }

    this.behavior.handleAllianceRequests();
    this.maybeAttack();
  }

  private maybeAttack() {
    if (this.behavior === null) {
      throw new Error("not initialized");
    }
    const traitors = this.bot
      .neighbors()
      .filter((n) => n.isPlayer() && n.isTraitor()) as Player[];
    if (traitors.length > 0) {
      const toAttack = this.random.randElement(traitors);
      const odds = this.bot.isFriendly(toAttack) ? 6 : 3;
      if (this.random.chance(odds)) {
        this.behavior.sendAttack(toAttack);
        return;
      }
    }

    if (this.neighborsTerraNullius) {
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
