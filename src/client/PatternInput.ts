import { LitElement, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { Cosmetics } from "../core/CosmeticSchemas";
import { UserSettings } from "../core/game/UserSettings";
import { PlayerPattern } from "../core/Schemas";
import { renderPatternPreview } from "./components/PatternButton";
import { fetchCosmetics } from "./Cosmetics";
import { translateText } from "./Utils";
@customElement("pattern-input")
export class PatternInput extends LitElement {
  @state() public pattern: PlayerPattern | null = null;
  @state() public selectedColor: string | null = null;

  @property({ type: Boolean, attribute: "show-select-label" })
  public showSelectLabel: boolean = false;

  private userSettings = new UserSettings();
  private cosmetics: Cosmetics | null = null;

  private _onPatternSelected = () => {
    this.updateFromSettings();
  };

  private updateFromSettings() {
    this.selectedColor = this.userSettings.getSelectedColor() ?? null;

    if (this.cosmetics) {
      this.pattern = this.userSettings.getSelectedPatternName(this.cosmetics);
    } else {
      this.pattern = null;
    }
  }

  private onInputClick(e: Event) {
    e.preventDefault();
    e.stopPropagation();
    this.dispatchEvent(
      new CustomEvent("pattern-input-click", {
        bubbles: true,
        composed: true,
      }),
    );
  }

  async connectedCallback() {
    super.connectedCallback();
    this.cosmetics = await fetchCosmetics();
    this.updateFromSettings();
    window.addEventListener("pattern-selected", this._onPatternSelected);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("pattern-selected", this._onPatternSelected);
  }

  createRenderRoot() {
    return this;
  }

  render() {
    const isDefault = this.pattern === null && this.selectedColor === null;
    const showSelect = this.showSelectLabel && isDefault;
    const buttonTitle = translateText("territory_patterns.title");

    let previewContent;
    if (this.pattern) {
      previewContent = renderPatternPreview(this.pattern, 128, 128);
    } else {
      previewContent = renderPatternPreview(null, 128, 128);
    }

    return html`
      <button
        id="pattern-input_"
        class="pattern-btn m-0 border-0 w-full h-full flex cursor-pointer justify-center items-center focus:outline-none focus:ring-0 transition-all duration-200 hover:scale-105 bg-slate-900/80 hover:bg-slate-800/80 active:bg-slate-800/90 rounded-lg overflow-hidden"
        style="padding: 0 !important;"
        title=${buttonTitle}
        @click=${this.onInputClick}
      >
        <span
          class=${showSelect
            ? "hidden"
            : "w-full h-full overflow-hidden flex items-center justify-center [&>img]:object-cover [&>img]:w-full [&>img]:h-full"}
        >
          ${!showSelect ? previewContent : null}
        </span>
        ${showSelect
          ? html`<span
              class="text-[10px] font-black text-white/40 uppercase leading-none break-words w-full text-center px-1"
            >
              ${translateText("territory_patterns.select_skin")}
            </span>`
          : null}
      </button>
    `;
  }
}
