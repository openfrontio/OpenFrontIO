import { Execution, Game, Player } from "../game/Game";
import { PseudoRandom } from "../PseudoRandom";
import { simpleHash } from "../Util";
import { BotBehavior } from "./utils/BotBehavior";

export class BotExecution implements Execution {
  private active = true;
  private random: PseudoRandom;
  private attackRate: number;
  private mg: Game;
  private neighborsTerraNullius = true;

  private behavior: BotBehavior | null = null;

  constructor(private bot: Player) {
    this.random = new PseudoRandom(simpleHash(bot.id()));
    this.attackRate = this.random.nextInt(10, 50);
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  init(mg: Game) {
    this.mg = mg;
    this.bot.setTargetTroopRatio(0.7);
  }

  tick(ticks: number) {
    if (!this.bot.isAlive()) {
      this.active = false;
      return;
    }

    if (ticks % this.attackRate != 0) {
      return;
    }

    if (this.behavior === null) {
      this.behavior = new BotBehavior(this.random, this.mg, this.bot, 1 / 20);
    }

    this.behavior.handleAllianceRequests();
    this.maybeAttack();
  }

  private maybeAttack() {
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

    const enemy = this.behavior.selectRandomEnemy();
    if (!enemy) return;
    this.behavior.sendAttack(enemy);
  }

  owner(): Player {
    return this.bot;
  }

  isActive(): boolean {
    return this.active;
  }
}
