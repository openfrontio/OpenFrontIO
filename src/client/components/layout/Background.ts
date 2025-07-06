import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";

@customElement("app-background")
export class Background extends LitElement {
  createRenderRoot() {
    return this;
  }
  render() {
    return html`
      <div class="absolute inset-0 z-[-1]">
        <div
          class="absolute inset-0 bg-cover bg-center"
          style="
            background-image: url('/images/background_globe.jpeg');
            filter: blur(4px) brightness(0.4);
            image-rendering: pixelated;
          "
        ></div>
        <div
          class="absolute inset-0 bg-gradient-to-b from-slate-900/80 via-slate-900/50 to-slate-900/80"
        ></div>
        <div class="absolute inset-0 bg-grid-tactical"></div>
      </div>
    `;
  }
}
