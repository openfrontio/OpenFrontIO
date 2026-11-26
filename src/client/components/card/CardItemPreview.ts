import { html, LitElement, nothing, type PropertyValues } from "lit";
import { customElement, property } from "lit/decorators.js";
import { translateText } from "../../Utils";
import { type CardItem, type CardItemType, cardItemName } from "./CardItems";
import "./PlayerCard";
import type { PlayerCardView } from "./PlayerCardModel";

const RARITY_TEXT: Record<string, string> = {
  common: "text-white/60",
  uncommon: "text-green-300",
  rare: "text-sky-300",
  epic: "text-purple-300",
  legendary: "text-orange-300",
};

/**
 * A large preview of a card item (a background, a tracker, the card
 * itself) on a full-size, animated card: the Inventory's Player card tab
 * and the Store's Card tab open it from a tile's preview. Escape, the close
 * button or the backdrop close it; focus moves in and goes back to what
 * opened it.
 */
@customElement("card-item-preview")
export class CardItemPreview extends LitElement {
  @property({ attribute: false }) entry: {
    type: CardItemType;
    item: CardItem;
  } | null = null;
  /** The card to show, with the item on it. */
  @property({ attribute: false }) view: PlayerCardView | null = null;
  /** A line under the card, e.g. that tracker values are samples. */
  @property({ type: String }) note = "";
  @property({ attribute: false }) onClose?: () => void;

  private returnFocusTo: HTMLElement | null = null;

  createRenderRoot() {
    return this;
  }

  connectedCallback(): void {
    super.connectedCallback();
    const active = document.activeElement;
    this.returnFocusTo =
      active instanceof HTMLElement && active !== document.body ? active : null;
    window.addEventListener("keydown", this.onKeyDown, { capture: true });
  }

  disconnectedCallback(): void {
    window.removeEventListener("keydown", this.onKeyDown, { capture: true });
    super.disconnectedCallback();
    if (this.returnFocusTo?.isConnected) this.returnFocusTo.focus();
    this.returnFocusTo = null;
  }

  protected firstUpdated(changed: PropertyValues): void {
    super.firstUpdated(changed);
    this.querySelector<HTMLElement>("[data-card-preview-close]")?.focus();
  }

  // Capture phase: Escape closes this, never a modal behind it.
  private onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Tab") {
      const items = [
        ...this.querySelectorAll<HTMLElement>(
          "[role='dialog'] button:not([disabled])",
        ),
      ];
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      const inside = active instanceof HTMLElement && this.contains(active);
      if (event.shiftKey && (active === first || !inside)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !inside)) {
        event.preventDefault();
        first.focus();
      }
      return;
    }
    if (event.key !== "Escape") return;
    event.stopPropagation();
    event.preventDefault();
    this.onClose?.();
  };

  render() {
    const entry = this.entry;
    if (entry === null || this.view === null) return nothing;
    const name = cardItemName(entry.type, entry.item);
    const rarity = String(entry.item.rarity);
    return html`<div
      class="fixed inset-0 z-[10000] flex items-center justify-center p-4"
    >
      <div
        data-card-preview-backdrop
        class="absolute inset-0 bg-black/80"
        @click=${() => this.onClose?.()}
      ></div>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="card-item-preview-title"
        class="relative flex w-full max-w-4xl flex-col gap-4 rounded-2xl border border-white/10 bg-slate-900 p-4 text-white shadow-2xl sm:p-6"
      >
        <div class="flex items-start justify-between gap-3">
          <div class="flex min-w-0 flex-col">
            <span
              class="text-[11px] font-black uppercase tracking-wider ${
                RARITY_TEXT[rarity] ?? RARITY_TEXT.common
              }"
              >${translateText(`cosmetics.${rarity}`)} ·
              ${translateText(`win_modal.loadout_type_${entry.type}`)}</span
            >
            <h2
              id="card-item-preview-title"
              class="truncate text-xl font-black text-white"
            >
              ${name}
            </h2>
          </div>
          <button
            type="button"
            data-card-preview-close
            aria-label=${translateText("inventory_card.preview_close")}
            class="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-white/15 bg-white/5 text-lg font-bold text-white hover:bg-white/10"
            @click=${() => this.onClose?.()}
          >
            <span aria-hidden="true">✕</span>
          </button>
        </div>
        <player-card
          size="account"
          animated
          class="block w-full"
          .view=${this.view}
        ></player-card>
        ${
          this.note
            ? html`<p class="text-xs text-white/60">${this.note}</p>`
            : nothing
        }
      </div>
    </div>`;
  }
}
