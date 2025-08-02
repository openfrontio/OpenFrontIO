import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
import { translateText } from "../../Utils";

@customElement("o-button")
export class OButton extends LitElement {
  @property({ type: String }) title = "";
  @property({ type: String }) translationKey = "";
  @property({ type: String }) icon = "";
  @property({ type: Boolean }) secondary = false;
  @property({ type: Boolean }) block = false;
  @property({ type: Boolean }) blockDesktop = false;
  @property({ type: Boolean }) disable = false;

  createRenderRoot() {
    return this;
  }

  render() {
    return html`
      <button
        class=${classMap({
          "c-button": true,
          "c-button--block": this.block,
          "c-button--blockDesktop": this.blockDesktop,
          "c-button--secondary": this.secondary,
          "c-button--disabled": this.disable,
        })}
        ?disabled=${this.disable}
      >
        <div class="flex items-center justify-center">
          ${this.icon &&
          html`<img src="icons/${this.icon}" class="mr-2 h-5 w-5" />`}
          <span>
            ${`${this.translationKey}` === ""
              ? `${this.title}`
              : `${translateText(this.translationKey)}`}
          </span>
        </div>
      </button>
    `;
  }
}
