import { Execution, Game, Player } from "../game/Game";
import { PseudoRandom } from "../PseudoRandom";
import { simpleHash } from "../Util";
import { AllianceExtensionExecution } from "./alliance/AllianceExtensionExecution";
import { AiAttackBehavior } from "./utils/AiAttackBehavior";

export class BotExecution implements Execution {
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

  constructor(private bot: Player) {
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

    if (this.attackBehavior === null) {
      this.attackBehavior = new AiAttackBehavior(
        this.random,
        this.mg,
        this.bot,
        this.triggerRatio,
        this.reserveRatio,
        this.expandRatio,
      );

      // Send an attack on the first tick
      this.attackBehavior.sendAttack(this.mg.terraNullius());
      return;
    }

    this.acceptAllAllianceRequests();
    this.maybeAttack();
  }

  private acceptAllAllianceRequests() {
    // Accept all alliance requests
    for (const req of this.bot.incomingAllianceRequests()) {
      req.accept();
    }

    // Accept all alliance extension requests
    for (const alliance of this.bot.alliances()) {
      // Alliance expiration tracked by Events Panel, only human ally can click Request to Renew
      // Skip if no expiration yet/ ally didn't request extension yet / bot already agreed to extend
      if (!alliance.onlyOneAgreedToExtend()) continue;

      const human = alliance.other(this.bot);
      this.mg.addExecution(
        new AllianceExtensionExecution(this.bot, human.id()),
      );
    }
  }

  private maybeAttack() {
    if (this.attackBehavior === null) {
      throw new Error("not initialized");
    }
    const toAttack = this.attackBehavior.getNeighborTraitorToAttack();
    if (toAttack !== null) {
      const odds = this.bot.isFriendly(toAttack) ? 6 : 3;
      if (this.random.chance(odds)) {
        // Check and break alliance before attacking if needed
        const alliance = this.bot.allianceWith(toAttack);

        if (alliance !== null) {
          this.bot.breakAlliance(alliance);
        }

        this.attackBehavior.sendAttack(toAttack);
        return;
      }
    }

    if (this.neighborsTerraNullius) {
      if (this.bot.sharesBorderWith(this.mg.terraNullius())) {
        this.attackBehavior.sendAttack(this.mg.terraNullius());
        return;
      }
      this.neighborsTerraNullius = false;
    }

    this.attackBehavior.attackRandomTarget();
  }

  isActive(): boolean {
    return this.active;
  }
}
