import { html, LitElement, render as litRender } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  HOSTED_LOBBY_AUTO_START_MS,
  MAX_HOSTED_LOBBY_PLAYERS,
  MIN_HOSTED_LOBBY_AUTO_START_MS,
  MIN_HOSTED_LOBBY_PLAYERS,
} from "../../core/Schemas";
import { translateText } from "../Utils";
import "./FluentSlider";

export interface ListLobbyOptions {
  autoStartMs: number;
  maxPlayers: number;
}

const MIN_START_MINUTES = MIN_HOSTED_LOBBY_AUTO_START_MS / 60_000;
const MAX_START_MINUTES = HOSTED_LOBBY_AUTO_START_MS / 60_000;

/**
 * Shown when the host makes a lobby public: picks how long until it starts
 * and the player cap that starts it early. Fires `confirm` with
 * ListLobbyOptions, or `cancel`. Portalled to <body> like confirm-dialog so
 * it isn't clipped by the host modal.
 */
@customElement("list-lobby-dialog")
export class ListLobbyDialog extends LitElement {
  // Players already seated; the cap must leave room for at least one more.
  @property({ type: Number }) currentPlayers = 1;

  @state() private startMinutes = MAX_START_MINUTES;
  @state() private maxPlayers = MAX_HOSTED_LOBBY_PLAYERS;

  private portal: HTMLDivElement | null = null;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.portal = document.createElement("div");
    document.body.appendChild(this.portal);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this.portal) {
      litRender(html``, this.portal);
      this.portal.remove();
      this.portal = null;
    }
  }

  render() {
    if (this.portal) {
      litRender(this.renderOverlay(), this.portal);
    }
    return html``;
  }

  private minPlayers(): number {
    return Math.min(
      MAX_HOSTED_LOBBY_PLAYERS,
      Math.max(MIN_HOSTED_LOBBY_PLAYERS, this.currentPlayers + 1),
    );
  }

  private renderOverlay() {
    const minPlayers = this.minPlayers();
    const maxPlayers = Math.max(this.maxPlayers, minPlayers);
    return html`
      <div
        class="fixed inset-0 z-[10020] flex items-center justify-center bg-black/80"
        @click=${(e: Event) => {
          if (e.target === e.currentTarget) this.handleCancel();
        }}
      >
        <div
          class="relative mx-4 w-full max-w-md p-6 rounded-2xl border border-malibu-blue/50 bg-surface shadow-2xl"
        >
          <h2 class="text-lg font-bold text-white mb-2">
            ${translateText("host_modal.list_lobby_title")}
          </h2>
          <p class="text-sm font-medium text-white/70 mb-5">
            ${translateText("host_modal.list_lobby_body")}
          </p>
          <div class="flex flex-col gap-5 mb-6">
            <fluent-slider
              .min=${MIN_START_MINUTES}
              .max=${MAX_START_MINUTES}
              .step=${1}
              .value=${this.startMinutes}
              labelKey="host_modal.list_lobby_start_minutes"
              @value-changed=${(e: CustomEvent<{ value: number }>) =>
                (this.startMinutes = e.detail.value)}
            ></fluent-slider>
            <fluent-slider
              .min=${minPlayers}
              .max=${MAX_HOSTED_LOBBY_PLAYERS}
              .step=${1}
              .value=${maxPlayers}
              labelKey="host_modal.list_lobby_max_players"
              @value-changed=${(e: CustomEvent<{ value: number }>) =>
                (this.maxPlayers = e.detail.value)}
            ></fluent-slider>
          </div>
          <div class="flex gap-3">
            <button
              @click=${() => this.handleCancel()}
              class="flex-1 px-4 py-2.5 text-xs font-bold uppercase tracking-wider rounded-xl bg-white/5 text-white/60 border border-white/10 hover:bg-white/10 hover:text-white/80 transition-all"
            >
              ${translateText("common.cancel")}
            </button>
            <button
              @click=${() => this.handleConfirm(maxPlayers)}
              class="flex-1 px-4 py-2.5 text-xs font-bold uppercase tracking-wider rounded-xl bg-malibu-blue text-white hover:brightness-110 transition-all border-0"
            >
              ${translateText("host_modal.list_lobby_confirm")}
            </button>
          </div>
        </div>
      </div>
    `;
  }

  private handleConfirm(maxPlayers: number) {
    this.dispatchEvent(
      new CustomEvent<ListLobbyOptions>("confirm", {
        detail: {
          autoStartMs: this.startMinutes * 60_000,
          maxPlayers,
        },
      }),
    );
  }

  private handleCancel() {
    this.dispatchEvent(new CustomEvent("cancel"));
  }
}
