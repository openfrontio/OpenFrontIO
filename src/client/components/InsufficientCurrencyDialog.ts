import { html, LitElement, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { InsufficientCurrency } from "../Cosmetics";
import { translateText } from "../Utils";
import "./ConfirmDialog";

/**
 * Shown when the player can't afford a cosmetic. Set `.info` to display it and
 * clear it on `@close`. Plutonium gets a top-up button; caps are dismiss-only.
 */
@customElement("insufficient-currency-dialog")
export class InsufficientCurrencyDialog extends LitElement {
  @property({ attribute: false }) info: InsufficientCurrency | null = null;

  createRenderRoot() {
    return this;
  }

  private close() {
    this.dispatchEvent(new CustomEvent("close"));
  }

  render() {
    const info = this.info;
    if (!info) return nothing;
    return html`<confirm-dialog
      .heading=${translateText("store.insufficient_currency_title", {
        currency: info.currency,
      })}
      .message=${translateText("store.insufficient_currency_body", {
        amount: info.shortfall,
        currency: info.currency,
        item: info.item,
      })}
      variant="warning"
      .wide=${true}
      .showClose=${true}
      .buttons=${info.canTopUp ? "confirmOnly" : "none"}
      .confirmText=${info.canTopUp
        ? translateText("store.purchase_currency", { currency: info.currency })
        : ""}
      @cancel=${() => this.close()}
      @confirm=${() => {
        this.close();
        // Home path (not just hash) so it also works from in-game (win modal).
        window.location.href = "/#modal=store&tab=packs";
      }}
    ></confirm-dialog>`;
  }
}
