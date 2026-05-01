import { LitElement, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  PATTERN_KEY,
  USER_SETTINGS_CHANGED_EVENT,
} from "../core/game/UserSettings";
import { PlayerPattern } from "../core/Schemas";
import { renderPatternPreview } from "./components/PatternPreview";
import { getPlayerCosmetics } from "./Cosmetics";
import { crazyGamesSDK } from "./CrazyGamesSDK";
import { translateText } from "./Utils";

@customElement("pattern-input")
export class PatternInput extends LitElement {
  @state() public pattern: PlayerPattern | null = null;
  @state() public selectedColor: string | null = null;
  @state() private isLoading: boolean = true;

  @property({ type: Boolean, attribute: "show-select-label" })
  public showSelectLabel: boolean = false;

  @property({ type: Boolean, attribute: "adaptive-size" })
  public adaptiveSize: boolean = false;

  private _abortController: AbortController | null = null;

  private _onPatternSelected = async () => {
    const cosmetics = await getPlayerCosmetics();
    this.selectedColor = cosmetics.color?.color ?? null;
    this.pattern = cosmetics.pattern ?? null;
  };

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
    const cosmetics = await getPlayerCosmetics();
    this.selectedColor = cosmetics.color?.color ?? null;
    this.pattern = cosmetics.pattern ?? null;
    if (!this.isConnected) return;
    this.isLoading = false;
    window.addEventListener(
      `${USER_SETTINGS_CHANGED_EVENT}:${PATTERN_KEY}`,
      this._onPatternSelected,
      {
        signal: this._abortController.signal,
      },
    );
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

  private getIsDefaultPattern(): boolean {
    return this.pattern === null && this.selectedColor === null;
  }

  private shouldShowSelectLabel(): boolean {
    return this.showSelectLabel && this.getIsDefaultPattern();
  }

  private applyAdaptiveSize(): void {
    if (!this.adaptiveSize) {
      this.style.removeProperty("width");
      this.style.removeProperty("height");
      return;
    }

    const showSelect = this.showSelectLabel && this.getIsDefaultPattern();
    this.style.setProperty("height", "2.5rem");
    this.style.setProperty(
      "width",
      showSelect ? "clamp(3.25rem, 14vw, 4.75rem)" : "2.5rem",
    );
  }

  protected updated(): void {
    this.applyAdaptiveSize();
  }

  render() {
    if (crazyGamesSDK.isOnCrazyGames()) {
      return html``;
    }

    const showSelect = this.shouldShowSelectLabel();
    const buttonTitle = translateText("territory_patterns.title");

    // Show loading state
    if (this.isLoading) {
      return html`
        <button
          id="pattern-input"
          class="pattern-btn m-0 p-0 w-full h-full flex cursor-pointer justify-center items-center focus:outline-none focus:ring-0 bg-surface rounded-lg overflow-hidden"
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
        class="pattern-btn m-0 p-0 w-full h-full flex cursor-pointer justify-center items-center focus:outline-none focus:ring-0 transition-all duration-200 hover:scale-105 bg-surface hover:brightness-[1.08] active:brightness-[0.95] rounded-lg overflow-hidden"
        title=${buttonTitle}
        @click=${this.onInputClick}
      >
        <span
          class=${showSelect
            ? "hidden"
            : "w-full h-full overflow-hidden flex items-center justify-center [&>img]:object-cover [&>img]:w-full [&>img]:h-full [&>img]:pointer-events-none"}
        >
          ${!showSelect ? previewContent : null}
        </span>
        ${showSelect
          ? html`<span
              class="${this.adaptiveSize
                ? "text-[7px] leading-tight px-0.5"
                : "text-[10px] leading-none break-words px-1"} font-black text-white uppercase w-full text-center"
            >
              ${translateText("territory_patterns.select_skin")}
            </span>`
          : null}
      </button>
    `;
  }
}
