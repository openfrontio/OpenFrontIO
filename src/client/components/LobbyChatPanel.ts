import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { translateText } from "../../client/Utils";
import { EventBus } from "../../core/EventBus";
import { ReceiveLobbyChatEvent, SendLobbyChatEvent } from "../Transport";

interface ChatMessage {
  username: string;
  isHost: boolean;
  text: string;
}

@customElement("lobby-chat-panel")
export class LobbyChatPanel extends LitElement {
  @state() private messages: ChatMessage[] = [];
  @state() private inputText: string = "";

  private bus: EventBus | null = null;
  private username: string | null = null;

  connectedCallback(): void {
    super.connectedCallback();
    const globalBus = window.__eventBus;
    if (globalBus) {
      this.bus = globalBus;
      this.bus.on(ReceiveLobbyChatEvent, this.onIncoming);
    }
    this.username = window.__username ?? null;
  }

  disconnectedCallback(): void {
    if (this.bus) {
      this.bus.off(ReceiveLobbyChatEvent, this.onIncoming);
    }
    super.disconnectedCallback();
  }

  setEventBus(bus: EventBus) {
    // Remove old listener if exists
    if (this.bus) {
      this.bus.off(ReceiveLobbyChatEvent, this.onIncoming);
    }
    this.bus = bus;
    this.bus.on(ReceiveLobbyChatEvent, this.onIncoming);
  }

  private onIncoming = async (e: ReceiveLobbyChatEvent) => {
    this.messages = [
      ...this.messages,
      { username: e.username, isHost: e.isHost, text: e.text },
    ];
    await this.updateComplete;
    const container = this.renderRoot.querySelector(
      ".lcp-messages",
    ) as HTMLElement | null;
    if (container) container.scrollTop = container.scrollHeight;
  };

  private get canSend(): boolean {
    return this.bus !== null;
  }

  private sendMessage() {
    const text = this.inputText.trim();
    if (!text) return;

    // Try to get the bus from global if not already set
    if (!this.bus) {
      const globalBus = window.__eventBus;
      if (globalBus) {
        this.bus = globalBus;
      }
    }

    // If still no bus, don't clear input - user can retry
    if (!this.bus) {
      return;
    }

    const capped = text.slice(0, 300);
    this.bus.emit(new SendLobbyChatEvent(capped));
    this.inputText = "";
  }

  render() {
    return html`
      <div class="flex flex-col gap-2 max-h-60 w-full">
        <div
          class="overflow-y-auto border border-white/10 rounded-lg p-2 h-[150px] min-h-[120px] bg-black/50 text-white/80 flex flex-col gap-1.5 touch-auto sm:max-h-[200px] sm:h-[120px] sm:min-h-[100px]"
          role="log"
          aria-live="polite"
        >
          ${this.messages.map((m) => {
            const displayName = m.isHost ? `${m.username} (Host)` : m.username;
            const isLocal =
              this.username !== null && m.username === this.username;
            const msgClass = isLocal
              ? "text-sm px-3 py-2 rounded-xl max-w-[85%] break-words self-end text-right bg-[rgba(36,59,85,0.7)] sm:text-xs sm:px-2.5 sm:py-1.5 sm:max-w-[90%]"
              : "text-sm px-3 py-2 rounded-xl max-w-[85%] break-words self-start text-left bg-black/60 sm:text-xs sm:px-2.5 sm:py-1.5 sm:max-w-[90%]";
            return html`<div class="${msgClass}">
              <span class="text-green-400 mr-1 font-medium"
                >${displayName}:</span
              >
              ${m.text}
            </div>`;
          })}
        </div>
        <div class="flex gap-2 flex-nowrap">
          <input
            class="flex-1 min-w-0 rounded-lg px-3 py-2.5 text-base text-black bg-white/90 border border-white/20 focus:outline-none focus:border-blue-500/50 focus:bg-white sm:py-2 sm:px-2.5"
            type="text"
            maxlength="300"
            .value=${this.inputText}
            @input=${(e: Event) =>
              (this.inputText = (e.target as HTMLInputElement).value)}
            @keydown=${(e: KeyboardEvent) => {
              if (e.key === "Enter") {
                e.preventDefault();
                e.stopPropagation();
                this.sendMessage();
              }
            }}
            placeholder=${translateText("lobby_chat.placeholder")}
            aria-label=${translateText("lobby_chat.placeholder")}
          />
          <button
            class="rounded-lg px-4 py-2.5 text-sm font-semibold bg-blue-600/80 text-white border-none cursor-pointer whitespace-nowrap min-w-[60px] transition-all hover:bg-blue-600 active:bg-blue-700 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed sm:px-3 sm:py-2 sm:min-w-[50px]"
            @click=${() => this.sendMessage()}
            ?disabled=${!this.canSend}
          >
            ${translateText("lobby_chat.send")}
          </button>
        </div>
      </div>
    `;
  }

  createRenderRoot() {
    return this;
  }
}
