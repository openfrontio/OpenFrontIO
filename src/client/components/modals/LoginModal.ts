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

  connectedCallback() {
    super.connectedCallback();
  }

  public open() {
    this.modalEl?.open();
  }

  public close() {
    this.modalEl?.close();
  }

  private handleUsernameChange(e: Event) {
    this.username = (e.target as HTMLInputElement).value;
  }

  private handleSubmit(e: Event) {
    e.preventDefault();
    console.log("Login submitted with username:", this.username);
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

        <form @submit=${this.handleSubmit} class="flex flex-col space-y-6">
          <!--
          <div class="background-panel  p-4">
            <label
              for="username"
              class="block font-title text-textLight mb-2 text-base"
              >Username</label
            >
            <div class="relative">
              <div
                class="absolute top-1/2 left-3 -translate-y-1/2 text-textGrey pointer-events-none"
              >
                <o-icon
                  src="icons/mail.svg"
                  size="small"
                  color="var(--primary-color-lighter)"
                ></o-icon>
              </div>
              <input
                type="text"
                id="username"
                .value=${this.username}
                @input=${this.handleUsernameChange}
                class="w-full pl-10 pr-4 py-3 bg-backgroundDarkLighter border-2 border-borderBase font-title text-textLight caret-primary outline-none transition-colors focus:border-primary placeholder:text-textGrey"
                placeholder="Anon69"
              />
            </div>
          </div>
  -->
          <o-button
            id="login-discord"
            title="Initializing..."
            disable
            block
            class="hidden"
            icon="icons/user.svg"
          ></o-button>

          <o-button
            id="logout-discord"
            title="Log out"
            translationKey="main.log_out"
            visible="false"
            block
            class="hidden"
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
        </form>
      </o-modal>
    `;
  }
}
