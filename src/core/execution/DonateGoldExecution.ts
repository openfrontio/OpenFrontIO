import {
  Difficulty,
  Execution,
  Game,
  Gold,
  Player,
  PlayerID,
} from "../game/Game";
import { PseudoRandom } from "../PseudoRandom";
import { toInt } from "../Util";

export class DonateGoldExecution implements Execution {
  private recipient: Player;
  private random: PseudoRandom;
  private mg: Game;

  private active = true;
  private gold: Gold;

  constructor(
    private sender: Player,
    private recipientID: PlayerID,
    goldNum: number | null,
  ) {
    this.gold = toInt(goldNum ?? 0);
  }

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    this.random = new PseudoRandom(mg.ticks());

    if (!mg.hasPlayer(this.recipientID)) {
      console.warn(
        `DonateGoldExecution recipient ${this.recipientID} not found`,
      );
      this.active = false;
      return;
    }

    this.recipient = mg.player(this.recipientID);
    this.gold ??= this.sender.gold() / 3n;
  }

  tick(ticks: number): void {
    if (this.gold === null) throw new Error("not initialized");
    if (
      this.sender.canDonateGold(this.recipient) &&
      this.sender.donateGold(this.recipient, this.gold)
    ) {
      // Prevent players from just buying a good relation by sending 1% gold. Instead, a minimum is needed, and it's random.
      if (this.gold >= BigInt(this.getMinGoldForRelationUpdate())) {
        this.recipient.updateRelation(this.sender, 50);
      }
    } else {
      console.warn(
        `cannot send gold from ${this.sender.name()} to ${this.recipient.name()}`,
      );
    }
    this.active = false;
  }

  getMinGoldForRelationUpdate(): number {
    const { difficulty } = this.mg.config().gameConfig();
    if (difficulty === Difficulty.Easy) return this.random.nextInt(0, 25_000);
    if (difficulty === Difficulty.Medium)
      return this.random.nextInt(25_000, 50_000);
    if (difficulty === Difficulty.Hard)
      return this.random.nextInt(50_000, 125_000);
    if (difficulty === Difficulty.Impossible)
      return this.random.nextInt(125_000, 250_000);
    return 0;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
