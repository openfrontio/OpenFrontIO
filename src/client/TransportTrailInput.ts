import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { TrailEffect } from "../core/CosmeticSchemas";
import {
  TRANSPORT_TRAIL_KEY,
  USER_SETTINGS_CHANGED_EVENT,
} from "../core/game/UserSettings";
import { renderTrailSwatch } from "./components/TransportTrailPreview";
import { getPlayerCosmetics } from "./Cosmetics";
import { crazyGamesSDK } from "./CrazyGamesSDK";
import { translateText } from "./Utils";

@customElement("transport-trail-input")
export class TransportTrailInput extends LitElement {
  @state() private effect: TrailEffect | null = null;
  @state() private isLoading: boolean = true;

  private _abortController: AbortController | null = null;

  private _onCosmeticSelected = async () => {
    const cosmetics = await getPlayerCosmetics();
    this.effect = cosmetics.transportTrail?.effect ?? null;
  };

  private onInputClick(e: Event) {
    e.preventDefault();
    e.stopPropagation();
    this.dispatchEvent(
      new CustomEvent("transport-trail-input-click", {
        bubbles: true,
        composed: true,
      }),
    );
  }

  async connectedCallback() {
    super.connectedCallback();
    this._abortController = new AbortController();
    this.isLoading = true;
    const cosmetics = await getPlayerCosmetics();
    this.effect = cosmetics.transportTrail?.effect ?? null;
    if (!this.isConnected) return;
    this.isLoading = false;
    window.addEventListener(
      `${USER_SETTINGS_CHANGED_EVENT}:${TRANSPORT_TRAIL_KEY}`,
      this._onCosmeticSelected,
      { signal: this._abortController.signal },
    );
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._abortController) {
      this._abortController.abort();
      this._abortController = null;
    }
  }

  createRenderRoot() {
    return this;
  }

  render() {
    if (crazyGamesSDK.isOnCrazyGames()) {
      return html``;
    }

    const buttonTitle = translateText("transport_trails.title");

    if (this.isLoading) {
      return html`
        <button
          id="transport-trail-input"
          class="m-0 p-0 w-full h-full flex cursor-pointer justify-center items-center focus:outline-none focus:ring-0 bg-surface rounded-lg overflow-hidden"
          disabled
        >
          <span
            class="w-6 h-6 border-4 border-blue-500/30 border-t-blue-500 rounded-full animate-spin"
          ></span>
        </button>
      `;
    }

    const preview =
      this.effect === null
        ? html`<span
            class="text-[10px] leading-none break-words px-1 font-black text-white uppercase w-full text-center"
          >
            ${translateText("transport_trails.select")}
          </span>`
        : html`<span class="w-full h-full p-1.5"
            >${renderTrailSwatch(this.effect)}</span
          >`;

    return html`
      <button
        id="transport-trail-input"
        class="m-0 p-0 w-full h-full flex cursor-pointer justify-center items-center focus:outline-none focus:ring-0 transition-all duration-200 hover:scale-105 bg-surface hover:brightness-[1.08] active:brightness-[0.95] hover:shadow-[var(--shadow-action-card-hover)] rounded-lg overflow-hidden"
        title=${buttonTitle}
        @click=${this.onInputClick}
      >
        ${preview}
      </button>
    `;
  }
}
