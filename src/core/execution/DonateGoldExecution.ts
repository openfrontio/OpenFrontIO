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
      // Give relation points based on how much gold was donated
      const relationUpdate = this.calculateRelationUpdate(Number(this.gold));
      this.recipient.updateRelation(this.sender, relationUpdate);
    } else {
      console.warn(
        `cannot send gold from ${this.sender.name()} to ${this.recipient.name()}`,
      );
    }
    this.active = false;
  }

  getGoldChunkSize(): number {
    const { difficulty } = this.mg.config().gameConfig();
    switch (difficulty) {
      case Difficulty.Easy:
        return this.random.nextInt(1, 2_500);
      case Difficulty.Medium:
        return this.random.nextInt(2_500, 5_000);
      case Difficulty.Hard:
        return this.random.nextInt(5_000, 12_500);
      case Difficulty.Impossible:
        return this.random.nextInt(12_500, 25_000);
      default:
        return 2_500;
    }
  }

  calculateRelationUpdate(goldSent: number): number {
    const chunkSize = this.getGoldChunkSize();
    // Calculate how many complete chunks were donated
    const chunks = Math.floor(goldSent / chunkSize);
    // Each chunk gives 5 relation points
    const relationUpdate = chunks * 5;
    // Cap at 100 relation points
    if (relationUpdate > 100) return 100;
    return relationUpdate;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
