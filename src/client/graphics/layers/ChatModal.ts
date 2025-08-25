import { html, LitElement } from "lit";
import { customElement, query } from "lit/decorators.js";
import quickChatData from "../../../../resources/QuickChat.json";
import { EventBus } from "../../../core/EventBus";
import { PlayerType } from "../../../core/game/Game";
import { GameView, PlayerView } from "../../../core/game/GameView";
import { CloseViewEvent } from "../../InputHandler";
import { SendQuickChatEvent } from "../../Transport";
import { translateText } from "../../Utils";

export type QuickChatPhrase = {
  key: string;
  requiresPlayer: boolean;
};

export type QuickChatPhrases = Record<string, QuickChatPhrase[]>;

export const quickChatPhrases: QuickChatPhrases = quickChatData;

@customElement("chat-modal")
export class ChatModal extends LitElement {
  @query("o-modal") private readonly modalEl!: HTMLElement & {
    open: () => void;
    close: () => void;
  };

  createRenderRoot() {
    return this;
  }

  private players: PlayerView[] = [];

  private playerSearchQuery = "";
  private previewText: string | null = null;
  private requiresPlayerSelection = false;
  private selectedCategory: string | null = null;
  private selectedPhraseText: string | null = null;
  private selectedPhraseTemplate: string | null = null;
  private selectedQuickChatKey: string | null = null;
  private selectedPlayer: PlayerView | null = null;

  private recipient: PlayerView | undefined;
  private sender: PlayerView | undefined;
  public eventBus: EventBus | undefined;

  public g: GameView | undefined;

  quickChatPhrases: Record<
    string,
    Array<{ text: string; requiresPlayer: boolean }>
  > = {
    attack: [{ requiresPlayer: true, text: "Attack [P1]!" }],
    defend: [{ requiresPlayer: true, text: "Defend [P1]!" }],
    greet: [{ requiresPlayer: false, text: "Hello!" }],
    help: [{ requiresPlayer: false, text: "Please give me troops!" }],
    misc: [{ requiresPlayer: false, text: "Let's go!" }],
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
                  class="chat-option-button ${
                    this.selectedCategory === category.id ? "selected" : ""
                  }"
                  @click=${() => this.selectCategory(category.id)}
                >
                  ${translateText(`chat.cat.${category.id}`)}
                </button>
              `,
            )}
          </div>

          ${
            this.selectedCategory
              ? html`
                <div class="chat-column">
                  <div class="column-title">
                    ${translateText("chat.phrase")}
                  </div>
                  <div class="phrase-scroll-area">
                    ${this.getPhrasesForCategory(this.selectedCategory).map(
                      (phrase) => html`
                        <button
                          class="chat-option-button ${
                            this.selectedPhraseText ===
                            translateText(
                              `chat.${this.selectedCategory}.${phrase.key}`,
                            )
                              ? "selected"
                              : ""
                          }"
                          @click=${() => this.selectPhrase(phrase)}
                        >
                          ${this.renderPhrasePreview(phrase)}
                        </button>
                      `,
                    )}
                  </div>
                </div>
              `
              : null
          }
          ${
            this.requiresPlayerSelection || this.selectedPlayer
              ? html`
                <div class="chat-column">
                  <div class="column-title">
                    ${translateText("chat.player")}
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
                          class="chat-option-button ${
                            this.selectedPlayer === player ? "selected" : ""
                          }"
                          @click=${() => this.selectPlayer(player)}
                        >
                          ${player.name()}
                        </button>
                      `,
                    )}
                  </div>
                </div>
              `
              : null
          }
        </div>

        <div class="chat-preview">
          ${
            this.previewText
              ? translateText(this.previewText)
              : translateText("chat.build")
          }
        </div>
        <div class="chat-send">
          <button
            class="chat-send-button"
            @click=${this.sendChatMessage}
            ?disabled=${
              !this.previewText ||
              (this.requiresPlayerSelection && !this.selectedPlayer)
            }
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
    this.requestUpdate();
  }

  private selectPhrase(phrase: QuickChatPhrase) {
    if (this.selectedCategory === null) return;
    this.selectedQuickChatKey = this.getFullQuickChatKey(
      this.selectedCategory,
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
    this.requestUpdate();
  }

  private renderPhrasePreview(phrase: { key: string }) {
    return translateText(`chat.${this.selectedCategory}.${phrase.key}`);
  }

  private selectPlayer(player: PlayerView) {
    if (this.previewText) {
      this.previewText =
        this.selectedPhraseTemplate?.replace("[P1]", player.name()) ?? null;
      this.selectedPlayer = player;
      this.requiresPlayerSelection = false;
      this.requestUpdate();
    }
  }

  private sendChatMessage() {
    if (!this.eventBus) return;
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
        ),
      );
    }

    this.previewText = null;
    this.selectedCategory = null;
    this.requiresPlayerSelection = false;
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
      if (!this.g) throw new Error("Not initialized");
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
      if (!this.g) throw new Error("Not initialized");
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
