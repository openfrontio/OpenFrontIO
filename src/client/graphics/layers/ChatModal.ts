import { LitElement, css, html } from "lit";
import { customElement, query } from "lit/decorators.js";

import { PlayerType } from "../../../core/game/Game";
import { GameView, PlayerView } from "../../../core/game/GameView";

import quickChatData from "../../../../resources/QuickChat.json";
import { EventBus } from "../../../core/EventBus";
import { SendQuickChatEvent } from "../../Transport";
import { translateText } from "../../Utils";

type QuickChatPhrase = {
  key: string;
  requiresPlayer: boolean;
};

type QuickChatPhrases = Record<string, QuickChatPhrase[]>;

const quickChatPhrases: QuickChatPhrases = quickChatData;

@customElement("chat-modal")
export class ChatModal extends LitElement {
  @query("o-modal") private modalEl!: HTMLElement & {
    open: () => void;
    close: () => void;
  };

  static styles = css`
    /* .w. */

    .chat-columns {
      display: flex;
      gap: 16px;
      padding: 12px;
      overflow-x: auto;
    }

    .chat-column {
      display: flex;
      flex-direction: column;
      gap: 8px;
      min-width: 120px;
    }

    .column-title {
      font-weight: bold;
      margin-bottom: 4px;
    }

    .chat-option-button {
      background: #333;
      color: white;
      border: none;
      padding: 8px 12px;
      border-radius: 4px;
      text-align: left;
      cursor: pointer;
    }

    .chat-option-button.selected {
      background-color: #66c;
    }

    .chat-preview {
      margin: 10px 12px;
      padding: 10px;
      background: #222;
      color: white;
      border-radius: 6px;
      text-align: center;
    }

    .chat-send {
      display: flex;
      justify-content: flex-end;
      padding: 0 12px 12px;
    }

    .chat-send-button {
      background: #4caf50;
      color: white;
      padding: 8px 16px;
      border: none;
      border-radius: 4px;
      cursor: pointer;
    }

    .chat-send-button:disabled {
      background: #666;
      cursor: not-allowed;
    }

    .chat-column {
      display: flex;
      flex-direction: column;
      gap: 8px;
      min-width: 140px;
    }

    .player-search-input {
      padding: 6px 8px;
      border-radius: 4px;
      border: 1px solid #666;
      font-size: 14px;
      outline: none;

      background-color: #fff;
      color: #000;
    }

    .player-scroll-area {
      max-height: 240px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding-right: 4px;
    }

    .phrase-scroll-area {
      max-height: 280px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding-right: 4px;
    }
  `;

  private players: string[] = [];

  private playerSearchQuery: string = "";
  private previewText: string | null = null;
  private requiresPlayerSelection: boolean = false;
  private selectedCategory: string | null = null;
  private selectedPhraseText: string | null = null;
  private selectedPlayer: string | null = null;
  private selectedPhraseTemplate: string | null = null;
  private selectedQuickChatKey: string | null = null;

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

  private categories = [
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
    const sortedPlayers = [...this.players].sort((a, b) => a.localeCompare(b));

    const filteredPlayers = sortedPlayers.filter((player) =>
      player.toLowerCase().includes(this.playerSearchQuery),
    );

    const otherPlayers = sortedPlayers.filter(
      (player) => !player.toLowerCase().includes(this.playerSearchQuery),
    );

    const displayPlayers = [...filteredPlayers, ...otherPlayers];
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
                          class="chat-option-button ${this.selectedPlayer ===
                          player
                            ? "selected"
                            : ""}"
                          @click=${() => this.selectPlayer(player)}
                        >
                          ${player}
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
            (this.requiresPlayerSelection && !this.selectedPlayer)}
          >
            ${translateText("chat.send")}
          </button>
        </div>
      </o-modal>
    `;
  }

  private selectCategory(categoryId: string) {
    this.selectedCategory = categoryId;
    this.selectedPhraseText = null;
    this.previewText = null;
    this.requiresPlayerSelection = false;
    this.selectedPlayer = null;
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
    this.selectedPlayer = null;
    this.requestUpdate();
  }

  private renderPhrasePreview(phrase: { key: string }) {
    return translateText(`chat.${this.selectedCategory}.${phrase.key}`);
  }

  private selectPlayer(player: string) {
    if (this.previewText) {
      this.previewText =
        this.selectedPhraseTemplate?.replace("[P1]", player) ?? null;
      this.selectedPlayer = player;
      this.requiresPlayerSelection = false;
      this.requestUpdate();
    }
  }

  private sendChatMessage() {
    console.log("Sent message:", this.previewText);
    console.log("Sender:", this.sender);
    console.log("Recipient:", this.recipient);
    console.log("Key:", this.selectedQuickChatKey);

    if (this.sender && this.recipient && this.selectedQuickChatKey) {
      const variables: Record<string, string> = this.selectedPlayer
        ? { P1: this.selectedPlayer }
        : {};

      this.eventBus.emit(
        new SendQuickChatEvent(
          this.sender,
          this.recipient,
          this.selectedQuickChatKey,
          variables,
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

  private getSortedFilteredPlayers(): string[] {
    const sorted = [...this.players].sort((a, b) => a.localeCompare(b));
    const filtered = sorted.filter((p) =>
      p.toLowerCase().includes(this.playerSearchQuery),
    );
    const others = sorted.filter(
      (p) => !p.toLowerCase().includes(this.playerSearchQuery),
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
      const alivePlayerNames = this.g
        .players()
        .filter((p) => p.isAlive() && !(p.data.playerType === PlayerType.Bot))
        .map((p) => p.data.name);

      console.log("Alive player names:", alivePlayerNames);
      this.players = alivePlayerNames;
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
    this.selectedPlayer = null;
    this.modalEl?.close();
  }

  public setRecipient(value: PlayerView) {
    this.recipient = value;
  }

  public setSender(value: PlayerView) {
    this.sender = value;
  }
}
