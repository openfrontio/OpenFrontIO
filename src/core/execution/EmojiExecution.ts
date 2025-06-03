import { consolex } from "../Consolex";
import { AllPlayers, Execution, Game, Player, PlayerType } from "../game/Game";
import { flattenedEmojiTable } from "../Util";

export class EmojiExecution implements Execution {
  private active = true;

  constructor(
    private _owner: Player,
    private _target: Player | typeof AllPlayers,
    private emoji: number,
  ) {}

  init(mg: Game, ticks: number): void {}

  tick(ticks: number): void {
    const emojiString = flattenedEmojiTable[this.emoji];
    if (emojiString === undefined) {
      consolex.warn(
        `cannot send emoji ${this.emoji} from ${this._owner} to ${this._target}`,
      );
    } else if (this._owner.canSendEmoji(this._target)) {
      this._owner.sendEmoji(this._target, emojiString);
      if (
        emojiString === "🖕" &&
        this._target !== AllPlayers &&
        this._target.type() === PlayerType.FakeHuman
      ) {
        this._target.updateRelation(this._owner, -100);
      }
    } else {
      consolex.warn(`cannot send emoji from ${this._owner} to ${this._target}`);
    }
    this.active = false;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
