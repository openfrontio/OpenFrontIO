import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { translateText } from "../../../../client/Utils";

@customElement("setting-keybind")
export class SettingKeybind extends LitElement {
  @property() label = "Setting";
  @property() description = "";
  @property({ type: String, reflect: true }) action = "";
  @property({ type: String }) defaultKey = "";
  @property({ type: String }) value = "";
  @property({ type: Boolean }) easter = false;

  createRenderRoot() {
    return this;
  }

  private listening = false;

  render() {
    return html`
      <div class="setting-item column${this.easter ? " easter-egg" : ""}">
        <div class="setting-label-group">
          <label class="setting-label block mb-1">${this.label}</label>

          <div class="setting-keybind-box flex flex-wrap items-start gap-2">
            <div
              class="setting-keybind-description flex-1 min-w-[240px] max-w-full whitespace-normal break-words text-sm text-gray-300"
              style="word-break: break-word;"
            >
              ${this.description}
            </div>

            <div
              class="flex flex-wrap items-center gap-2 gap-y-1 basis-full sm:basis-auto min-w-0"
            >
              <span
                class="setting-key shrink-0"
                tabindex="0"
                @keydown=${this.handleKeydown}
                @click=${this.startListening}
              >
                ${this.displayKey(this.value || this.defaultKey)}
              </span>

              <button
                class="text-xs text-gray-400 hover:text-white border border-gray-500 px-2 py-0.5 rounded transition whitespace-normal break-words max-w-full"
                @click=${this.resetToDefault}
              >
                ${translateText("user_setting.reset")}
              </button>
              <button
                class="text-xs text-gray-400 hover:text-white border border-gray-500 px-2 py-0.5 rounded transition whitespace-normal break-words max-w-full"
                @click=${this.unbindKey}
              >
                ${translateText("user_setting.unbind")}
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  private displayKey(key: string): string {
    if (key === " ") return "Space";
    if (key.startsWith("Key") && key.length === 4) {
      return key.slice(3);
    }
    return key.length
      ? key.charAt(0).toUpperCase() + key.slice(1)
      : "Press a key";
  }

  private startListening() {
    this.listening = true;
    this.requestUpdate();
  }

  private handleKeydown(e: KeyboardEvent) {
    if (!this.listening) return;
    e.preventDefault();

    const code = e.code;

    this.value = code;

    this.dispatchEvent(
      new CustomEvent("change", {
        detail: { action: this.action, value: code, key: e.key },
        bubbles: true,
        composed: true,
      }),
    );

    this.listening = false;
    this.requestUpdate();
  }

  private resetToDefault() {
    this.value = this.defaultKey;
    this.dispatchEvent(
      new CustomEvent("change", {
        detail: { action: this.action, value: this.defaultKey },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private unbindKey() {
    this.value = "";
    this.dispatchEvent(
      new CustomEvent("change", {
        detail: { action: this.action, value: "Null" },
        bubbles: true,
        composed: true,
      }),
    );
    this.requestUpdate();
  }
}
