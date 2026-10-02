import { LitElement, html } from "lit";
import { customElement, query, state } from "lit/decorators.js";

import { PlayerID, PlayerType } from "../../../core/game/Game";
import { GameView, PlayerView } from "../../view";

import quickChatData from "resources/QuickChat.json";
import { EventBus } from "../../../core/EventBus";
import { UserSettings } from "../../../core/game/UserSettings";
import { CloseViewEvent } from "../../InputHandler";
import { SendQuickChatEvent } from "../../Transport";
import { textDirection, translateText } from "../../Utils";

export type QuickChatPhrase = {
  key: string;
  requiresPlayer: boolean;
};

export type QuickChatPhrases = Record<string, QuickChatPhrase[]>;

export const quickChatPhrases: QuickChatPhrases = quickChatData;

@customElement("chat-modal")
export class ChatModal extends LitElement {
  @state() public isModalOpen = false;
  @query(".chat-panel") private panel?: HTMLElement;
  private returnFocus: HTMLElement | null = null;

  createRenderRoot() {
    return this;
  }

  private players: PlayerView[] = [];

  private playerSearchQuery: string = "";
  private sortByTerritory = false;
  private requiresPlayerSelection: boolean = false;
  private selectedCategory: string | null = null;
  private selectedQuickChatKey: string | null = null;
  private selectedPlayer: PlayerView | null = null;

  private userSettings = new UserSettings();
  private lastMessage: { key: string; target?: PlayerID } | null = null;

  private recipient: PlayerView;
  private sender: PlayerView;
  public eventBus: EventBus;

  public g: GameView;

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

  updated(changed: Map<string, unknown>) {
    if (changed.has("isModalOpen") && this.isModalOpen) {
      this.panel?.focus();
    }
  }

  private onPanelKeydown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      this.close();
    }
  };

  render() {
    if (!this.isModalOpen) return html``;
    return html`
      <div class="chat-container">
        <section
          class="chat-panel"
          role="dialog"
          aria-label=${translateText("chat.title")}
          tabindex="-1"
          dir=${textDirection()}
          style="--chat-background-opacity: ${this.userSettings.quickChatOpacity()}"
          @click=${(event: Event) => event.stopPropagation()}
          @wheel=${(event: Event) => event.stopPropagation()}
          @keydown=${this.onPanelKeydown}
        >
          <header class="chat-header">
            <h2>${translateText("chat.title")}</h2>
            <button
              class="chat-close-button"
              type="button"
              aria-label=${translateText("common.close")}
              @click=${() => this.close()}
            >
              ✕
            </button>
          </header>
          <div class="chat-body">
            <div class="chat-recipient">${this.recipient?.displayName()}</div>
            <div
              class="chat-columns ${this.requiresPlayerSelection
                ? "has-player"
                : ""}"
            >
              <div class="chat-column">
                <div class="column-title">
                  ${translateText("chat.category")}
                </div>
                ${this.categories.map(
                  (category) => html`
                    <button
                      class="chat-option-button ${this.selectedCategory ===
                      category.id
                        ? "selected"
                        : ""}"
                      aria-pressed=${this.selectedCategory === category.id}
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
                                .selectedQuickChatKey ===
                              `${this.selectedCategory}.${phrase.key}`
                                ? "selected"
                                : ""}"
                              aria-pressed=${this.selectedQuickChatKey ===
                              `${this.selectedCategory}.${phrase.key}`}
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
              ${this.requiresPlayerSelection
                ? html`
                    <div class="chat-column">
                      <div class="column-title">
                        ${translateText("chat.player")}
                      </div>

                      <label
                        class="flex items-center gap-2 text-sm cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          .checked=${this.sortByTerritory}
                          @change=${this.onPlayerSortChange}
                        />
                        ${translateText("chat.sort_by_territory")}
                      </label>

                      <input
                        class="player-search-input"
                        type="text"
                        aria-label="${translateText("chat.search")}"
                        placeholder="${translateText("chat.search")}"
                        .value=${this.playerSearchQuery}
                        @input=${this.onPlayerSearchInput}
                      />

                      <div class="player-scroll-area">
                        ${this.getSortedFilteredPlayers().map(
                          (player) => html`
                            <button
                              class="chat-option-button ${this
                                .selectedPlayer === player
                                ? "selected"
                                : ""}"
                              style="border: 2px solid ${player
                                .territoryColor()
                                .toHex()};"
                              aria-pressed=${this.selectedPlayer === player}
                              @click=${() => this.selectPlayer(player)}
                            >
                              ${player.displayName()}
                            </button>
                          `,
                        )}
                      </div>
                    </div>
                  `
                : null}
            </div>
          </div>
          <div class="chat-footer">
            <div class="chat-preview">
              ${this.previewText ?? translateText("chat.build")}
            </div>
            <div class="chat-send">
              <button
                class="chat-repeat-button"
                @click=${this.sendLastMessage}
                ?disabled=${!this.canRepeatLastMessage()}
              >
                <span>${translateText("chat.send_last")}</span>
                ${this.lastMessage
                  ? html`<span class="chat-last-preview"
                      >${this.lastMessagePreview()}</span
                    >`
                  : null}
              </button>
              <button
                class="chat-send-button"
                @click=${this.sendChatMessage}
                ?disabled=${!this.previewText ||
                (this.requiresPlayerSelection && !this.selectedPlayer)}
              >
                ${translateText("chat.send")}
              </button>
            </div>
          </div>
        </section>
      </div>
    `;
  }

  initEventBus(eventBus: EventBus) {
    this.eventBus?.off(CloseViewEvent, this.onCloseView);
    this.lastMessage = null;
    this.close();
    this.eventBus = eventBus;
    eventBus.on(CloseViewEvent, this.onCloseView);
  }

  private onCloseView = () => this.close();

  private selectCategory(categoryId: string) {
    this.selectedCategory = categoryId;
    this.selectedQuickChatKey = null;
    this.selectedPlayer = null;
    this.requiresPlayerSelection = false;
    this.requestUpdate();
  }

  private selectPhrase(phrase: QuickChatPhrase) {
    this.selectedPlayer = null;
    this.selectedQuickChatKey = this.getFullQuickChatKey(
      this.selectedCategory!,
      phrase.key,
    );
    this.requiresPlayerSelection = phrase.requiresPlayer;
    this.requestUpdate();
  }

  private renderPhrasePreview(phrase: { key: string }) {
    return translateText(`chat.${this.selectedCategory}.${phrase.key}`);
  }

  private get previewText(): string | null {
    if (!this.selectedQuickChatKey) return null;
    const text = translateText(`chat.${this.selectedQuickChatKey}`);
    return this.requiresPlayerSelection && this.selectedPlayer
      ? text.replace("[P1]", this.selectedPlayer.displayName())
      : text;
  }

  private selectPlayer(player: PlayerView) {
    if (this.selectedQuickChatKey && this.requiresPlayerSelection) {
      this.selectedPlayer = player;
      this.requestUpdate();
    }
  }

  public sendQuickChat(
    sender: PlayerView,
    recipient: PlayerView,
    key: string,
    target?: PlayerID,
  ) {
    if (sender.id() === recipient.id()) return;
    this.eventBus.emit(new SendQuickChatEvent(recipient, key, target));
    this.lastMessage = { key, target };
    this.requestUpdate();
  }

  private sendChatMessage() {
    if (
      !this.sender ||
      !this.recipient ||
      !this.selectedQuickChatKey ||
      (this.requiresPlayerSelection && !this.selectedPlayer)
    )
      return;
    this.sendQuickChat(
      this.sender,
      this.recipient,
      this.selectedQuickChatKey,
      this.requiresPlayerSelection ? this.selectedPlayer?.id() : undefined,
    );
    this.close();
  }

  private canRepeatLastMessage(): boolean {
    const message = this.lastMessage;
    return (
      !!message &&
      (!message.target ||
        this.players.some((p) => p.id() === message.target && p.isAlive()))
    );
  }

  private lastMessagePreview(): string {
    if (!this.lastMessage) return "";
    const text = translateText(`chat.${this.lastMessage.key}`);
    const target = this.players.find(
      (p) => p.id() === this.lastMessage!.target,
    );
    return target ? text.replace("[P1]", target.displayName()) : text;
  }

  private sendLastMessage() {
    if (
      !this.sender ||
      !this.recipient ||
      !this.lastMessage ||
      !this.canRepeatLastMessage()
    )
      return;
    this.sendQuickChat(
      this.sender,
      this.recipient,
      this.lastMessage.key,
      this.lastMessage.target,
    );
    this.close();
  }

  private onPlayerSearchInput(e: Event) {
    const target = e.target as HTMLInputElement;
    this.playerSearchQuery = target.value.toLowerCase();
    this.requestUpdate();
  }

  private onPlayerSortChange(e: Event) {
    this.sortByTerritory = (e.target as HTMLInputElement).checked;
    this.requestUpdate();
  }

  private getSortedFilteredPlayers(): PlayerView[] {
    const sorted = [...this.players].sort((a, b) =>
      this.sortByTerritory
        ? b.numTilesOwned() - a.numTilesOwned()
        : a.displayName().localeCompare(b.displayName()),
    );
    const filtered = sorted.filter((p) =>
      p.displayName().toLowerCase().includes(this.playerSearchQuery),
    );
    const others = sorted.filter(
      (p) => !p.displayName().toLowerCase().includes(this.playerSearchQuery),
    );
    return [...filtered, ...others];
  }

  private getFullQuickChatKey(category: string, phraseKey: string): string {
    return `${category}.${phraseKey}`;
  }

  public open(sender?: PlayerView, recipient?: PlayerView) {
    this.captureReturnFocus();
    this.resetSelection();
    if (sender && recipient) {
      this.players = this.g
        .players()
        .filter((p) => p.isAlive() && p.type() !== PlayerType.Bot);

      this.recipient = recipient;
      this.sender = sender;
    }
    this.requestUpdate();
    this.isModalOpen = true;
  }

  private resetSelection() {
    this.selectedCategory = null;
    this.selectedQuickChatKey = null;
    this.selectedPlayer = null;
    this.playerSearchQuery = "";
    this.requiresPlayerSelection = false;
    this.requestUpdate();
  }

  private captureReturnFocus() {
    if (!this.isModalOpen) {
      this.returnFocus =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
    }
  }

  public close() {
    const restoreFocus =
      this.isModalOpen && this.contains(document.activeElement);
    const opener = this.returnFocus;
    this.returnFocus = null;
    this.resetSelection();
    this.isModalOpen = false;
    if (!restoreFocus) return;

    // Wait for HUD updates: the PlayerPanel opener may be removed by hide().
    void this.updateComplete.then(() => {
      if (
        this.isModalOpen ||
        (document.activeElement !== document.body &&
          !this.contains(document.activeElement))
      )
        return;
      const canFocusOpener =
        opener?.isConnected &&
        opener !== document.body &&
        !opener.closest("[inert], [hidden]") &&
        !opener.matches(":disabled") &&
        (opener.checkVisibility
          ? opener.checkVisibility({
              checkOpacity: true,
              checkVisibilityCSS: true,
            })
          : opener.getClientRects().length > 0);
      const focusTarget = canFocusOpener
        ? opener
        : document.getElementById("game-input-overlay");
      focusTarget?.focus({ preventScroll: true });
    });
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
    this.captureReturnFocus();
    if (sender && recipient) {
      this.players = this.g
        .players()
        .filter((p) => p.isAlive() && p.type() !== PlayerType.Bot);

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
    this.isModalOpen = true;
  }
}
