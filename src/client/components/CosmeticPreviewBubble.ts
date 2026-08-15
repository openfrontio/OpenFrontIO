import { html, LitElement, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { ResolvedCosmetic } from "../Cosmetics";
import { translateText } from "../Utils";

@customElement("cosmetic-preview-bubble")
export class CosmeticPreviewBubble extends LitElement {
  @property({ attribute: false })
  resolved!: ResolvedCosmetic;

  createRenderRoot() {
    return this;
  }

  private isPreviewable(): boolean {
    if (!this.resolved || this.resolved.cosmetic === null) return false;
    const type = this.resolved.type;
    // Flags, crowns, subscriptions, and currency packs are excluded from in-game preview
    if (
      type === "flag" ||
      type === "crown" ||
      type === "subscription" ||
      type === "pack"
    ) {
      return false;
    }
    return true;
  }

  private onBubbleClick(event: MouseEvent): void {
    event.stopPropagation();
    event.preventDefault();
    this.dispatchEvent(
      new CustomEvent("open-cosmetic-preview", {
        bubbles: true,
        composed: true,
        detail: this.resolved,
      }),
    );
  }

  render() {
    if (!this.isPreviewable()) {
      return nothing;
    }

    return html`<div
      data-cosmetic-preview-bubble
      class="group/preview-bubble absolute right-2 bottom-2 z-10"
      @click=${this.onBubbleClick}
    >
      <button
        type="button"
        aria-label=${translateText("store.preview_cosmetic")}
        title=${translateText("store.preview_cosmetic")}
        class="flex h-7 w-7 cursor-pointer items-center justify-center rounded-full bg-black/60 text-cyan-300 ring-1 ring-cyan-400/40 shadow-md shadow-black/60 transition-all duration-150 hover:scale-110 hover:bg-cyan-950/80 hover:text-cyan-200 hover:ring-cyan-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
      >
        <svg
          class="w-3.5 h-3.5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
          />
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
          />
        </svg>
      </button>
    </div>`;
  }
}
