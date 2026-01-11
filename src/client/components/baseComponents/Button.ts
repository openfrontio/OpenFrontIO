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

  createRenderRoot() {
    return this;
  }

  render() {
    return html`
      <button
        class=${classMap({
          "text-white font-bold uppercase tracking-wider px-4 py-3 rounded-xl transition-all duration-300 transform hover:-translate-y-px outline-none border border-transparent text-center text-base lg:text-lg":
            true,
          "dark:bg-blue-500 dark:hover:bg-blue-600": true,
          "w-full block": this.block,
          "h-full w-full flex items-center justify-center": this.fill,
          "lg:w-auto lg:inline-block":
            !this.block && !this.blockDesktop && !this.fill,
          "lg:w-1/2 lg:mx-auto lg:block": this.blockDesktop,
          "bg-blue-100 text-gray-900 hover:bg-blue-200 dark:bg-gray-700 dark:text-gray-100 dark:hover:bg-gray-600":
            this.secondary,
          "disabled:opacity-70 disabled:cursor-not-allowed disabled:transform-none disabled:bg-gray-600 dark:disabled:bg-gray-600":
            this.disable,
        })}
        ?disabled=${this.disable}
      >
        ${`${this.translationKey}` === ""
          ? `${this.title}`
          : `${translateText(this.translationKey)}`}
      </button>
    `;
  }
}
