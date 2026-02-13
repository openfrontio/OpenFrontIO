import { LitElement, html } from "lit";
import { customElement, query } from "lit/decorators.js";

import { PlayerType } from "../../../core/game/Game";
import { GameView, PlayerView } from "../../../core/game/GameView";

import quickChatData from "resources/QuickChat.json" with { type: "json" };
import { EventBus } from "../../../core/EventBus";
import { CloseViewEvent } from "../../InputHandler";
import { SendQuickChatEvent } from "../../Transport";
import { translateText } from "../../Utils";

export type QuickChatPhrase = {
  key: string;
  requiresPlayer: boolean;
  requiresPlayer2?: boolean;
};

export type QuickChatPhrases = Record<string, QuickChatPhrase[]>;

export const quickChatPhrases: QuickChatPhrases = quickChatData;

@customElement("chat-modal")
export class ChatModal extends LitElement {
  @query("o-modal") private modalEl!: HTMLElement & {
    open: () => void;
    close: () => void;
  };

  createRenderRoot() {
    return this;
  }

  private players: PlayerView[] = [];

  private playerSearchQuery: string = "";
  private previewText: string | null = null;
  private requiresPlayerSelection: boolean = false;
  private requiresPlayer2Selection: boolean = false;
  private selectedCategory: string | null = null;
  private selectedPhraseText: string | null = null;
  private selectedPhraseTemplate: string | null = null;
  private selectedQuickChatKey: string | null = null;
  private selectedPlayer: PlayerView | null = null;
  private selectedPlayer2: PlayerView | null = null;
  private selectingPlayer2: boolean = false;

  private recipient: PlayerView;
  private sender: PlayerView;
  public eventBus: EventBus;

  public g: GameView;

  quickChatPhrases: Record<
    string,
    Array<{ text: string; requiresPlayer: boolean }>
  > = {
    help: [{ text: "Please give me troops!", requiresPlayer: false }],
    attack: [{ text: "Attack [P1]!", requiresPlayer: true }],
    defend: [{ text: "Defend [P1]!", requiresPlayer: true }],
    greet: [{ text: "Hello!", requiresPlayer: false }],
    misc: [{ text: "Let's go!", requiresPlayer: false }],
  };

  public categories = [
    { id: "help" },
    { id: "attack" },
    { id: "defend" },
    { id: "greet" },
    { id: "misc" },
    { id: "warnings" },
  ];

  private getPhrasesForCategory(categoryId: string) {
    return quickChatPhrases[categoryId] ?? [];
  }

  render() {
    return html`
      <o-modal title="${translateText("chat.title")}">
        <div class="chat-columns">
          <div class="chat-column">
            <div class="column-title">${translateText("chat.category")}</div>
            ${this.categories.map(
              (category) => html`
                <button
                  class="chat-option-button ${this.selectedCategory ===
                  category.id
                    ? "selected"
                    : ""}"
                  @click=${() => this.selectCategory(category.id)}
                >
                  ${translateText(`chat.cat.${category.id}`)}
                </button>
              `,
            )}
          </div>

          ${this.selectedCategory
            ? html`
                <div class="chat-column">
                  <div class="column-title">
                    ${translateText("chat.phrase")}
                  </div>
                  <div class="phrase-scroll-area">
                    ${this.getPhrasesForCategory(this.selectedCategory).map(
                      (phrase) => html`
                        <button
                          class="chat-option-button ${this
                            .selectedPhraseText ===
                          translateText(
                            `chat.${this.selectedCategory}.${phrase.key}`,
                          )
                            ? "selected"
                            : ""}"
                          @click=${() => this.selectPhrase(phrase)}
                        >
                          ${this.renderPhrasePreview(phrase)}
                        </button>
                      `,
                    )}
                  </div>
                </div>
              `
            : null}
          ${this.requiresPlayerSelection || this.selectedPlayer
            ? html`
                <div class="chat-column">
                  <div class="column-title">
                    ${translateText("chat.player")}${this.selectingPlayer2
                      ? " [P2]"
                      : this.requiresPlayer2Selection
                        ? " [P1]"
                        : ""}
                  </div>

                  <input
                    class="player-search-input"
                    type="text"
                    placeholder="${translateText("chat.search")}"
                    .value=${this.playerSearchQuery}
                    @input=${this.onPlayerSearchInput}
                  />

                  <div class="player-scroll-area">
                    ${this.getSortedFilteredPlayers().map(
                      (player) => html`
                        <button
                          class="chat-option-button ${(this.selectingPlayer2
                            ? this.selectedPlayer2
                            : this.selectedPlayer) === player
                            ? "selected"
                            : ""}"
                          style="border: 2px solid ${player
                            .territoryColor()
                            .toHex()};"
                          ?disabled=${this.selectingPlayer2 && this.selectedPlayer === player}
                          @click=${() => this.selectPlayer(player)}
                        >
                          ${player.name()}
                        </button>
                      `,
                    )}
                  </div>
                </div>
              `
            : null}
        </div>

        <div class="chat-preview">
          ${this.previewText
            ? translateText(this.previewText)
            : translateText("chat.build")}
        </div>
        <div class="chat-send">
          <button
            class="chat-send-button"
            @click=${this.sendChatMessage}
            ?disabled=${!this.previewText ||
            (this.requiresPlayerSelection && !this.selectedPlayer) ||
            (this.selectingPlayer2 && !this.selectedPlayer2)}
          >
            ${translateText("chat.send")}
          </button>
        </div>
      </o-modal>
    `;
  }

  initEventBus(eventBus: EventBus) {
    this.eventBus = eventBus;
    eventBus.on(CloseViewEvent, (e) => {
      if (!this.hidden) {
        this.close();
      }
    });
  }

  private selectCategory(categoryId: string) {
    this.selectedCategory = categoryId;
    this.selectedPhraseText = null;
    this.previewText = null;
    this.requiresPlayerSelection = false;
    this.requiresPlayer2Selection = false;
    this.selectedPlayer2 = null;
    this.selectingPlayer2 = false;
    this.requestUpdate();
  }

  private selectPhrase(phrase: QuickChatPhrase) {
    this.selectedQuickChatKey = this.getFullQuickChatKey(
      this.selectedCategory!,
      phrase.key,
    );
    this.selectedPhraseTemplate = translateText(
      `chat.${this.selectedCategory}.${phrase.key}`,
    );
    this.selectedPhraseText = translateText(
      `chat.${this.selectedCategory}.${phrase.key}`,
    );
    this.previewText = `chat.${this.selectedCategory}.${phrase.key}`;
    this.requiresPlayerSelection = phrase.requiresPlayer;
    this.requiresPlayer2Selection = phrase.requiresPlayer2 ?? false;
    this.requestUpdate();
  }

  private renderPhrasePreview(phrase: { key: string }) {
    return translateText(`chat.${this.selectedCategory}.${phrase.key}`);
  }

  private selectPlayer(player: PlayerView) {
    if (!this.previewText) return;

    if (this.selectingPlayer2) {
      this.previewText =
        this.previewText.replace("[P2]", player.name()) ?? null;
      this.selectedPlayer2 = player;
      this.selectingPlayer2 = false;
      this.requiresPlayerSelection = false;
      this.requestUpdate();
      return;
    }

    this.previewText =
      this.selectedPhraseTemplate?.replace("[P1]", player.name()) ?? null;
    this.selectedPlayer = player;
    this.selectingPlayer2 = this.requiresPlayer2Selection;
    this.requiresPlayerSelection = this.requiresPlayer2Selection;
    this.requestUpdate();
  }

  private sendChatMessage() {
    console.log("Sent message:", this.previewText);
    console.log("Sender:", this.sender);
    console.log("Recipient:", this.recipient);
    console.log("Key:", this.selectedQuickChatKey);

    if (this.sender && this.recipient && this.selectedQuickChatKey) {
      this.eventBus.emit(
        new SendQuickChatEvent(
          this.recipient,
          this.selectedQuickChatKey,
          this.selectedPlayer?.id(),
          this.selectedPlayer2?.id(),
        ),
      );
    }

    this.previewText = null;
    this.selectedCategory = null;
    this.requiresPlayerSelection = false;
    this.requiresPlayer2Selection = false;
    this.selectedPlayer2 = null;
    this.selectingPlayer2 = false;
    this.close();

    this.requestUpdate();
  }

  private onPlayerSearchInput(e: Event) {
    const target = e.target as HTMLInputElement;
    this.playerSearchQuery = target.value.toLowerCase();
    this.requestUpdate();
  }

  private getSortedFilteredPlayers(): PlayerView[] {
    const sorted = [...this.players].sort((a, b) =>
      a.name().localeCompare(b.name()),
    );
    const filtered = sorted.filter((p) =>
      p.name().toLowerCase().includes(this.playerSearchQuery),
    );
    const others = sorted.filter(
      (p) => !p.name().toLowerCase().includes(this.playerSearchQuery),
    );
    return [...filtered, ...others];
  }

  private getFullQuickChatKey(category: string, phraseKey: string): string {
    return `${category}.${phraseKey}`;
  }

  public open(sender?: PlayerView, recipient?: PlayerView) {
    if (sender && recipient) {
      console.log("Sent message:", recipient);
      console.log("Sent message:", sender);
      this.players = this.g
        .players()
        .filter((p) => p.isAlive() && p.data.playerType !== PlayerType.Bot);

      this.recipient = recipient;
      this.sender = sender;
    }
    this.requestUpdate();
    this.modalEl?.open();
  }

  public close() {
    this.selectedCategory = null;
    this.selectedPhraseText = null;
    this.previewText = null;
    this.requiresPlayerSelection = false;
    this.requiresPlayer2Selection = false;
    this.selectedPlayer2 = null;
    this.selectingPlayer2 = false;
    this.modalEl?.close();
  }

  public setRecipient(value: PlayerView) {
    this.recipient = value;
  }

  public setSender(value: PlayerView) {
    this.sender = value;
  }

  public openWithSelection(
    categoryId: string,
    phraseKey: string,
    sender?: PlayerView,
    recipient?: PlayerView,
  ) {
    if (sender && recipient) {
      this.players = this.g
        .players()
        .filter((p) => p.isAlive() && p.data.playerType !== PlayerType.Bot);

      this.recipient = recipient;
      this.sender = sender;
    }

    this.selectCategory(categoryId);

    const phrase = this.getPhrasesForCategory(categoryId).find(
      (p) => p.key === phraseKey,
    );

    if (phrase) {
      this.selectPhrase(phrase);
    }

    this.requestUpdate();
    this.modalEl?.open();
  }
}
