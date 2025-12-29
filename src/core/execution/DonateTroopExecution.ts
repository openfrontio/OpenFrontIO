import { Difficulty, Execution, Game, Player, PlayerID } from "../game/Game";
import { PseudoRandom } from "../PseudoRandom";
import { assertNever } from "../Util";
import { EmojiExecution } from "./EmojiExecution";
import {
  EMOJI_DONATION_TOO_SMALL,
  EMOJI_LOVE,
} from "./nation/NationEmojiBehavior";

export class DonateTroopsExecution implements Execution {
  private recipient: Player;

  private random: PseudoRandom;
  private mg: Game;

  private active = true;

  constructor(
    private sender: Player,
    private recipientID: PlayerID,
    private troops: number | null,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    this.random = new PseudoRandom(mg.ticks());

    if (!mg.hasPlayer(this.recipientID)) {
      console.warn(
        `DonateTroopExecution recipient ${this.recipientID} not found`,
      );
      this.active = false;
      return;
    }

    this.recipient = mg.player(this.recipientID);
    this.troops ??= mg.config().defaultDonationAmount(this.sender);
    const maxDonation =
      mg.config().maxTroops(this.recipient) - this.recipient.troops();
    this.troops = Math.min(this.troops, maxDonation);
  }

  tick(ticks: number): void {
    if (this.troops === null) throw new Error("not initialized");

    const minTroops = this.getMinTroopsForRelationUpdate();

    if (
      this.sender.canDonateTroops(this.recipient) &&
      this.sender.donateTroops(this.recipient, this.troops)
    ) {
      // Prevent players from just buying a good relation by sending 1% troops. Instead, a minimum is needed, and it's random.
      if (this.troops >= minTroops) {
        this.recipient.updateRelation(this.sender, 50);
      }

      this.mg.addExecution(
        new EmojiExecution(
          this.recipient,
          this.sender.id(),
          this.random.randElement(
            this.troops >= minTroops ? EMOJI_LOVE : EMOJI_DONATION_TOO_SMALL,
          ),
        ),
      );
    } else {
      console.warn(
        `cannot send troops from ${this.sender} to ${this.recipient}`,
      );
    }
    this.active = false;
  }

  private getMinTroopsForRelationUpdate(): number {
    const { difficulty } = this.mg.config().gameConfig();
    const recipientMaxTroops = this.mg.config().maxTroops(this.recipient);

    switch (difficulty) {
      // ~7.7k - ~9.1k troops (for 100k troops)
      case Difficulty.Easy:
        return this.random.nextInt(
          recipientMaxTroops / 13,
          recipientMaxTroops / 11,
        );
      // ~9.1k - ~11.1k troops (for 100k troops)
      case Difficulty.Medium:
        return this.random.nextInt(
          recipientMaxTroops / 11,
          recipientMaxTroops / 9,
        );
      // ~11.1k - ~14.3k troops (for 100k troops)
      case Difficulty.Hard:
        return this.random.nextInt(
          recipientMaxTroops / 9,
          recipientMaxTroops / 7,
        );
      // ~14.3k - ~20k troops (for 100k troops)
      case Difficulty.Impossible:
        return this.random.nextInt(
          recipientMaxTroops / 7,
          recipientMaxTroops / 5,
        );
      default:
        assertNever(difficulty);
    }
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
