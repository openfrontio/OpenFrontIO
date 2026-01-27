import { LitElement, TemplateResult, html } from "lit";
import { customElement, property } from "lit/decorators.js";

@customElement("lobby-config-item")
export class LobbyConfigItem extends LitElement {
  @property({ type: String }) label = "";
  @property({ attribute: false }) value: string | TemplateResult = "";

  createRenderRoot() {
    return this;
  }

  render() {
    return html`
      <div
        class="bg-white/5 border border-white/10 rounded-lg p-3 flex flex-col items-center justify-center gap-1 text-center min-w-[100px]"
      >
        <span
          class="text-white/40 text-[10px] font-bold uppercase tracking-wider"
          >${this.label}</span
        >
        <span
          class="text-white font-bold text-sm w-full break-words hyphens-auto"
          >${this.value}</span
        >
      </div>
    `;
  }
}
