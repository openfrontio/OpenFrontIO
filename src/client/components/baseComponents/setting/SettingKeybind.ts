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
  private activeModifiers = new Set<string>();
  private comboModifiers: string[] = [];
  private pendingPrimary: { code: string } | null = null;
  private lastModifier: string | null = null;
  private ignoreClick = false;

  private static readonly MODIFIER_CODES = new Set([
    "ShiftLeft",
    "ShiftRight",
    "ControlLeft",
    "ControlRight",
    "AltLeft",
    "AltRight",
    "MetaLeft",
    "MetaRight",
  ]);
  private static readonly MODIFIER_ORDER = [
    "ControlLeft",
    "ControlRight",
    "ShiftLeft",
    "ShiftRight",
    "AltLeft",
    "AltRight",
    "MetaLeft",
    "MetaRight",
  ];

  render() {
    const currentValue = this.value === "" ? "" : this.value || this.defaultKey;
    const canReset = this.value !== undefined && this.value !== this.defaultKey;
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
            class="relative h-12 min-w-[80px] px-4 flex items-center justify-center bg-black/60 border border-white/20 rounded-lg text-xl font-bold font-mono shadow-inner hover:border-blue-500 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/50 transition-all cursor-pointer select-none text-white
            ${this.listening
              ? "border-blue-500 text-blue-400 ring-2 ring-blue-500/50"
              : ""}"
            role="button"
            aria-label="${translateText("user_setting.press_a_key")}"
            tabindex="0"
            @keydown=${this.handleKeydown}
            @keyup=${this.handleKeyup}
            @pointerup=${this.handlePointerUp}
            @wheel=${this.handleWheel}
            @click=${this.startListening}
            @blur=${this.handleBlur}
          >
            ${this.listening ? "..." : this.displayKey(displayValue)}
          </div>

          <div class="flex flex-col gap-1">
            <button
              class="text-[10px] font-bold uppercase tracking-wider bg-white/5 hover:bg-white/20 border border-white/10 px-3 py-1 rounded text-white/60 hover:text-white transition-colors ${canReset
                ? ""
                : "opacity-50 cursor-not-allowed pointer-events-none"}"
              @click=${this.resetToDefault}
              ?disabled=${!canReset}
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
    if (!key || key === "Null") return translateText("common.none");
    return formatKeyForDisplay(key);
  }

  private startListening() {
    if (this.ignoreClick) {
      this.ignoreClick = false;
      return;
    }
    this.listening = true;
    this.resetPendingState();
    this.requestUpdate();
  }

  private handleKeydown(e: KeyboardEvent) {
    if (!this.listening) return;
    if (e.repeat) return;

    // Allow Tab and Escape to work normally (don't trap focus)
    if (e.key === "Tab" || e.key === "Escape") {
      if (e.key === "Escape") {
        // Cancel listening on Escape
        this.listening = false;
        this.resetPendingState();
        this.requestUpdate();
      }
      return;
    }

    // Prevent default only for keys we're actually capturing
    e.preventDefault();

    const code = e.code;

    if (SettingKeybind.MODIFIER_CODES.has(code)) {
      this.activeModifiers.add(code);
      this.lastModifier = code;
      return;
    }

    this.pendingPrimary = { code };
    this.comboModifiers = Array.from(this.activeModifiers);
  }

  private handleKeyup(e: KeyboardEvent) {
    if (!this.listening) return;

    const code = e.code;
    if (SettingKeybind.MODIFIER_CODES.has(code)) {
      this.activeModifiers.delete(code);
      if (!this.pendingPrimary && this.activeModifiers.size === 0) {
        const value = this.lastModifier ?? code;
        this.commitKeybind(value, formatKeyForDisplay(value));
      }
      return;
    }

    if (this.pendingPrimary && code === this.pendingPrimary.code) {
      const modifiers = this.orderModifiers(this.comboModifiers);
      const value = this.buildComboValue(this.pendingPrimary.code, modifiers);
      const displayKey = this.buildComboLabel(
        this.pendingPrimary.code,
        modifiers,
      );
      this.commitKeybind(value, displayKey);
    }
  }

  private handlePointerUp(e: PointerEvent) {
    if (!this.listening) return;
    if (e.button !== 0 && e.button !== 1) return;

    e.preventDefault();

    const code = this.getPointerCode(e.button);
    if (!code) return;

    const modifiers = this.getPointerModifiers(e);
    if (code === "MouseLeft" && modifiers.length === 0) {
      return;
    }
    const value = this.buildComboValue(code, modifiers);
    const displayKey = this.buildComboLabel(code, modifiers);
    this.ignoreClick = true;
    this.commitKeybind(value, displayKey);
  }

  private handleWheel(e: WheelEvent) {
    if (!this.listening) return;
    const scrollValue = e.deltaY === 0 ? e.deltaX : e.deltaY;
    if (scrollValue === 0) return;

    e.preventDefault();

    const code = scrollValue > 0 ? "ScrollDown" : "ScrollUp";
    const modifiers = this.getWheelModifiers(e);
    const value = this.buildComboValue(code, modifiers);
    const displayKey = this.buildComboLabel(code, modifiers);
    this.commitKeybind(value, displayKey);
  }

  private handleBlur() {
    this.listening = false;
    this.resetPendingState();
    this.requestUpdate();
  }

  private resetToDefault() {
    this.value = this.defaultKey;
    this.dispatchEvent(
      new CustomEvent("change", {
        detail: {
          action: this.action,
          value: this.defaultKey,
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

  private commitKeybind(value: string, displayKey?: string) {
    const prevValue = this.value;
    this.value = value;
    this.dispatchEvent(
      new CustomEvent("change", {
        detail: {
          action: this.action,
          value,
          key: displayKey ?? value,
          prevValue,
        },
        bubbles: true,
        composed: true,
      }),
    );
    this.listening = false;
    this.resetPendingState();
    this.requestUpdate();
  }

  private resetPendingState() {
    this.activeModifiers.clear();
    this.comboModifiers = [];
    this.pendingPrimary = null;
    this.lastModifier = null;
  }

  private getPointerModifiers(e: PointerEvent): string[] {
    const modifiers = new Set(this.activeModifiers);

    if (e.ctrlKey) {
      modifiers.add("ControlLeft");
    }
    if (e.shiftKey) {
      modifiers.add("ShiftLeft");
    }
    if (e.altKey) {
      modifiers.add("AltLeft");
    }
    if (e.metaKey) {
      modifiers.add("MetaLeft");
    }

    return this.orderModifiers(Array.from(modifiers));
  }

  private getWheelModifiers(e: WheelEvent): string[] {
    const modifiers = new Set(this.activeModifiers);

    if (e.ctrlKey) {
      modifiers.add("ControlLeft");
    }
    if (e.shiftKey) {
      modifiers.add("ShiftLeft");
    }
    if (e.altKey) {
      modifiers.add("AltLeft");
    }
    if (e.metaKey) {
      modifiers.add("MetaLeft");
    }

    return this.orderModifiers(Array.from(modifiers));
  }

  private getPointerCode(button: number): string | null {
    if (button === 0) return "MouseLeft";
    if (button === 1) return "MouseMiddle";
    return null;
  }

  private orderModifiers(modifiers: string[]): string[] {
    return Array.from(new Set(modifiers)).sort(
      (a, b) =>
        SettingKeybind.MODIFIER_ORDER.indexOf(a) -
        SettingKeybind.MODIFIER_ORDER.indexOf(b),
    );
  }

  private buildComboValue(primary: string, modifiers: string[]): string {
    if (modifiers.length === 0) return primary;
    return `${modifiers.join("+")}+${primary}`;
  }

  private buildComboLabel(primary: string, modifiers: string[]): string {
    const displayModifiers = modifiers.map((modifier) =>
      formatKeyForDisplay(modifier),
    );
    const displayPrimary = formatKeyForDisplay(primary);
    if (displayModifiers.length === 0) return displayPrimary;
    return `${displayModifiers.join(" + ")} + ${displayPrimary}`;
  }
}
