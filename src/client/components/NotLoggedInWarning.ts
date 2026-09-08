import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { UserMeResponse } from "../../core/ApiSchemas";
import { responseHasLinkedIdentity } from "../AccountIdentity";

@customElement("not-logged-in-warning")
export class NotLoggedInWarning extends LitElement {
  // Three states, not two. `null` is "auth has not settled yet": Main only
  // broadcasts userMeResponse once userAuth() (a Steam ticket exchange on
  // desktop) has resolved, and this element is on the page from mount. Until
  // that first broadcast nothing is known, so nothing is shown. Starting at
  // `false` instead rendered the "Not logged in" button to every logged-in
  // player for the whole pending window -- most visibly on the post-purchase
  // reload, right after they had spent money (OPE-338).
  @state() private linked: boolean | null = null;

  private _onUserMe = (event: CustomEvent<UserMeResponse | false>) => {
    this.linked = responseHasLinkedIdentity(event.detail);
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
    // Pending and linked both render nothing; only a SETTLED no-session
    // result warns.
    if (this.linked !== false) return html``;

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
