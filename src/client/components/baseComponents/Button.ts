import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
import { translateText } from "../../Utils";

@customElement("o-button")
export class OButton extends LitElement {
  @property({ type: String }) title = "";
  @property({ type: String }) translationKey = "";
  @property({ type: String }) imagePath = ""; // New property for the image path
  @property({ type: Boolean }) secondary = false;
  @property({ type: Boolean }) block = false;
  @property({ type: Boolean }) blockDesktop = false;
  @property({ type: Boolean }) disable = false;

  createRenderRoot() {
    return this;
  }

  render() {
    const buttonText = this.translationKey
      ? translateText(this.translationKey)
      : this.title;

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
        ${this.imagePath
          ? html`<img src="${this.imagePath}" width="24px" height="24px" class="c-button__icon" alt="" />`
          : ""}

        <span>${buttonText}</span>
      </button>
    `;
  }
}
