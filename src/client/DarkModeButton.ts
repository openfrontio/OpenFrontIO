import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { userSettings } from "../core/game/UserSettings";

@customElement("dark-mode-button")
export class DarkModeButton extends LitElement {
  @state() private darkMode: boolean = userSettings.darkMode();

  createRenderRoot() {
    return this;
  }

  toggleDarkMode() {
    userSettings.toggleDarkMode();
    this.darkMode = userSettings.darkMode();
  }

  render() {
    return html`
      <button
        title="Toggle Dark Mode"
        class="absolute top-0 right-0 md:top-[10px] md:right-[10px] border-none bg-none cursor-pointer text-2xl"
        @click=${() => this.toggleDarkMode()}
      >
        ${this.darkMode ? "☀️" : "🌙"}
      </button>
    `;
  }
}
