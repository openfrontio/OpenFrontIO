import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
import { translateText } from "../../Utils";

@customElement("o-button")
export class OButton extends LitElement {
  @property({ type: String }) title = "";
  @property({ type: String }) translationKey = "";
  @property({ type: Boolean }) secondary = false;
  @property({ type: Boolean }) block = false;
  @property({ type: Boolean }) blockDesktop = false;
  @property({ type: Boolean }) disable = false;
  @property({ type: Boolean }) fill = false;
  private static readonly BASE_CLASS =
    "bg-blue-600 hover:bg-blue-700 text-white font-bold uppercase tracking-wider px-4 py-3 rounded-xl transition-all duration-300 transform hover:-translate-y-px outline-none border border-transparent text-center text-base lg:text-lg whitespace-normal break-words leading-tight overflow-hidden relative";

  createRenderRoot() {
    return this;
  }

  private getButtonClasses(): Record<string, boolean> {
    return {
      [OButton.BASE_CLASS]: true,
      "w-full block": this.block,
      "h-full w-full flex items-center justify-center": this.fill,
      "lg:w-auto lg:inline-block":
        !this.block && !this.blockDesktop && !this.fill,
      "lg:w-1/2 lg:mx-auto lg:block": this.blockDesktop,
      "bg-gray-700 text-gray-100 hover:bg-gray-600": this.secondary,
      "disabled:opacity-70 disabled:cursor-not-allowed disabled:transform-none disabled:bg-gray-600":
        this.disable,
    };
  }

  render() {
    return html`
      <button
        class=${classMap(this.getButtonClasses())}
        ?disabled=${this.disable}
      >
        <span class="block min-w-0">
          ${this.translationKey === ""
            ? this.title
            : translateText(this.translationKey)}
        </span>
      </button>
    `;
  }
}
