import quickChatData from "resources/QuickChat.json" with { type: "json" };
import { EventBus } from "../../../core/EventBus";
import { GameView, PlayerView } from "../../../core/game/GameView";
import { ShowChatModalEvent } from "../../InGameModalBridges";
import { SendQuickChatEvent } from "../../Transport";
import { translateText } from "../../Utils";
import { COLORS, MenuElement, MenuElementParams } from "./RadialMenuElements";

export type QuickChatPhrase = {
  key: string;
  requiresPlayer: boolean;
};

export type QuickChatPhrases = Record<string, QuickChatPhrase[]>;

export const quickChatPhrases: QuickChatPhrases = quickChatData;

const CHAT_CATEGORIES = [
  { id: "help" },
  { id: "attack" },
  { id: "defend" },
  { id: "greet" },
  { id: "misc" },
  { id: "warnings" },
];

export class ChatIntegration {
  constructor(
    private game: GameView,
    private eventBus: EventBus,
  ) {}

  createQuickChatMenu(recipient: PlayerView): MenuElement[] {
    const myPlayer = this.game.myPlayer();
    if (!myPlayer) {
      throw new Error("Current player not found");
    }

    return CHAT_CATEGORIES.map((category) => {
      const categoryTranslation = translateText(`chat.cat.${category.id}`);

      const categoryColor =
        COLORS.chat[category.id as keyof typeof COLORS.chat] ||
        COLORS.chat.default;
      const phrases = quickChatPhrases[category.id] || [];

      const phraseItems: MenuElement[] = phrases.map(
        (phrase: QuickChatPhrase) => {
          const phraseText = translateText(`chat.${category.id}.${phrase.key}`);

          return {
            id: `phrase-${category.id}-${phrase.key}`,
            name: phraseText,
            disabled: () => false,
            text: this.shortenText(phraseText),
            fontSize: "10px",
            color: categoryColor,
            tooltipItems: [
              {
                text: phraseText,
                className: "description",
              },
            ],
            action: (params: MenuElementParams) => {
              if (phrase.requiresPlayer) {
                this.eventBus.emit(
                  new ShowChatModalEvent(
                    true,
                    myPlayer,
                    recipient,
                    category.id,
                    phrase.key,
                  ),
                );
              } else {
                this.eventBus.emit(
                  new SendQuickChatEvent(
                    recipient,
                    `${category.id}.${phrase.key}`,
                    undefined,
                  ),
                );
              }
            },
          };
        },
      );

      return {
        id: `chat-category-${category.id}`,
        name: categoryTranslation,
        disabled: () => false,
        text: categoryTranslation,
        color: categoryColor,
        _action: () => {}, // Empty action placeholder for RadialMenu
        subMenu: () => phraseItems,
      };
    });
  }

  shortenText(text: string, maxLength = 15): string {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength - 3) + "...";
  }
}
