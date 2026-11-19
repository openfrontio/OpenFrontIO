import { html, LitElement, nothing, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { ResolvedCosmetic } from "../../Cosmetics";
import { translateText } from "../../Utils";
import { cosmeticDisplayName } from "../CosmeticPresentation";
import "../CosmeticPreview";
import type { InventoryCategory } from "../InventoryLoadoutBar";

export interface YourLookSlot {
  category: Exclude<InventoryCategory, "effects">;
  label: string;
  item: ResolvedCosmetic | null;
}

export interface YourLookEffect {
  slot: string;
  item: ResolvedCosmetic | null;
}

/**
 * The In game tab's left column: what's on now (Skin, Flag, Crown, Effects),
 * the device loadout controls, and a link to the Player card tab. Each slot
 * opens its grid on the right. Hidden on phones, where the slot strip
 * (<inventory-loadout-bar>) takes its place.
 */
@customElement("inventory-your-look")
export class InventoryYourLook extends LitElement {
  @property({ attribute: false }) slots: readonly YourLookSlot[] = [];
  @property({ attribute: false }) effects: readonly YourLookEffect[] = [];
  @property({ type: String }) activeCategory: InventoryCategory = "skins";
  @property({ attribute: false }) loadout: TemplateResult | null = null;
  @property({ attribute: false })
  onSelect?: (category: InventoryCategory) => void;
  @property({ attribute: false }) onOpenCard?: () => void;
  /** The player's card background, for the link's thumbnail. */
  @property({ type: String }) cardThumbnail: string | null = null;

  createRenderRoot() {
    return this;
  }

  private renderSlot(
    category: InventoryCategory,
    label: string,
    value: string,
    art: TemplateResult,
    extra: TemplateResult | typeof nothing = nothing,
  ) {
    const active = category === this.activeCategory;
    return html`<button
      type="button"
      data-your-look-slot=${category}
      aria-pressed=${active ? "true" : "false"}
      class="flex min-h-14 w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors ${
        active
          ? "border-blue-400/70 bg-blue-500/15"
          : "border-transparent hover:bg-white/5"
      }"
      @click=${() => this.onSelect?.(category)}
    >
      <span
        class="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-md bg-black/40 p-1"
        >${art}</span
      >
      <span class="flex min-w-0 flex-col">
        <span
          class="text-[11px] font-black uppercase tracking-wider text-white/50"
          >${label}</span
        >
        <span
          data-your-look-value=${category}
          class="text-sm font-bold leading-tight text-white"
          >${value}</span
        >
        ${extra}
      </span>
    </button>`;
  }

  private renderEffects() {
    const custom = this.effects.filter((e) => e.item !== null).length;
    const defaults = this.effects.length - custom;
    const first = this.effects.find((e) => e.item !== null)?.item ?? null;
    return this.renderSlot(
      "effects",
      translateText("inventory.slot_effects"),
      translateText("inventory.effects_summary", { custom, defaults }),
      first
        ? html`<cosmetic-preview .resolved=${first}></cosmetic-preview>`
        : html``,
      html`<span class="mt-1 flex flex-wrap gap-1" aria-hidden="true">
        ${this.effects.map((effect) =>
          effect.item
            ? html`<span
                data-your-look-effect-swatch="custom"
                class="h-5 w-5 overflow-hidden rounded border border-white/30 bg-black/40"
                ><cosmetic-preview .resolved=${effect.item}></cosmetic-preview
              ></span>`
            : html`<span
                data-your-look-effect-swatch="default"
                class="h-5 w-5 rounded border border-white/15 bg-white/5 opacity-40"
              ></span>`,
        )}
      </span>`,
    );
  }

  render() {
    return html`<aside
      data-your-look
      aria-label=${translateText("inventory.your_look")}
      class="flex flex-col gap-1"
    >
      <h2
        class="px-1 pb-1 text-xs font-black uppercase tracking-wider text-white/60"
      >
        ${translateText("inventory.your_look")}
      </h2>
      ${this.slots.map((slot) =>
        this.renderSlot(
          slot.category,
          slot.label,
          slot.item
            ? cosmeticDisplayName(slot.item)
            : translateText("inventory.effect_default"),
          slot.item
            ? html`<cosmetic-preview .resolved=${slot.item}></cosmetic-preview>`
            : html``,
        ),
      )}
      ${this.renderEffects()}
      <div class="mt-3 border-t border-white/10 pt-3">${this.loadout}</div>
      <button
        type="button"
        data-your-look-card-link
        class="mt-3 flex min-h-11 items-center gap-3 rounded-lg px-2 text-sm font-bold text-white/80 hover:bg-white/5 hover:text-white"
        @click=${() => this.onOpenCard?.()}
      >
        <span
          aria-hidden="true"
          data-your-look-card-thumb
          class="h-6 w-12 shrink-0 rounded border border-white/20 bg-slate-700 bg-cover bg-center"
          style=${
            this.cardThumbnail
              ? `background-image:url(${JSON.stringify(this.cardThumbnail)})`
              : nothing
          }
        ></span>
        <span class="flex-1 text-left"
          >${translateText("inventory.player_card_link")}</span
        >
        <span aria-hidden="true">→</span>
      </button>
    </aside>`;
  }
}
