import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";

@customElement("main-navbar")
export class Navbar extends LitElement {
  createRenderRoot() {
    return this;
  }

  render() {
    return html`
      <header>
        <div class="flex justify-between items-center mb-8">
          <div class="flex items-center">
            <div
              class="font-title text-large md:text-4xl text-transparent bg-clip-text bg-gradient-to-r from-primary to-primaryLighter"
            >
              OpenFront
            </div>
            <div
              class="ml-2 text-small font-title text-textGrey dark:text-textLight"
            >
              v24.0
            </div>
          </div>

          <o-button
            id="login-button"
            title="SIGN IN"
            translationKey="main.sign_in"
            icon="icons/user.svg"
          ></o-button>
        </div>
      </header>
    `;
  }
}
