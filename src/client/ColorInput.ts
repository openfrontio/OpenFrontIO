import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { UserSettings } from "../core/game/UserSettings";

export const COLOR_MODE_CHANGED_EVENT = "color-mode-changed";

/**
 * A small button that sits next to the Skin/Pattern button on the main menu.
 * Clicking it cycles through color modes: Random → Custom → Team.
 * In "custom" mode a native color picker is also shown.
 */
@customElement("color-input")
export class ColorInput extends LitElement {
  @state() private mode: "random" | "custom" | "team" = "random";
  @state() private primaryColor = "#2196f3";

  private userSettings = new UserSettings();

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.mode = this.userSettings.colorMode();
    this.primaryColor = this.userSettings.customPrimaryColor();
  }

  private cycleMode() {
    const next: Record<string, "random" | "custom" | "team"> = {
      random: "custom",
      custom: "team",
      team: "random",
    };
    const newMode = next[this.mode];
    this.mode = newMode;
    this.userSettings.setColorMode(newMode);
    window.dispatchEvent(new CustomEvent(COLOR_MODE_CHANGED_EVENT));
  }

  private onColorChange(e: Event) {
    const color = (e.target as HTMLInputElement).value;
    this.primaryColor = color;
    this.userSettings.setCustomPrimaryColor(color);
    // Use a slightly darker shade as secondary color
    this.userSettings.setCustomSecondaryColor(color);
    window.dispatchEvent(new CustomEvent(COLOR_MODE_CHANGED_EVENT));
  }

  private modeLabel(): string {
    if (this.mode === "custom") return "Custom";
    if (this.mode === "team") return "Team";
    return "Random";
  }

  private modeIcon(): string {
    if (this.mode === "custom") return "🎨";
    if (this.mode === "team") return "🤝";
    return "🎲";
  }

  render() {
    return html`
      <div class="relative flex flex-col items-center gap-1 h-full">
        <!-- Main button — same style as pattern-input -->
        <button
          id="color-input-btn"
          title="Color Mode: ${this.modeLabel()} (click to change)"
          class="pattern-btn m-0 p-0 w-full h-full flex cursor-pointer flex-col justify-center items-center focus:outline-none focus:ring-0 transition-all duration-200 hover:scale-105 bg-surface hover:brightness-[1.08] active:brightness-[0.95] hover:shadow-[var(--shadow-action-card-hover)] rounded-lg overflow-hidden gap-1"
          @click=${this.cycleMode}
        >
          ${this.mode === "custom"
            ? html`
                <div
                  class="w-7 h-7 rounded-md border-2 border-white/30"
                  style="background:${this.primaryColor}"
                ></div>
                <span class="text-[7px] leading-tight font-black text-white uppercase">Custom</span>
              `
            : this.mode === "team"
            ? html`
                <span class="text-xl leading-none">🤝</span>
                <span class="text-[7px] leading-tight font-black text-white uppercase">Team</span>
              `
            : html`
                <span class="text-xl leading-none">🎲</span>
                <span class="text-[7px] leading-tight font-black text-white uppercase">Random</span>
              `}
        </button>

        <!-- Hidden native color picker — only shown in custom mode -->
        ${this.mode === "custom"
          ? html`
              <input
                type="color"
                id="color-input-picker"
                .value=${this.primaryColor}
                @input=${this.onColorChange}
                title="Pick your territory color"
                class="absolute bottom-0 left-0 w-full h-1 opacity-0 cursor-pointer"
                style="height:100%;top:0;"
              />
            `
          : ""}
      </div>
    `;
  }
}
