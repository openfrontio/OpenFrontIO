import { EventBus } from "../../../core/EventBus";
import { GameView, PlayerView } from "../../../core/game/GameView";
import { SendQuickChatEvent } from "../../Transport";
import { translateText } from "../../Utils";
import { ChatModal, QuickChatPhrase, quickChatPhrases } from "./ChatModal";
import { COLORS, MenuElement, MenuElementParams } from "./RadialMenuElements";

export class ChatIntegration {
  private readonly ctModal: ChatModal;

  constructor(
    private readonly game: GameView,
    private readonly eventBus: EventBus,
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
            action: (params: MenuElementParams) => {
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
                    undefined,
                  ),
                );
              }
            },
            color: categoryColor,
            disabled: () => false,
            fontSize: "10px",
            id: `phrase-${category.id}-${phrase.key}`,
            name: phraseText,
            text: this.shortenText(phraseText),
            tooltipItems: [
              {
                className: "description",
                text: phraseText,
              },
            ],
          };
        },
      );

      return {
        _action: () => {}, // Empty action placeholder for RadialMenu
        color: categoryColor,
        disabled: () => false,
        id: `chat-category-${category.id}`,
        name: categoryTranslation,
        subMenu: () => phraseItems,
        text: categoryTranslation,
      };
    });
  }

  shortenText(text: string, maxLength = 15): string {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength - 3) + "...";
  }
}
