import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { translateText } from "../../../Utils";

@customElement("lobby-map-card")
export class LobbyMapCard extends LitElement {
  @property({ attribute: false }) imageSrc?: string | null;
  @property({ type: String }) name = "";
  @property({ attribute: "aria-selected" }) ariaSelected: string | null = null;

  createRenderRoot() {
    return this;
  }

  private handleKeydown(event: KeyboardEvent) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      (event.currentTarget as HTMLElement).click();
    }
  }

  private renderImage() {
    if (this.imageSrc === undefined) {
      return html`<div
        class="w-full aspect-[2/1] text-white/40 transition-transform duration-200 rounded-lg bg-black/20 text-xs font-bold uppercase tracking-wider flex items-center justify-center animate-pulse"
      >
        ${translateText("map_component.loading")}
      </div>`;
    }

    if (this.imageSrc === null) {
      return html`<div
        class="w-full aspect-[2/1] text-red-400 transition-transform duration-200 rounded-lg bg-red-500/10 text-xs font-bold uppercase tracking-wider flex items-center justify-center"
      >
        ${translateText("map_component.error")}
      </div>`;
    }

    return html`<div
      class="w-full aspect-[2/1] relative overflow-hidden rounded-lg bg-black/20"
    >
      <img
        src="${this.imageSrc}"
        alt="${this.name}"
        class="w-full h-full object-cover ${this.ariaSelected === "true"
          ? "opacity-100"
          : "opacity-80"} group-hover:opacity-100 transition-opacity duration-200"
      />
    </div>`;
  }

  render() {
    const isSelected = this.ariaSelected === "true";
    return html`
      <div
        role="button"
        tabindex="0"
        aria-selected="${isSelected}"
        aria-label="${this.name}"
        @keydown=${this.handleKeydown}
        class="w-full h-full p-3 flex flex-col items-center justify-between rounded-xl border cursor-pointer transition-all duration-200 gap-3 group ${isSelected
          ? "bg-blue-500/20 border-blue-500/50 shadow-[0_0_15px_rgba(59,130,246,0.3)]"
          : "bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20 hover:-translate-y-1 active:scale-95"}"
      >
        ${this.renderImage()}
        <slot></slot>
        <div
          class="text-xs font-bold text-white uppercase tracking-wider text-center leading-tight break-words hyphens-auto"
        >
          ${this.name}
        </div>
      </div>
    `;
  }
}
