import { html, LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";
import { assetUrl } from "../../core/AssetUrls";

const STYLE_ID = "plutonium-icon-styles";
if (!document.getElementById(STYLE_ID)) {
  const style = document.createElement("style");
  style.id = STYLE_ID;
  // Only compositor-animatable properties (transform/opacity) may appear in
  // these keyframes: animating filter/drop-shadow here re-rasterizes every
  // icon each frame and forces the store's backdrop-blur surfaces to redraw,
  // which stutters the whole packs menu (see #4816 follow-up).
  style.textContent = `
    @keyframes plutonium-pulse {
      0%, 100% { opacity: 0.45; transform: scale(1); }
      50%      { opacity: 1;    transform: scale(1.12); }
    }
    @keyframes plutonium-rotate {
      0%   { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
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
        class="relative inline-flex items-center justify-center"
        style="width:${this.size}px; height:${this.size}px;"
      >
        <div
          style="position:absolute; inset:-25%; pointer-events:none; background:radial-gradient(circle, rgba(34,197,94,0.5) 0%, rgba(34,197,94,0.22) 40%, transparent 68%); animation: plutonium-pulse 2s ease-in-out infinite; will-change: transform, opacity;"
        ></div>
        <img
          src=${assetUrl("images/PlutoniumIcon.svg")}
          alt="Plutonium"
          style="position:relative; width:${this.size}px; height:${this
            .size}px; filter: drop-shadow(0 0 4px rgba(34,197,94,0.6)); animation: plutonium-rotate 7s linear infinite; will-change: transform;"
          draggable="false"
        />
      </div>
    `;
  }
}
