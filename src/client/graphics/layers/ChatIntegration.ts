import { EventBus } from "../../../core/EventBus";
import { GameView, PlayerView } from "../../../core/game/GameView";
import { SendQuickChatEvent } from "../../Transport";
import { translateText } from "../../Utils";
import { ChatModal, QuickChatPhrase, quickChatPhrases } from "./ChatModal";
import { COLORS, MenuElement } from "./RadialMenuElements";

export class ChatIntegration {
  private ctModal: ChatModal;

  constructor(
    private game: GameView,
    private eventBus: EventBus,
  ) {
    this.ctModal = document.querySelector("chat-modal") as ChatModal;

    if (!this.ctModal) {
      throw new Error(
        "Chat modal element not found. Ensure chat-modal element exists in DOM before initializing ChatIntegration",
      );
    }
  }

  setupChatModal(sender: PlayerView, recipient: PlayerView) {
    this.ctModal.setSender(sender);
    this.ctModal.setRecipient(recipient);
  }

  createQuickChatMenu(recipient: PlayerView): MenuElement[] {
    if (!this.ctModal) {
      throw new Error("Chat modal not set");
    }

    const myPlayer = this.game.myPlayer();
    if (!myPlayer) {
      throw new Error("Current player not found");
    }

    return this.ctModal.categories.map((category) => {
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
            disabled: false,
            text: this.shortenText(phraseText),
            fontSize: "10px",
            color: categoryColor,
            tooltipItems: [
              {
                text: phraseText,
                className: "description",
              },
            ],
            action: () => {
              if (phrase.requiresPlayer) {
                this.ctModal.openWithSelection(
                  category.id,
                  phrase.key,
                  myPlayer,
                  recipient,
                );
              } else {
                this.eventBus.emit(
                  new SendQuickChatEvent(
                    recipient,
                    `${category.id}.${phrase.key}`,
                    {},
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
        disabled: false,
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
