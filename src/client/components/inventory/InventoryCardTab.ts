import type { UserMeResponse } from "@openfront/shared/ApiSchemas";
import { html, LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";
import "../card/MyCardTab";

/**
 * The Inventory's Player card tab. For now it shows the existing card
 * customiser (<my-card-tab>) so nothing regresses; the redesigned tab
 * replaces this body.
 */
@customElement("inventory-card-tab")
export class InventoryCardTab extends LitElement {
  @property({ attribute: false }) userMe: UserMeResponse | null = null;

  createRenderRoot() {
    return this;
  }

  render() {
    return html`<my-card-tab
      .userMe=${this.userMe}
      @change-flag=${(event: Event) => {
        event.stopPropagation();
        this.dispatchEvent(
          new CustomEvent("change-flag", { bubbles: true, composed: true }),
        );
      }}
    ></my-card-tab>`;
  }
}
