import { html, LitElement } from "lit";
import { customElement, query } from "lit/decorators.js";
import { tempTokenLogin } from "./Auth";
import "./components/Difficulties";
import "./components/PatternButton";
import { translateText } from "./Utils";

@customElement("token-login")
export class TokenLoginModal extends LitElement {
  @query("o-modal") private modalEl!: HTMLElement & {
    open: () => void;
    close: () => void;
  };

  private isAttemptingLogin = false;

  private retryInterval: NodeJS.Timeout | undefined = undefined;

  private token: string | null = null;

  private email: string | null = null;

  private attemptCount = 0;

  constructor() {
    super();
  }

  render() {
    return html`
      <o-modal
        id="token-login-modal"
        title="${translateText("token_login_modal.title")}"
      >
        ${this.email ? this.loginSuccess(this.email) : this.loggingIn()}
      </o-modal>
    `;
  }

  private loggingIn() {
    return html` <p>${translateText("token_login_modal.logging_in")}</p> `;
  }

  private loginSuccess(email: string) {
    return html`<p>
      ${translateText("token_login_modal.success", {
        email,
      })}
    </p> `;
  }

  public async open(token: string) {
    this.token = token;
    this.modalEl?.open();
    this.retryInterval = setInterval(() => this.tryLogin(), 3000);
  }

  public close() {
    this.token = null;
    clearInterval(this.retryInterval);
    this.attemptCount = 0;
    this.modalEl?.close();
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
