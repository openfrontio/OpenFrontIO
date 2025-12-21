import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";

@customElement("lobby-notification-button")
export class LobbyNotificationButton extends LitElement {
  createRenderRoot() {
    return this;
  }

  private openModal() {
    const event = new CustomEvent("open-notification-modal", {
      bubbles: true,
      composed: true,
    });
    window.dispatchEvent(event);
  }

  render() {
    return html`
      <button
        title="Lobby Notifications"
        class="absolute top-0 left-[50px] md:top-[10px] md:left-[60px] border-none bg-none cursor-pointer text-2xl"
        @click=${this.openModal}
      >
        🔔
      </button>
    `;
  }
}
