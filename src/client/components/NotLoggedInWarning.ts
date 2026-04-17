import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { UserMeResponse } from "../../core/ApiSchemas";
import { hasLinkedAccount } from "../Api";

@customElement("not-logged-in-warning")
export class NotLoggedInWarning extends LitElement {
  @state() private linked = false;

  private _onUserMe = (event: CustomEvent<UserMeResponse | false>) => {
    this.linked = hasLinkedAccount(event.detail);
  };

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener(
      "userMeResponse",
      this._onUserMe as EventListener,
    );
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener(
      "userMeResponse",
      this._onUserMe as EventListener,
    );
  }

  render() {
    if (this.linked) return html``;

    return html`<div class="no-crazygames flex items-center">
      <button
        class="px-4 py-2 text-xs font-bold uppercase tracking-wider transition-colors duration-200 rounded-lg bg-red-500/20 text-red-400 border border-red-500/30 cursor-pointer hover:bg-red-500/30"
        data-i18n="common.not_logged_in"
        @click=${() => {
          window.showPage?.("page-account");
        }}
      >
        Not logged in
      </button>
    </div>`;
  }
}
