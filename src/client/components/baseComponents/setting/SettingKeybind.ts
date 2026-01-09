import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { formatKeyForDisplay, translateText } from "../../../../client/Utils";

@customElement("setting-keybind")
export class SettingKeybind extends LitElement {
  @property() label = "Setting";
  @property() description = "";
  @property({ type: String, reflect: true }) action = "";
  @property({ type: String }) defaultKey = "";
  @property({ type: String }) value = "";
  @property({ type: String }) display = "";
  @property({ type: Boolean }) easter = false;

  createRenderRoot() {
    return this;
  }

  private listening = false;

  render() {
    const currentValue = this.value === "" ? "" : this.value || this.defaultKey;
    const displayValue = this.display || currentValue;
    const rainbowClass = this.easter
      ? "bg-[linear-gradient(270deg,#990033,#996600,#336600,#008080,#1c3f99,#5e0099,#990033)] bg-[length:1400%_1400%] animate-rainbow-bg text-white hover:bg-[linear-gradient(270deg,#990033,#996600,#336600,#008080,#1c3f99,#5e0099,#990033)]"
      : "";

    return html`
      <div
        class="flex flex-row items-center justify-between w-full p-4 bg-white/5 border border-white/10 rounded-xl hover:bg-white/10 transition-all gap-4 ${rainbowClass}"
      >
        <div class="flex flex-col flex-1 min-w-0 mr-4">
          <label class="text-white font-bold text-base block mb-1"
            >${this.label}</label
          >
          <div class="text-white/50 text-sm leading-snug">
            ${this.description}
          </div>
        </div>

        <div class="flex items-center gap-3 shrink-0">
          <div
            class="relative h-12 min-w-[80px] px-4 flex items-center justify-center bg-black/40 border border-white/20 rounded-lg text-xl font-bold font-mono shadow-inner hover:border-blue-500 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/50 transition-all cursor-pointer select-none text-white
            ${this.listening
              ? "border-blue-500 text-blue-400 ring-2 ring-blue-500/50"
              : ""}"
            role="button"
            aria-label="${translateText("user_setting.press_a_key")}"
            tabindex="0"
            @keydown=${this.handleKeydown}
            @click=${this.startListening}
            @blur=${this.handleBlur}
          >
            ${this.listening ? "..." : this.displayKey(displayValue)}
          </div>

          <div class="flex flex-col gap-1">
            <button
              class="text-[10px] font-bold uppercase tracking-wider bg-white/5 hover:bg-white/20 border border-white/10 px-3 py-1 rounded text-white/60 hover:text-white transition-colors"
              @click=${this.resetToDefault}
            >
              ${translateText("user_setting.reset")}
            </button>
            <button
              class="text-[10px] font-bold uppercase tracking-wider bg-white/5 hover:bg-red-500/20 border border-white/10 hover:border-red-500/50 px-3 py-1 rounded text-white/60 hover:text-red-200 transition-colors"
              @click=${this.unbindKey}
            >
              ${translateText("user_setting.unbind")}
            </button>
          </div>
        </div>
      </div>
    `;
  }

  private displayKey(key: string): string {
    if (!key) return translateText("user_setting.press_a_key");
    return formatKeyForDisplay(key);
  }

  private startListening() {
    this.listening = true;
    this.requestUpdate();
  }

  private handleKeydown(e: KeyboardEvent) {
    if (!this.listening) return;

    // Allow Tab and Escape to work normally (don't trap focus)
    if (e.key === "Tab" || e.key === "Escape") {
      if (e.key === "Escape") {
        // Cancel listening on Escape
        this.listening = false;
        this.requestUpdate();
      }
      return;
    }

    // Prevent default only for keys we're actually capturing
    e.preventDefault();

    const code = e.code;
    const prevValue = this.value;

    // Temporarily set the value to the new code for validation in parent
    this.value = code;

    const event = new CustomEvent("change", {
      detail: { action: this.action, value: code, key: e.key, prevValue },
      bubbles: true,
      composed: true,
    });
    this.dispatchEvent(event);

    // If parent rejects (restores value), this.value will be set back externally
    // Otherwise, keep the new value
    this.listening = false;
    this.requestUpdate();
  }

  private handleBlur() {
    this.listening = false;
    this.requestUpdate();
  }

  private resetToDefault() {
    this.value = this.defaultKey;
    this.dispatchEvent(
      new CustomEvent("change", {
        detail: {
          action: this.action,
          value: this.defaultKey,
          key: this.defaultKey,
        },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private unbindKey() {
    this.value = "Null";
    this.dispatchEvent(
      new CustomEvent("change", {
        detail: {
          action: this.action,
          value: "Null",
          key: "",
        },
        bubbles: true,
        composed: true,
      }),
    );
    this.requestUpdate();
  }
}
