import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { UserSettings } from "../core/game/UserSettings";

@customElement("color-blind-mode-button")
export class ColorBlindModeButton extends LitElement {
  private readonly userSettings: UserSettings = new UserSettings();
  @state() private colorBlindMode: boolean = this.userSettings.colorBlindMode();

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("colorblind-mode-changed", this.handleColorBlindModeChanged);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("colorblind-mode-changed", this.handleColorBlindModeChanged);
  }

  private readonly handleColorBlindModeChanged = (e: Event) => {
    const event = e as CustomEvent<{ colorBlindMode: boolean }>;
    this.colorBlindMode = event.detail.colorBlindMode;
  };

  toggleColorBlindMode() {
    this.userSettings.toggleColorBlindMode();
    this.colorBlindMode = this.userSettings.colorBlindMode();
  }

  render() {
    const active = html`
      <svg class="w-6 h-6 text-green-600" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 5c-7 0-10 7-10 7s3 7 10 7 10-7 10-7-3-7-10-7zm0 12c-2.76 0-5-2.24-5-5
                  s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5z"/>
        <circle cx="12" cy="12" r="2" fill="white"/>
        <circle cx="9" cy="9" r="1" fill="white" opacity="0.5"/>
        <circle cx="15" cy="15" r="1" fill="white" opacity="0.5"/>
      </svg>
    `;
    const inactive = html`
      <svg class="w-6 h-6 text-gray-700" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 5c-7 0-10 7-10 7s3 7 10 7 10-7 10-7-3-7-10-7zm0 12c-2.76 0-5-2.24-5-5
                  s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5z"/>
        <circle cx="12" cy="12" r="2" fill="white"/>
      </svg>
    `;
    return html`
    <button
      aria-label="Toggle Color Blind Mode"
      title="Toggle Color Blind Mode"
      class="absolute top-2 right-2 md:top-3 md:right-3
             flex items-center justify-center
             w-10 h-10 rounded-full shadow-md
             bg-gray-100 hover:bg-gray-200 active:scale-95
             transition-transform duration-200 ease-in-out"
      @click=${() => this.toggleColorBlindMode()}
    >
      ${this.colorBlindMode
        ? active
        : inactive}
    </button>
  `;
  }
}
