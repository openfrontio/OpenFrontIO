import { html, LitElement, nothing, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import { type ResolvedCosmetic, translateCosmetic } from "../../Cosmetics";
import { type PricedItem, type ShownPrice, shownPrice } from "../../ShownPrice";
import { translateText } from "../../Utils";
import "../CapIcon";
import {
  cosmeticDisplayName,
  cosmeticRarity,
  cosmeticRarityLabel,
} from "../CosmeticPresentation";
import "../CosmeticInfo";
import "../CosmeticPreview";
import "../CosmeticPreviewBubble";
import "../PlutoniumIcon";
import { type ItemState, unlockLabel } from "./ItemState";

/** The props a tile takes, for both Inventory tabs (the Player card tab
 * builds the same tiles for backgrounds and trackers). */
export interface InventoryItemTileProps {
  resolved: ResolvedCosmetic;
  state: ItemState;
  /** Colour variants of the same item (patterns); empty for none. */
  variants?: readonly ResolvedCosmetic[];
  activeVariantKey?: string | null;
  /** A free item (country flags): the footer says "Free" instead of Owned. */
  free?: boolean;
  /** Replaces the footer text, e.g. "In slot 2" on the Player card tab. */
  note?: string | null;
  /** Artwork; defaults to <cosmetic-preview>. */
  artwork?: TemplateResult | null;
  /** Opens a large preview: a button over the artwork's corner. */
  onPreview?: (() => void) | null;
  onActivate?: (resolved: ResolvedCosmetic) => void;
  onVariantActivate?: (resolved: ResolvedCosmetic) => void;
}

export const lockIcon = html`<svg
  aria-hidden="true"
  viewBox="0 0 16 16"
  class="h-3 w-3 shrink-0 fill-current"
>
  <path
    d="M4 7V5a4 4 0 1 1 8 0v2h.5A1.5 1.5 0 0 1 14 8.5v5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 13.5v-5A1.5 1.5 0 0 1 3.5 7H4Zm2 0h4V5a2 2 0 1 0-4 0v2Z"
  />
</svg>`;

let nextTileId = 0;

/** Rarity is the border colour, plus the rarity word at the top. */
const RARITY_BORDER: Record<string, string> = {
  common: "border-white/20",
  uncommon: "border-green-400/50",
  rare: "border-sky-400/50",
  epic: "border-purple-400/60",
  legendary: "border-orange-400/70",
  oneofone: "border-orange-400/70",
};

const RARITY_TEXT: Record<string, string> = {
  common: "text-white/60",
  uncommon: "text-green-300",
  rare: "text-sky-300",
  epic: "text-purple-300",
  legendary: "text-orange-300",
  oneofone: "text-orange-300",
};

/**
 * One item in an Inventory grid: rarity word, artwork, name and a text
 * footer that carries the item's state (see ItemState). The whole tile is
 * one button; what clicking does is the grid's call.
 */
@customElement("inventory-item-tile")
export class InventoryItemTile
  extends LitElement
  implements InventoryItemTileProps
{
  @property({ attribute: false }) resolved!: ResolvedCosmetic;
  @property({ type: String }) state: ItemState = "owned";
  @property({ attribute: false }) variants: readonly ResolvedCosmetic[] = [];
  @property({ type: String }) activeVariantKey: string | null = null;
  @property({ type: Boolean }) free = false;
  /** Changes when shown prices may have (a sale ended); prices are read
   * through shownPrice at render, so this only asks for a re-render. */
  @property({ type: Number }) priceEpoch = 0;
  @property({ type: String }) note: string | null = null;
  @property({ attribute: false }) artwork: TemplateResult | null = null;
  @property({ attribute: false }) onPreview: (() => void) | null = null;
  @property({ attribute: false })
  onActivate?: (resolved: ResolvedCosmetic) => void;
  @property({ attribute: false })
  onVariantActivate?: (resolved: ResolvedCosmetic) => void;

  /** Ids for the rarity and footer, which describe the tile's button. */
  private readonly tileId = `inventory-tile-${++nextTileId}`;

  createRenderRoot() {
    return this;
  }

  private get active(): ResolvedCosmetic {
    return (
      this.variants.find((item) => item.key === this.activeVariantKey) ??
      this.resolved
    );
  }

  updated() {
    this.dataset.itemState = this.state;
  }

  private renderPrice(currency: "hard" | "soft", shown: ShownPrice) {
    const isHard = currency === "hard";
    return html`<span
      data-tile-price=${currency}
      class="flex min-h-7 items-center justify-center gap-1 rounded-md border px-1.5 text-xs font-bold ${
        isHard
          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
          : "border-orange-500/40 bg-orange-500/10 text-orange-300"
      }"
    >
      ${
        isHard
          ? html`<plutonium-icon .size=${14}></plutonium-icon>`
          : html`<cap-icon .size=${14}></cap-icon>`
      }
      <span class="sr-only"
        >${translateText(
          isHard ? "inventory.price_hard" : "inventory.price_soft",
        )}</span
      >
      <span>${shown.price.toLocaleString()}</span>
      ${
        shown.listPrice !== null
          ? html`<s data-tile-list-price class="font-semibold opacity-60"
              ><span class="sr-only">${translateText("store.sale_was")} </span
              >${shown.listPrice.toLocaleString()}</s
            >`
          : nothing
      }
    </span>`;
  }

  private renderFooter(active: ResolvedCosmetic) {
    if (this.note) {
      // The note replaces the footer's words, never its state: an item in
      // use reads "✓ In slot 2" in the Equipped style.
      const style =
        this.state === "equipped"
          ? "bg-blue-600 text-white"
          : this.state === "unsaved"
            ? "border border-dashed border-white bg-black/30 text-white"
            : "bg-white/10 text-white/80";
      return html`<span
        data-tile-footer
        class="flex min-h-7 items-center justify-center gap-1 rounded-md px-2 text-center text-xs font-bold ${style}"
        >${
          this.state === "equipped"
            ? html`<span aria-hidden="true">✓</span>`
            : nothing
        }${this.note}</span
      >`;
    }
    switch (this.state) {
      case "equipped":
        return html`<span
          data-tile-footer
          class="flex min-h-7 items-center justify-center gap-1 rounded-md bg-blue-600 px-2 text-xs font-bold text-white"
          ><span aria-hidden="true">✓</span>${translateText(
            "inventory.equipped",
          )}</span
        >`;
      case "unsaved":
        return html`<span
          data-tile-footer
          class="flex min-h-7 items-center justify-center rounded-md border border-dashed border-white bg-black/30 px-2 text-xs font-bold text-white"
          >${translateText("inventory.state_unsaved")}</span
        >`;
      case "owned":
        return html`<span
          data-tile-footer
          class="flex min-h-7 items-center justify-center rounded-md bg-white/10 px-2 text-xs font-bold text-white/70"
          >${translateText(
            this.free ? "inventory.free" : "inventory.state_owned",
          )}</span
        >`;
      case "earned":
        return html`<span
          data-tile-footer
          data-tile-unlock
          class="flex min-h-7 items-center justify-center gap-1 rounded-md border border-dashed border-white/40 px-2 text-center text-xs font-semibold text-white/80"
          >${lockIcon}<span class="sr-only"
            >${translateText("inventory.earned_only")} </span
          >${unlockLabel(active) ?? ""}</span
        >`;
      case "forSale": {
        const priced = active.cosmetic as PricedItem | null;
        const hard = priced ? shownPrice(priced, "hard") : null;
        const soft = priced ? shownPrice(priced, "soft") : null;
        const saleLabel = hard?.saleLabel ?? soft?.saleLabel ?? null;
        return html`<span data-tile-footer class="flex flex-col gap-1">
          ${
            saleLabel
              ? html`<span
                  data-tile-sale-label
                  class="truncate text-center text-xs font-bold uppercase tracking-wide text-white"
                  >${saleLabel}</span
                >`
              : nothing
          }
          <span class="flex flex-wrap justify-center gap-1">
            ${hard ? this.renderPrice("hard", hard) : nothing}
            ${soft ? this.renderPrice("soft", soft) : nothing}
          </span>
        </span>`;
      }
    }
  }

  private renderSwatches() {
    // Every colour of the group, the pattern's own default look (no palette)
    // included, as the Store card shows them.
    const variants = this.variants.filter(
      (v) =>
        v.colorPalette !== null ||
        (v.type === "pattern" && v.cosmetic !== null),
    );
    if (variants.length < 2) return nothing;
    const activeKey = this.active.key;
    return html`<div
      data-tile-swatches
      class="-mt-1 flex flex-wrap justify-center pb-1"
    >
      ${variants.map((variant) => {
        const palette = variant.colorPalette;
        const label = palette
          ? translateCosmetic("territory_patterns.color_palette", palette.name)
          : translateText("territory_patterns.pattern.default");
        const primary = palette?.primaryColor ?? "#ffffff";
        const secondary = palette?.secondaryColor ?? "#000000";
        const isActive = variant.key === activeKey;
        return html`<button
          type="button"
          data-variant-key=${variant.key}
          title=${label}
          aria-label=${label}
          aria-pressed=${isActive ? "true" : "false"}
          class="flex h-11 w-11 items-center justify-center rounded-full"
          @click=${(event: Event) => {
            event.stopPropagation();
            this.onVariantActivate?.(variant);
          }}
        >
          <span
            aria-hidden="true"
            class="h-5 w-5 rounded-full border border-white/30 ${
              isActive ? "ring-2 ring-white" : ""
            }"
            style="background:${primary};box-shadow:inset -6px -6px 0 ${secondary}"
          ></span>
        </button>`;
      })}
    </div>`;
  }

  /**
   * The Store card's credits ("?": artist, AI disclosure) and 3D preview
   * buttons, over the artwork's corners. Outside the tile's own button, which
   * may not nest a control.
   */
  private renderExtras(active: ResolvedCosmetic) {
    if (this.onPreview) {
      const onPreview = this.onPreview;
      return html`<div
        data-tile-extras
        class="pointer-events-none absolute left-2.5 right-2.5 top-2.5 flex justify-end"
      >
        <button
          type="button"
          data-tile-preview
          aria-label=${translateText("inventory_card.preview", {
            name: cosmeticDisplayName(active),
          })}
          title=${translateText("inventory_card.preview", {
            name: cosmeticDisplayName(active),
          })}
          class="pointer-events-auto flex h-11 w-11 items-center justify-center rounded-lg border border-white/20 bg-black/60 text-white hover:bg-black/80 md:h-8 md:w-8"
          @click=${(event: Event) => {
            event.stopPropagation();
            onPreview();
          }}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 16 16"
            class="h-4 w-4 fill-current"
          >
            <path
              d="M2 2h5v2H4v3H2V2Zm7 0h5v5h-2V4H9V2ZM2 9h2v3h3v2H2V9Zm10 0h2v5H9v-2h3V9Z"
            />
          </svg>
        </button>
      </div>`;
    }
    if (active.cosmetic === null || this.artwork !== null) return nothing;
    const credits = active.cosmetic as {
      artist?: string;
      aiDisclosed?: boolean;
    };
    return html`<div
      data-tile-extras
      class="pointer-events-none absolute left-2.5 right-2.5 top-2.5 aspect-[4/3]"
    >
      <cosmetic-info
        .artist=${credits.artist}
        .aiDisclosed=${credits.aiDisclosed}
        .rarity=${cosmeticRarity(active)}
        .colorPalette=${active.colorPalette?.name}
      ></cosmetic-info>
      <cosmetic-preview-bubble
        class="pointer-events-auto"
        .resolved=${active}
      ></cosmetic-preview-bubble>
    </div>`;
  }

  render() {
    if (!this.resolved) return nothing;
    const active = this.active;
    const rarity = cosmeticRarity(active);
    const name = cosmeticDisplayName(active);
    const isEquipped = this.state === "equipped";
    return html`<div
      data-tile-shell
      data-tile-rarity-tier=${rarity}
      class="relative flex h-full flex-col rounded-xl border-2 bg-white/[0.03] ${
        RARITY_BORDER[rarity] ?? RARITY_BORDER.common
      } ${this.state === "unsaved" ? "outline-2 outline-dashed outline-white outline-offset-2" : ""}"
    >
      ${
        isEquipped
          ? html`<span
              data-tile-check
              aria-hidden="true"
              class="absolute -right-2 -top-2 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-xs font-black text-white ring-2 ring-slate-950"
              >✓</span
            >`
          : nothing
      }
      <button
        type="button"
        data-tile-main
        aria-label=${name}
        aria-describedby="${this.tileId}-rarity ${this.tileId}-state"
        aria-pressed=${isEquipped ? "true" : "false"}
        class="flex flex-1 flex-col gap-1.5 rounded-xl p-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
        @click=${() => this.onActivate?.(active)}
      >
        <div
          class="flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-lg bg-black/30 p-1"
        >
          ${
            this.artwork ??
            html`<cosmetic-preview .resolved=${active}></cosmetic-preview>`
          }
        </div>
        <span
          data-tile-rarity
          id="${this.tileId}-rarity"
          class="truncate text-[11px] font-black uppercase tracking-wider ${
            RARITY_TEXT[rarity] ?? RARITY_TEXT.common
          }"
          >${cosmeticRarityLabel(active)}</span
        >
        <span
          data-tile-name
          class="line-clamp-2 text-sm font-bold capitalize leading-tight text-white"
          >${name}</span
        >
        <span id="${this.tileId}-state" class="mt-auto"
          >${this.renderFooter(active)}</span
        >
      </button>
      ${this.renderExtras(active)} ${this.renderSwatches()}
    </div>`;
  }
}
