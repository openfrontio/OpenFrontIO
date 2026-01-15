import { html } from "lit";
import { customElement } from "lit/decorators.js";
import { tempTokenLogin } from "./Auth";
import { BaseModal } from "./components/BaseModal";
import "./components/Difficulties";
import "./components/PatternButton";
import { modalHeader } from "./components/ui/ModalHeader";
import { translateText } from "./Utils";

@customElement("token-login")
export class TokenLoginModal extends BaseModal {
  private isAttemptingLogin = false;

  private retryInterval: NodeJS.Timeout | undefined = undefined;

  private token: string | null = null;

  private email: string | null = null;

  private attemptCount = 0;

  constructor() {
    super();
  }

  render() {
    const title = translateText("token_login_modal.title");
    const content = html`
      <div
        class="h-full flex flex-col ${this.inline
          ? "bg-black/60 backdrop-blur-md rounded-2xl border border-white/10 overflow-hidden"
          : ""}"
      >
        ${modalHeader({
          title,
          onBack: () => this.close(),
          ariaLabel: translateText("common.back"),
        })}
        <div class="flex-1 flex flex-col gap-4 p-6">
          ${this.email ? this.loginSuccess(this.email) : this.loggingIn()}
        </div>
      </div>
    `;

    if (this.inline) {
      return content;
    }

    return html`
      <o-modal
        id="token-login-modal"
        title="${title}"
        hideHeader
        hideCloseButton
        maxWidth="620px"
      >
        ${content}
      </o-modal>
    `;
  }

  private loggingIn() {
    const loggingText = translateText("token_login_modal.logging_in");
    return html`
      <div class="flex items-center gap-4">
        <div
          class="w-12 h-12 rounded-full border border-blue-400/40 bg-blue-500/10 flex items-center justify-center"
        >
          <div
            class="w-6 h-6 border-2 border-blue-400/30 border-t-blue-400 rounded-full animate-spin"
          ></div>
        </div>
        <div class="flex flex-col gap-2">
          <p class="text-lg font-semibold text-white">${loggingText}</p>
          <div class="h-1 w-full bg-white/10 rounded-full overflow-hidden">
            <div class="h-full w-1/2 bg-blue-400/80 animate-pulse"></div>
          </div>
        </div>
      </div>
    `;
  }

  private loginSuccess(email: string) {
    const successText = translateText("token_login_modal.success", { email });
    return html`
      <div class="flex items-center gap-4">
        <div
          class="w-12 h-12 rounded-full border border-emerald-400/40 bg-emerald-500/10 flex items-center justify-center"
        >
          <div class="w-2 h-2 bg-emerald-400 rounded-full animate-pulse"></div>
        </div>
        <p class="text-base text-white/90">${successText}</p>
      </div>
    `;
  }

  public open(): void {
    if (!this.token) {
      return;
    }
    super.open();
    clearInterval(this.retryInterval);
    this.retryInterval = setInterval(() => this.tryLogin(), 3000);
  }

  public openWithToken(token: string): void {
    this.token = token;
    this.email = null;
    this.attemptCount = 0;
    this.isAttemptingLogin = false;
    this.open();
  }

  public close() {
    this.token = null;
    clearInterval(this.retryInterval);
    this.attemptCount = 0;
    super.close();
    this.isAttemptingLogin = false;
  }

  private async tryLogin() {
    if (this.isAttemptingLogin) {
      return;
    }
    if (this.attemptCount > 3) {
      this.close();
      alert("Login failed. Please try again later.");
      return;
    }
    this.attemptCount++;
    this.isAttemptingLogin = true;
    if (this.token === null) {
      this.close();
      return;
    }
    try {
      this.email = await tempTokenLogin(this.token);
      if (!this.email) {
        return;
      }
      clearInterval(this.retryInterval);
      setTimeout(() => {
        this.close();
        window.location.reload();
      }, 1000);
      this.requestUpdate();
    } catch (e) {
      console.error(e);
    } finally {
      this.isAttemptingLogin = false;
    }
  }
}
