import { Game, Player, PlayerType, Tick } from "../../game/Game";
import { PseudoRandom } from "../../PseudoRandom";
import { flattenedEmojiTable } from "../../Util";
import { EmojiExecution } from "../EmojiExecution";

const emojiId = (e: (typeof flattenedEmojiTable)[number]) =>
  flattenedEmojiTable.indexOf(e);
export const EMOJI_ASSIST_ACCEPT = (["👍", "⛵", "🤝", "🎯"] as const).map(
  emojiId,
);
export const EMOJI_ASSIST_RELATION_TOO_LOW = (["🥱", "🤦‍♂️"] as const).map(
  emojiId,
);
export const EMOJI_ASSIST_TARGET_ME = (["🥺", "💀"] as const).map(emojiId);
export const EMOJI_ASSIST_TARGET_ALLY = (["🕊️", "👎"] as const).map(emojiId);
export const EMOJI_HECKLE = (["🤡", "😡"] as const).map(emojiId);

export class NationEmojiBehavior {
  private readonly lastEmojiSent = new Map<Player, Tick>();

  constructor(
    private random: PseudoRandom,
    private game: Game,
    private player: Player,
  ) {}

  sendEmoji(player: Player, emojisList: number[]) {
    if (player.type() !== PlayerType.Human) return;
    this.game.addExecution(
      new EmojiExecution(
        this.player,
        player.id(),
        this.random.randElement(emojisList),
      ),
    );
  }

  maybeSendHeckleEmoji(enemy: Player) {
    if (this.player.type() === PlayerType.Bot) return;
    if (enemy.type() !== PlayerType.Human) return;
    const lastSent = this.lastEmojiSent.get(enemy) ?? -300;
    if (this.game.ticks() - lastSent <= 300) return;
    this.lastEmojiSent.set(enemy, this.game.ticks());
    this.game.addExecution(
      new EmojiExecution(
        this.player,
        enemy.id(),
        this.random.randElement(EMOJI_HECKLE),
      ),
    );
  }
}
