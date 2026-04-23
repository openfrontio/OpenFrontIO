import { html, LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";
import { assetUrl } from "../../core/AssetUrls";

const STYLE_ID = "plutonium-icon-styles";
if (!document.getElementById(STYLE_ID)) {
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    @keyframes plutonium-pulse {
      0%   { filter: drop-shadow(0 0 4px rgba(34,197,94,0.6)) drop-shadow(0 0 8px rgba(34,197,94,0.3)); scale: 1; }
      50%  { filter: drop-shadow(0 0 10px rgba(34,197,94,0.9)) drop-shadow(0 0 20px rgba(34,197,94,0.5)) drop-shadow(0 0 30px rgba(34,197,94,0.2)); scale: 1.04; }
      100% { filter: drop-shadow(0 0 4px rgba(34,197,94,0.6)) drop-shadow(0 0 8px rgba(34,197,94,0.3)); scale: 1; }
    }
    @keyframes plutonium-rotate {
      0%   { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
    @keyframes plutonium-jiggle {
      0%, 100% { translate: 0 0; }
      25%  { translate: -0.4px 0.3px; }
      50%  { translate: 0.3px -0.4px; }
      75%  { translate: -0.3px -0.3px; }
    }
  `;
  document.head.appendChild(style);
}

@customElement("plutonium-icon")
export class PlutoniumIcon extends LitElement {
  @property({ type: Number })
  size: number = 48;

  createRenderRoot() {
    return this;
  }

  render() {
    return html`
      <div
        class="inline-flex items-center justify-center"
        style="width:${this.size}px; height:${this
          .size}px; animation: plutonium-pulse 2s ease-in-out infinite, plutonium-jiggle 0.15s linear infinite;"
      >
        <img
          src=${assetUrl("images/PlutoniumIcon.svg")}
          alt="Plutonium"
          style="width:${this.size}px; height:${this
            .size}px; animation: plutonium-rotate 7s linear infinite;"
          draggable="false"
        />
      </div>
    `;
  }
}
