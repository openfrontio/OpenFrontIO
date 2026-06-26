import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { TransportShipTrailAttributes } from "../core/CosmeticSchemas";
import {
  EFFECTS_KEY,
  USER_SETTINGS_CHANGED_EVENT,
} from "../core/game/UserSettings";
import { renderTransportShipTrailSwatch } from "./components/EffectPreview";
import { getPlayerCosmetics } from "./Cosmetics";
import { crazyGamesSDK } from "./CrazyGamesSDK";
import { translateText } from "./Utils";

@customElement("effects-input")
export class EffectsInput extends LitElement {
  // The selected transport-ship-trail attributes, if any (one effectType today).
  // Not named `attributes` — that collides with HTMLElement.attributes.
  @state() private trailAttributes: TransportShipTrailAttributes | null = null;

  private _abortController: AbortController | null = null;

  private _onCosmeticSelected = async () => {
    const cosmetics = await getPlayerCosmetics();
    this.trailAttributes =
      cosmetics.effects?.["transportShipTrail"]?.attributes ?? null;
  };

  private onInputClick(e: Event) {
    e.preventDefault();
    e.stopPropagation();
    this.dispatchEvent(
      new CustomEvent("effects-input-click", {
        bubbles: true,
        composed: true,
      }),
    );
  }

  async connectedCallback() {
    super.connectedCallback();
    this._abortController = new AbortController();
    const cosmetics = await getPlayerCosmetics();
    this.trailAttributes =
      cosmetics.effects?.["transportShipTrail"]?.attributes ?? null;
    window.addEventListener(
      `${USER_SETTINGS_CHANGED_EVENT}:${EFFECTS_KEY}`,
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

    const preview =
      this.trailAttributes === null
        ? html`<span
            class="text-[7px] lg:text-[10px] font-black tracking-wider text-white uppercase leading-tight lg:leading-none w-full text-center px-0.5 lg:px-1"
          >
            ${translateText("effects.title")}
          </span>`
        : html`<span class="w-full h-full p-1.5"
            >${renderTransportShipTrailSwatch(this.trailAttributes)}</span
          >`;

    return html`
      <button
        id="effects-input"
        class="p-0 m-0 border-0 w-full h-full flex cursor-pointer justify-center items-center focus:outline-none focus:ring-0 transition-all duration-200 hover:scale-105 bg-surface hover:brightness-[1.08] active:brightness-[0.95] hover:shadow-[var(--shadow-action-card-hover)] rounded-lg overflow-hidden"
        title=${translateText("effects.button_title")}
        @click=${this.onInputClick}
      >
        ${preview}
      </button>
    `;
  }
}
