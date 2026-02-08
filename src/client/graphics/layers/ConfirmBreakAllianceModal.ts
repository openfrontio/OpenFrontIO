import { html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { EventBus } from "../../../core/EventBus";
import { GameView, PlayerView } from "../../../core/game/GameView";
import {
  ConfirmedBreakAllianceIntentEvent,
  RequestConfirmBreakAllianceEvent,
} from "../../Transport";
import { translateText } from "../../Utils";

@customElement("confirm-break-alliance-modal")
export class ConfirmBreakAllianceModal extends LitElement {
  @property({ attribute: false }) eventBus: EventBus | null = null;
  @property({ attribute: false }) game: GameView | null = null;

  @state() private open = false;
  @state() private recipient: PlayerView | null = null;
  @state() private requestor: PlayerView | null = null;

  private requestConfirmHandler = (e: RequestConfirmBreakAllianceEvent) => {
    this.requestor = e.requestor;
    this.recipient = e.recipient;
    this.open = true;
    this.requestUpdate();
  };

  private _subscribed = false;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
  }

  disconnectedCallback() {
    if (this.eventBus && this._subscribed) {
      this.eventBus.off(
        RequestConfirmBreakAllianceEvent,
        this.requestConfirmHandler,
      );
      this._subscribed = false;
    }
    super.disconnectedCallback();
  }

  updated(changed: Map<string, unknown>) {
    if (changed.has("eventBus")) {
      if (this._subscribed) {
        const previousEventBus = changed.get("eventBus") as
          | EventBus
          | null
          | undefined;
        if (previousEventBus) {
          previousEventBus.off(
            RequestConfirmBreakAllianceEvent,
            this.requestConfirmHandler,
          );
        }
        this._subscribed = false;
      }
      if (this.eventBus) {
        this.eventBus.on(
          RequestConfirmBreakAllianceEvent,
          this.requestConfirmHandler,
        );
        this._subscribed = true;
      }
    } else if (this.eventBus && !this._subscribed && changed.has("game")) {
      this.eventBus.on(
        RequestConfirmBreakAllianceEvent,
        this.requestConfirmHandler,
      );
      this._subscribed = true;
    }
    if (changed.has("open") && this.open) {
      queueMicrotask(() =>
        (this.querySelector('[role="dialog"]') as HTMLElement | null)?.focus(),
      );
    }
  }

  private closeModal() {
    this.open = false;
    this.recipient = null;
    this.requestor = null;
    this.requestUpdate();
  }

  private handleKeydown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      this.closeModal();
    }
  };

  private handleConfirm = (e: MouseEvent) => {
    e.stopPropagation();
    const game = this.game;
    const eventBus = this.eventBus;
    const recipient = this.recipient;
    const requestor = this.requestor;
    if (!game || !eventBus || !recipient || !requestor) {
      this.closeModal();
      return;
    }
    const myPlayer = game.myPlayer();
    let currentRecipient: PlayerView;
    try {
      const view = game.playerBySmallID(recipient.smallID());
      if (!view.isPlayer()) {
        this.closeModal();
        return;
      }
      currentRecipient = view as PlayerView;
    } catch {
      this.closeModal();
      return;
    }
    if (!myPlayer || !myPlayer.isAlliedWith(currentRecipient)) {
      this.closeModal();
      return;
    }
    eventBus.emit(
      new ConfirmedBreakAllianceIntentEvent(requestor, currentRecipient),
    );
    this.closeModal();
  };

  render() {
    if (!this.open || !this.recipient) return html``;

    const name = this.recipient.name();

    return html`
      <div class="fixed inset-0 z-[9999] flex items-center justify-center p-4">
        <div
          class="absolute inset-0 bg-black/60"
          @click=${() => this.closeModal()}
        ></div>

        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-break-alliance-title"
          class="relative z-10 w-full max-w-md focus:outline-none"
          tabindex="0"
          @keydown=${this.handleKeydown}
        >
          <div
            class="rounded-2xl bg-zinc-900 p-5 shadow-2xl ring-1 ring-zinc-800 text-zinc-200"
            @click=${(e: MouseEvent) => e.stopPropagation()}
          >
            <h2
              id="confirm-break-alliance-title"
              class="text-lg font-semibold tracking-tight text-zinc-100 mb-3"
            >
              ${translateText("confirm_break_alliance.title")}
            </h2>
            <p class="mb-5 text-zinc-300">
              ${translateText("confirm_break_alliance.message", { name })}
            </p>
            <div class="flex gap-3 justify-end">
              <button
                type="button"
                @click=${() => this.closeModal()}
                class="px-4 py-2 rounded-lg bg-zinc-700 text-white hover:bg-zinc-600 transition-colors"
              >
                ${translateText("common.cancel")}
              </button>
              <button
                type="button"
                @click=${this.handleConfirm}
                class="px-4 py-2 rounded-lg bg-red-600 text-white hover:bg-red-500 transition-colors"
              >
                ${translateText("confirm_break_alliance.confirm")}
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
  }
}
