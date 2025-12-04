import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { translateText } from "../../client/Utils";
import { EventBus } from "../../core/EventBus";
import { SendLobbyChatEvent } from "../Transport";

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
    document.addEventListener("lobby-chat:message", this.onIncoming as any);
    const globalBus = (window as any).__eventBus as EventBus | undefined;
    if (globalBus) {
      this.bus = globalBus;
    }
    this.username = (window as any).__username ?? null;
    document.addEventListener("event-bus:ready", this.onBusReady as any);
  }

  disconnectedCallback(): void {
    document.removeEventListener("lobby-chat:message", this.onIncoming as any);
    document.removeEventListener("event-bus:ready", this.onBusReady as any);
    super.disconnectedCallback();
  }

  setEventBus(bus: EventBus) {
    this.bus = bus;
  }

  private onIncoming = async (
    e: CustomEvent<{ username: string; isHost: boolean; text: string }>,
  ) => {
    const { username, isHost, text } = e.detail;
    this.messages = [...this.messages, { username, isHost, text }];
    await this.updateComplete;
    const container = this.renderRoot.querySelector(
      ".lcp-messages",
    ) as HTMLElement | null;
    if (container) container.scrollTop = container.scrollHeight;
  };

  private onBusReady = () => {
    const globalBus = (window as any).__eventBus as EventBus | undefined;
    if (globalBus) {
      this.bus = globalBus;
    }
    this.username ??= (window as any).__username ?? null;
  };

  private sendMessage() {
    const text = this.inputText.trim();
    if (!text) return;
    if (!this.bus) {
      const globalBus = (window as any).__eventBus as EventBus | undefined;
      if (globalBus) {
        this.bus = globalBus;
      }
    }
    if (!this.bus) {
      console.warn("LobbyChatPanel: EventBus unavailable. Message not sent.");
      return;
    }
    const capped = text.slice(0, 300);
    this.bus.emit(new SendLobbyChatEvent(capped));
    this.inputText = "";
  }

  render() {
    return html`
      <div class="lcp-container">
        <div class="lcp-messages">
          ${this.messages.map((m) => {
            const displayName = m.isHost ? `${m.username} (Host)` : m.username;
            const isLocal =
              this.username !== null && m.username === this.username;
            const msgClass = isLocal
              ? "lcp-msg lcp-msg--local"
              : "lcp-msg lcp-msg--remote";
            return html`<div class="${msgClass}">
              <span class="lcp-sender">${displayName}:</span> ${m.text}
            </div>`;
          })}
        </div>
        <div class="lcp-input-row">
          <input
            class="lcp-input"
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
          />
          <button class="lcp-send" @click=${() => this.sendMessage()}>
            ${translateText("lobby_chat.send")}
          </button>
        </div>
      </div>
    `;
  }

  createRenderRoot() {
    return this; // use light DOM for existing styles
  }
}

const style = document.createElement("style");
style.textContent = `
  .lcp-container {
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-height: 240px;
  }
  .lcp-messages {
    overflow-y: auto;
    border: 1px solid #444;
    border-radius: 8px;
    padding: 8px;
    height: 180px;
    background: rgba(0, 0, 0, 0.5);
    color: #ddd;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .lcp-msg {
    font-size: 0.9rem;
    padding: 6px 10px;
    border-radius: 10px;
    background: rgba(0, 0, 0, 0.6);
  }
  .lcp-msg--local {
    align-self: flex-end;
    text-align: right;
    background: rgba(36, 59, 85, 0.7);
  }
  .lcp-msg--remote {
    align-self: flex-start;
    text-align: left;
    background: rgba(0, 0, 0, 0.6);
  }
  .lcp-sender {
    color: #9ae6b4;
    margin-right: 4px;
  }
  .lcp-input-row {
    display: flex;
    gap: 8px;
  }
  .lcp-input {
    flex: 1;
    border-radius: 8px;
    padding: 6px 10px;
    color: #000;
  }
  .lcp-send {
    border-radius: 8px;
    padding: 6px 12px;
  }
`;
document.head.appendChild(style);
