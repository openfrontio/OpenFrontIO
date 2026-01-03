import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";

@customElement("setting-placeholder")
export class SettingPlaceholder extends LitElement {
  @property({ type: String }) image = "";
  @property({ type: String }) alt = "";

  static styles = css`
    :host {
      display: block;
      width: 100%;
    }

    .placeholder-container {
      position: relative;
      width: 100%;
      border-radius: 10px;
      overflow: hidden;
      box-shadow: var(--setting-item-shadow, 0 2px 6px rgba(0, 0, 0, 0.4));
    }

    .placeholder-image {
      width: 100%;
      height: auto;
      display: block;
    }
  `;

  render() {
    if (!this.image) {
      return html``;
    }
    return html`
      <div class="placeholder-container">
        <img class="placeholder-image" src="${this.image}" alt="${this.alt}" />
      </div>
    `;
  }
}
