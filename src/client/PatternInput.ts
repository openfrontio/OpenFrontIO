import { LitElement, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { Cosmetics } from "../core/CosmeticSchemas";
import { UserSettings } from "../core/game/UserSettings";
import { PlayerPattern } from "../core/Schemas";
import { renderPatternPreview } from "./components/PatternButton";
import { fetchCosmetics } from "./Cosmetics";
import { crazyGamesSDK } from "./CrazyGamesSDK";
import { translateText } from "./Utils";

@customElement("pattern-input")
export class PatternInput extends LitElement {
  @state() public pattern: PlayerPattern | null = null;
  @state() public selectedColor: string | null = null;
  @state() private isLoading: boolean = true;

  @property({ type: Boolean, attribute: "show-select-label" })
  public showSelectLabel: boolean = false;

  private userSettings = new UserSettings();
  private cosmetics: Cosmetics | null = null;
  private _abortController: AbortController | null = null;

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
    this._abortController = new AbortController();
    this.isLoading = true;
    const cosmetics = await fetchCosmetics();
    if (!this.isConnected) return;
    this.cosmetics = cosmetics;
    this.updateFromSettings();
    if (!this.isConnected) return;
    this.isLoading = false;
    window.addEventListener("pattern-selected", this._onPatternSelected, {
      signal: this._abortController.signal,
    });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._abortController) {
      this._abortController.abort();
      this._abortController = null;
    }
  }

  createRenderRoot() {
    return this;
  }

  render() {
    if (crazyGamesSDK.isOnCrazyGames()) {
      return html``;
    }

    const isDefault = this.pattern === null && this.selectedColor === null;
    const showSelect = this.showSelectLabel && isDefault;
    const buttonTitle = translateText("territory_patterns.title");

    // Show loading state
    if (this.isLoading) {
      return html`
        <button
          id="pattern-input"
          class="pattern-btn m-0 p-0 w-full h-full flex cursor-pointer justify-center items-center focus:outline-none focus:ring-0 bg-[linear-gradient(135deg,#1f3b57,#0f1f30)] rounded-lg overflow-hidden"
          disabled
        >
          <span
            class="w-6 h-6 border-4 border-blue-500/30 border-t-blue-500 rounded-full animate-spin"
          ></span>
        </button>
      `;
    }

    let previewContent;
    if (this.pattern) {
      previewContent = renderPatternPreview(this.pattern, 128, 128);
    } else {
      previewContent = renderPatternPreview(null, 128, 128);
    }

    return html`
      <button
        id="pattern-input"
        class="pattern-btn m-0 p-0 w-full h-full flex cursor-pointer justify-center items-center focus:outline-none focus:ring-0 transition-all duration-200 hover:scale-105 bg-[linear-gradient(135deg,#1f3b57,#0f1f30)] hover:brightness-[1.08] active:brightness-[0.95] rounded-lg overflow-hidden"
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
              class="text-[10px] font-black text-white uppercase leading-none break-words w-full text-center px-1"
            >
              ${translateText("territory_patterns.select_skin")}
            </span>`
          : null}
      </button>
    `;
  }
}
