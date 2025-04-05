import { Execution, Game, Player, PlayerType } from "../game/Game";
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
      this.behavior = new BotBehavior(this.mg, this.bot, 1 / 20, false);
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
      for (const b of this.bot.borderTiles()) {
        for (const n of this.mg.neighbors(b)) {
          if (!this.mg.hasOwner(n) && this.mg.isLand(n)) {
            this.behavior.sendAttack(this.mg.terraNullius());
            return;
          }
        }
      }
      this.neighborsTerraNullius = false;
    }

    const border = Array.from(this.bot.borderTiles())
      .flatMap((t) => this.mg.neighbors(t))
      .filter((t) => this.mg.hasOwner(t) && this.mg.owner(t) != this.bot);

    if (border.length == 0) {
      return;
    }

    const toAttack = border[this.random.nextInt(0, border.length)];
    const owner = this.mg.owner(toAttack);

    if (owner.isPlayer()) {
      if (this.bot.isFriendly(owner)) {
        return;
      }
      if (owner.type() == PlayerType.FakeHuman) {
        if (!this.random.chance(2)) {
          return;
        }
      }
    }
    this.behavior.sendAttack(owner);
  }

  owner(): Player {
    return this.bot;
  }

  isActive(): boolean {
    return this.active;
  }
}
