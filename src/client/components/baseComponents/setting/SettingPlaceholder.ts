import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";

@customElement("setting-placeholder")
export class SettingPlaceholder extends LitElement {
  @property({ type: String }) image = "";
  @property({ type: String }) alt = "Coming soon";

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
      filter: brightness(0.7);
    }

    .placeholder-overlay {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0, 0, 0, 0.3);
    }

    .placeholder-badge {
      background: rgba(255, 200, 0, 0.95);
      color: #000;
      padding: 10px 20px;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 600;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    }
  `;

  render() {
    return html`
      <div class="placeholder-container">
        <img class="placeholder-image" src="${this.image}" alt="${this.alt}" />
        <div class="placeholder-overlay">
          <div class="placeholder-badge">Cosmetics Module Required</div>
        </div>
      </div>
    `;
  }
}
