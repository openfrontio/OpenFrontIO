import { html, LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";
import { EventBus } from "../../../core/EventBus";
import { PlayerType } from "../../../core/game/Game";
import { PlayerView } from "../../../core/game/GameView";
import { actionButton } from "../../components/ui/ActionButton";
import { SendKickPlayerIntentEvent } from "../../Transport";
import { translateText } from "../../Utils";
import kickIcon from "/images/ExitIconWhite.svg?url";
import shieldIcon from "/images/ShieldIconWhite.svg?url";

@customElement("player-moderation-modal")
export class PlayerModerationModal extends LitElement {
  @property({ attribute: false }) eventBus: EventBus | null = null;
  @property({ attribute: false }) myPlayer: PlayerView | null = null;
  @property({ attribute: false }) target: PlayerView | null = null;

  @property({ type: Boolean }) open: boolean = false;
  @property({ type: Boolean }) alreadyKicked: boolean = false;

  createRenderRoot() {
    return this;
  }

  updated(changed: Map<string, unknown>) {
    if (changed.has("open") && this.open) {
      queueMicrotask(() =>
        (this.querySelector('[role="dialog"]') as HTMLElement | null)?.focus(),
      );
    }
  }

  private closeModal() {
    this.dispatchEvent(new CustomEvent("close"));
  }

  private handleKeydown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      this.closeModal();
    }
  };

  private canKick(my: PlayerView, other: PlayerView): boolean {
    return (
      my.isLobbyCreator() &&
      other !== my &&
      other.type() === PlayerType.Human &&
      !!other.clientID()
    );
  }

  private handleKickClick = (e: MouseEvent) => {
    e.stopPropagation();

    const my = this.myPlayer;
    const other = this.target;
    const eventBus = this.eventBus;

    if (!my || !other) return;
    if (!this.canKick(my, other) || this.alreadyKicked) return;
    if (!eventBus) return;

    const targetClientID = other.clientID();
    if (!targetClientID || targetClientID.length === 0) return;

    const confirmed = confirm(
      translateText("player_panel.kick_confirm", { name: other.name() }),
    );
    if (!confirmed) return;

    eventBus.emit(new SendKickPlayerIntentEvent(targetClientID));
    this.dispatchEvent(
      new CustomEvent("kicked", { detail: { playerId: String(other.id()) } }),
    );
    this.closeModal();
  };

  render() {
    if (!this.open) return html``;

    const my = this.myPlayer;
    const other = this.target;
    if (!my || !other) return html``;

    const canKick = this.canKick(my, other);
    const alreadyKicked = this.alreadyKicked;
    if (!canKick && !alreadyKicked) return html``;

    const moderationTitle = translateText("player_panel.moderation");
    const kickTitle = alreadyKicked
      ? translateText("player_panel.kicked")
      : translateText("player_panel.kick");

    return html`
      <div class="absolute inset-0 z-1200 flex items-center justify-center p-4">
        <div
          class="absolute inset-0 bg-black/60 rounded-2xl"
          @click=${() => this.closeModal()}
        ></div>

        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="moderation-title"
          class="relative z-10 w-full max-w-120 focus:outline-hidden"
          tabindex="0"
          @keydown=${this.handleKeydown}
        >
          <div
            class="rounded-2xl bg-zinc-900 p-5 shadow-2xl ring-1 ring-zinc-800 max-h-[90vh] text-zinc-200"
            @click=${(e: MouseEvent) => e.stopPropagation()}
          >
            <div class="mb-3 flex items-center justify-between relative">
              <div class="flex items-center gap-2">
                <img
                  src=${shieldIcon}
                  alt=""
                  aria-hidden="true"
                  class="h-5 w-5"
                />
                <h2
                  id="moderation-title"
                  class="text-lg font-semibold tracking-tight text-zinc-100"
                >
                  ${moderationTitle}
                </h2>
              </div>

              <button
                type="button"
                @click=${() => this.closeModal()}
                class="absolute -top-3 -right-3 flex h-7 w-7 items-center justify-center rounded-full bg-zinc-700 text-white shadow-sm hover:bg-red-500 transition-colors focus-visible:ring-2 focus-visible:ring-white/30 focus:outline-hidden"
                aria-label=${translateText("common.close")}
                title=${translateText("common.close")}
              >
                ✕
              </button>
            </div>

            <div
              class="mb-4 rounded-xl border border-white/10 bg-white/5 px-3 py-2"
            >
              <div
                class="text-sm font-semibold text-zinc-100 truncate"
                title=${other.name()}
              >
                ${other.name()}
              </div>
            </div>

            <div class="grid auto-cols-fr grid-flow-col gap-1">
              ${actionButton({
                onClick: this.handleKickClick,
                icon: kickIcon,
                iconAlt: "Kick",
                title: kickTitle,
                label: kickTitle,
                type: "red",
                disabled: alreadyKicked || !canKick,
              })}
            </div>
          </div>
        </div>
      </div>
    `;
  }
}
