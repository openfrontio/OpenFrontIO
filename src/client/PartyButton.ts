import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";

@customElement("party-button")
export class PartyButton extends LitElement {
  @state() private partySize: number = 0;
  @state() private partyCode: string = "";

  createRenderRoot() {
    return this;
  }

  render() {
    return html`
      <button
        @click=${this.openPartyModal}
        class="c-button c-button--block"
        style="position: relative; background: linear-gradient(135deg, #9333ea 0%, #7e22ce 100%); border: none;"
      >
        <span style="margin-right: 8px;"></span>
        <span>Party</span>
        ${this.partySize > 0
          ? html`
              <span
                style="position: absolute; top: -8px; right: -8px; background: #10b981; color: white; font-size: 12px; font-weight: bold; border-radius: 50%; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; border: 2px solid white;"
              >
                ${this.partySize}
              </span>
            `
          : ""}
      </button>
    `;
  }

  private openPartyModal() {
    this.dispatchEvent(
      new CustomEvent("open-party-modal", {
        bubbles: true,
        composed: true,
      }),
    );
  }

  public updatePartyInfo(partySize: number, partyCode: string) {
    this.partySize = partySize;
    this.partyCode = partyCode;
  }
}
