import { html, LitElement, PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { DarkModeChangedEvent, UserSettings } from "../core/game/UserSettings";

@customElement("dark-mode-button")
export class DarkModeButton extends LitElement {
  @property({ type: Object })
  userSettings: UserSettings;

  @state() private darkMode: boolean = false;

  protected updated(changedProperties: PropertyValues) {
    if (changedProperties.has("userSettings") && this.userSettings) {
      // make sure the previous listener is removed
      const oldUserSettings = changedProperties.get("userSettings");
      if (oldUserSettings) {
        oldUserSettings.eventBus.off(
          DarkModeChangedEvent,
          this.onDarkModeChanged,
        );
      }

      this.darkMode = this.userSettings.darkMode();
      this.userSettings.eventBus.on(
        DarkModeChangedEvent,
        this.onDarkModeChanged,
      );
    }
  }

  createRenderRoot() {
    return this;
  }

  toggleDarkMode() {
    this.userSettings.toggleDarkMode();
    this.darkMode = this.userSettings.darkMode();
  }

  private onDarkModeChanged = (e: DarkModeChangedEvent) => {
    this.darkMode = e.value;
  };

  connectedCallback() {
    super.connectedCallback();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this.userSettings) {
      this.userSettings.eventBus.off(
        DarkModeChangedEvent,
        this.onDarkModeChanged,
      );
    }
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
