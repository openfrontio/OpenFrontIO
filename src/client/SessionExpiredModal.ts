import { html } from "lit";
import { customElement } from "lit/decorators.js";
import { wasLinkedAccount } from "./Api";
import { BaseModal, ModalConfig } from "./components/BaseModal";
import { translateText } from "./Utils";

/**
 * App-level warning shown when a previously-signed-in user's auth session
 * expires (a definitive 401/403 on /auth/refresh). Auth.ts dispatches the
 * "auth-session-expired" window event; we only surface it for users who were
 * actually logged in to an account — guests get a fresh session silently.
 */
@customElement("session-expired-modal")
export class SessionExpiredModal extends BaseModal {
  connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener("auth-session-expired", this.onSessionExpired);
  }

  disconnectedCallback(): void {
    window.removeEventListener("auth-session-expired", this.onSessionExpired);
    super.disconnectedCallback();
  }

  private onSessionExpired = (): void => {
    if (!wasLinkedAccount()) return;
    if (this.isOpen()) return;
    this.open();
  };

  protected modalConfig(): ModalConfig {
    return {
      title: translateText("session_expired.title"),
      hideHeader: false,
      hideCloseButton: false,
      maxWidth: "420px",
    };
  }

  private logIn(): void {
    this.close();
    window.showPage?.("page-account");
  }

  protected renderBody() {
    return html`
      <div class="px-6 py-4 text-gray-800 dark:text-gray-200">
        <p class="mb-6">${translateText("session_expired.body")}</p>
        <div class="flex justify-end gap-3">
          <o-button
            variant="secondary"
            size="md"
            translationKey="session_expired.dismiss"
            @click=${() => this.close()}
          ></o-button>
          <o-button
            variant="primary"
            size="md"
            translationKey="session_expired.log_in"
            @click=${() => this.logIn()}
          ></o-button>
        </div>
      </div>
    `;
  }
}
