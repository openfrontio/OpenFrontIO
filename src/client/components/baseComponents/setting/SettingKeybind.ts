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

  private listening = false;

  createRenderRoot() {
    return this;
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
        detail: { action: this.action, value: code },
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
  render() {
    return html`
      <div class="background-panel p-4 w-full max-w-full mb-4">
        <div class="flex items-center gap-3 mb-3">
          <div>
            <div class="font-title text-textLight">${this.label}</div>
            <div class="text-small text-textGrey">${this.description}</div>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <span
            class="text-textLight px-3 py-1 font-title text-small cursor-pointer bg-primary border border-white/10 shadow-[inset_-2px_-2px_0_0_#1e293b,inset_2px_2px_0_0_#475569]"
            tabindex="0"
            @keydown=${this.handleKeydown}
            @click=${this.startListening}
          >
            ${this.displayKey(this.value || this.defaultKey)}
          </span>
          <button
            class="text-xsmall text-textGrey hover:text-textLight border border-borderBase px-2 py-0.5 transition-colors duration-200"
            @click=${this.resetToDefault}
          >
            ${translateText("user_setting.reset")}
          </button>
          <button
            @click=${this.unbindKey}
            class="text-xsmall text-textGrey hover:text-textLight border border-borderBase px-2 py-0.5 transition-colors duration-200"
          >
            ${translateText("user_setting.unbind")}
          </button>
        </div>
      </div>
    `;
  }
}
