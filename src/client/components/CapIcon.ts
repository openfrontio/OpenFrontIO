import { html, LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";
import { assetUrl } from "../../core/AssetUrls";

@customElement("cap-icon")
export class CapIcon extends LitElement {
  @property({ type: Number })
  size: number = 48;

  createRenderRoot() {
    return this;
  }

  render() {
    return html`
      <div
        class="inline-flex items-center justify-center"
        style="width:${this.size}px; height:${this.size}px;"
      >
        <img
          src=${assetUrl("images/BottleCapIcon.svg")}
          alt="Caps"
          style="width:${this.size}px; height:${this.size}px;"
          draggable="false"
        />
      </div>
    `;
  }
}
