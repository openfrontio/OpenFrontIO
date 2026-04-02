import { html, LitElement, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { translateText } from "../Utils";

@customElement("artist-info")
export class ArtistInfo extends LitElement {
  @property({ type: String })
  artist?: string;

  createRenderRoot() {
    return this;
  }

  render() {
    if (!this.artist) {
      return nothing;
    }

    return html`
      <div
        class="absolute -top-1 -right-1 z-10 group/artist"
        @click=${(e: Event) => e.stopPropagation()}
      >
        <div
          class="w-6 h-6 rounded-full bg-white/20 hover:bg-white/40 flex items-center justify-center cursor-help transition-colors duration-150"
        >
          <span class="text-xs font-bold text-white/70">?</span>
        </div>
        <div
          class="hidden group-hover/artist:block absolute top-7 right-0 bg-zinc-800 text-white text-xs px-2.5 py-1.5 rounded shadow-lg whitespace-nowrap z-20 border border-white/10"
        >
          ${translateText("cosmetics.artist_label")} ${this.artist}
        </div>
      </div>
    `;
  }
}
