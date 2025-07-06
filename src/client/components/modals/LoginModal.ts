import { LitElement, html } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import { translateText } from "../../Utils";

@customElement("login-modal")
export class LoginModal extends LitElement {
  @query("o-modal") private modalEl!: HTMLElement & {
    open: () => void;
    close: () => void;
  };

  @state() private username = "";

  createRenderRoot() {
    return this;
  }

  public open() {
    this.modalEl?.open();
    this.requestUpdate();
  }

  public close() {
    this.modalEl?.close();
  }

  render() {
    return html`
      <o-modal width="small" .title=${translateText("main.sign_in")}>
        <div class="text-center mb-8">
          <div
            class="background-panel mx-auto mb-4 w-16 h-16 flex items-center justify-center"
          >
            <o-icon
              src="icons/user.svg"
              size="large"
              color="var(--primary-color-lighter)"
            ></o-icon>
          </div>
          <span class="text-textGrey font-title text-base m-0">
            ${translateText("login.login_message")}
          </span>
        </div>

        <div class="flex flex-col space-y-6">
          <o-button
            id="login-discord"
            title="Initializing..."
            icon="icons/discord.svg"
            disable
          ></o-button>

          <o-button
            id="logout-discord"
            title="Log out"
            translationKey="main.log_out"
            visible="false"
            icon="icons/user.svg"
          ></o-button>

          <div class="text-center">
            <p class="text-small text-textGrey m-0 leading-6">
              By signing in, you agree to our
              <a
                href="/privacy-policy.html"
                class="text-primaryLighter no-underline transition-colors hover:text-primary"
                >Terms of Service</a
              >
              and
              <a
                href="/terms-of-service.html"
                class="text-primaryLighter no-underline transition-colors hover:text-primary"
                >Privacy Policy</a
              >
            </p>
          </div>
        </div>
      </o-modal>
    `;
  }
}
