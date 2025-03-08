import {
  Execution,
  Game,
  Player,
  PlayerType,
  TerraNullius,
} from "../game/Game";
import { PseudoRandom } from "../PseudoRandom";
import { simpleHash } from "../Util";
import { AttackExecution } from "./AttackExecution";

export class BotExecution implements Execution {
  private active = true;
  private random: PseudoRandom;
  private attackRate: number;
  private mg: Game;
  private neighborsTerraNullius = true;

  constructor(private bot: Player) {
    this.random = new PseudoRandom(simpleHash(bot.id()));
    this.attackRate = this.random.nextInt(10, 50);
  }
  activeDuringSpawnPhase(): boolean {
    return false;
  }

  init(mg: Game, ticks: number) {
    this.mg = mg;
    this.bot.setTargetTroopRatio(0.7);
    // this.neighborsTerra = this.bot.neighbors().filter(n => n == this.gs.terraNullius()).length > 0
  }

  tick(ticks: number) {
    if (!this.bot.isAlive()) {
      this.active = false;
      return;
    }

    if (ticks % this.attackRate != 0) {
      return;
    }

    this.bot.incomingAllianceRequests().forEach((ar) => {
      if (ar.requestor().isTraitor()) {
        ar.reject();
      } else {
        ar.accept();
      }
    });

    const traitors = this.bot
      .neighbors()
      .filter((n) => n.isPlayer() && n.isTraitor()) as Player[];
    if (traitors.length > 0) {
      const toAttack = this.random.randElement(traitors);
      const odds = this.bot.isAlliedWith(toAttack) ? 6 : 3;
      if (this.random.chance(odds)) {
        this.sendAttack(toAttack);
        return;
      }
    }

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

    const border = Array.from(this.bot.borderTiles())
      .flatMap((t) => this.mg.neighbors(t))
      .filter((t) => this.mg.hasOwner(t) && this.mg.owner(t) != this.bot);

    if (border.length == 0) {
      return;
    }

    const toAttack = border[this.random.nextInt(0, border.length)];
    const owner = this.mg.owner(toAttack);

    if (owner.isPlayer()) {
      if (this.bot.isAlliedWith(owner)) {
        return;
      }
      if (owner.type() == PlayerType.FakeHuman) {
        if (!this.random.chance(2)) {
          return;
        }
      }
    }
    this.sendAttack(owner);
  }

  sendAttack(toAttack: Player | TerraNullius) {
    this.mg.addExecution(
      new AttackExecution(
        this.bot.troops() / 20,
        this.bot.id(),
        toAttack.isPlayer() ? toAttack.id() : null,
      ),
    );
  }

  owner(): Player {
    return this.bot;
  }

  isActive(): boolean {
    return this.active;
  }
}
