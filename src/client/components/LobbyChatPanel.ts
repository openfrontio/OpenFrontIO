import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { translateText } from "../../client/Utils";
import { EventBus } from "../../core/EventBus";
import { SendLobbyChatEvent } from "../Transport";

interface ChatMessage {
  sender: string;
  text: string;
}

@customElement("lobby-chat-panel")
export class LobbyChatPanel extends LitElement {
  @state() private messages: ChatMessage[] = [];
  @state() private inputText: string = "";

  private bus: EventBus | null = null;
  private myClientID: string | null = null;

  connectedCallback(): void {
    super.connectedCallback();
    // Listen for websocket relay from ClientGameRunner
    document.addEventListener("lobby-chat:message", this.onIncoming as any);
    // Attempt to attach global EventBus if available
    const globalBus = (window as any).__eventBus as EventBus | undefined;
    if (globalBus) {
      this.bus = globalBus;
    }
    // Capture my client ID for alignment
    this.myClientID = (window as any).__clientID ?? null;
    // Proactively bind when the bus becomes ready later
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

  private onIncoming = (e: CustomEvent<{ sender: string; text: string }>) => {
    const { sender, text } = e.detail;
    this.messages = [...this.messages, { sender, text }];
    const container = this.renderRoot.querySelector(".messages") as HTMLElement;
    if (container) container.scrollTop = container.scrollHeight;
  };

  private onBusReady = () => {
    const globalBus = (window as any).__eventBus as EventBus | undefined;
    if (globalBus) {
      this.bus = globalBus;
    }
    this.myClientID = (window as any).__clientID ?? this.myClientID;
  };

  private sendMessage() {
    const text = this.inputText.trim();
    if (!text) return;
    // Lazily attach global EventBus if it wasn't ready at connect time
    if (!this.bus) {
      const globalBus = (window as any).__eventBus as EventBus | undefined;
      if (globalBus) {
        this.bus = globalBus;
      }
    }
    this.bus?.emit(new SendLobbyChatEvent(text));
    this.inputText = "";
  }

  render() {
    return html`
      <div class="chat-container">
        <div class="messages">
          ${this.messages.map((m) => {
            const isSelf =
              this.myClientID !== null && m.sender === this.myClientID;
            const cls = isSelf ? "msg right" : "msg left";
            return html`<div class="${cls}">
              <span class="sender">${m.sender}:</span> ${m.text}
            </div>`;
          })}
        </div>
        <div class="input-row">
          <input
            class="input"
            type="text"
            .value=${this.inputText}
            @input=${(e: Event) =>
              (this.inputText = (e.target as HTMLInputElement).value)}
            @keydown=${(e: KeyboardEvent) => {
              if (e.key === "Enter") this.sendMessage();
            }}
            placeholder=${translateText("lobby_chat.placeholder")}
          />
          <button class="send" @click=${() => this.sendMessage()}>
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

// Basic Tailwind-like classes scoped
const style = document.createElement("style");
style.textContent = `
.chat-container { display:flex; flex-direction:column; gap:8px; max-height:240px; }
.messages { overflow-y:auto; border:1px solid #444; border-radius:8px; padding:8px; height:180px; background:#111; color:#ddd; display:flex; flex-direction:column; gap:6px; }
.msg { font-size: 0.9rem; max-width: 80%; padding:6px 10px; border-radius:10px; background:#1b1b1b; }
.msg.left { align-self: flex-start; }
.msg.right { align-self: flex-end; background:#243b55; }
.sender { color:#9ae6b4; margin-right:4px; }
.input-row { display:flex; gap:8px; }
.input { flex:1; border-radius:8px; padding:6px 10px; color:#000; }
.send { border-radius:8px; padding:6px 12px; }
`;
document.head.appendChild(style);
