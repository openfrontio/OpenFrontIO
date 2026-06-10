import { html, LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";
import { translateText } from "../Utils";
import "./CapIcon";
import "./PlutoniumIcon";

@customElement("currency-display")
export class CurrencyDisplay extends LitElement {
  @property({ type: Number })
  hard: number = 0;

  @property({ type: Number })
  soft: number = 0;

  createRenderRoot() {
    return this;
  }

  render() {
    return html`
      <div class="flex gap-3 justify-center">
        <div
          class="flex items-center gap-1.5"
          title=${translateText("cosmetics.hard")}
        >
          <plutonium-icon .size=${16}></plutonium-icon>
          <span class="text-sm font-bold text-green-400"
            >${this.hard.toLocaleString()}</span
          >
        </div>
        <div
          class="flex items-center gap-1.5"
          title=${translateText("cosmetics.soft")}
        >
          <cap-icon .size=${20} style="margin-top:3px"></cap-icon>
          <span class="text-sm font-bold text-amber-700"
            >${this.soft.toLocaleString()}</span
          >
        </div>
      </div>
    `;
  }
}
