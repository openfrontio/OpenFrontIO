import { html, LitElement, nothing, PropertyValues, TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { UserMeResponse } from "../../core/ApiSchemas";
import {
  Cosmetics,
  Effect,
  EFFECT_TYPES,
  EffectType,
  isNukeExplosionEffect,
  NUKE_EXPLOSION_TYPES,
  NukeExplosionType,
} from "../../core/CosmeticSchemas";
import {
  EFFECTS_KEY,
  USER_SETTINGS_CHANGED_EVENT,
  UserSettings,
} from "../../core/game/UserSettings";
import {
  resolveCosmetics,
  ResolvedCosmetic,
  translateCosmetic,
} from "../Cosmetics";
import { translateText } from "../Utils";
import "./CosmeticCard";
import { cosmeticSelectionLabel } from "./CosmeticPresentation";

export interface EffectSlotSelection {
  effectType: EffectType;
  slot: string;
  resolved: ResolvedCosmetic | null;
}

/**
 * Renders effect cosmetics grouped by effectType, one sub-header per type.
 * Shared by the home selection modal and the Store's Effects tab.
 *
 * - mode="select": owned effects; clicking persists the selection to
 *   UserSettings and the Unequip action clears the active slot.
 * - mode="purchase": purchasable effects per type with the buy flow.
 * - effectType (optional): render only that one effectType and drop the
 *   sub-header (an outer tab already labels it). Unset = all types stacked.
 * - tabbed: render an internal tab bar (one tab per effectType) and show one
 *   type at a time. Used by the Store, whose own top-level tabs can't nest.
 */
@customElement("effects-grid")
export class EffectsGrid extends LitElement {
  @property({ attribute: false }) cosmetics: Cosmetics | null = null;
  @property({ attribute: false }) userMeResponse: UserMeResponse | false =
    false;
  @property({ type: String }) mode: "select" | "purchase" = "select";
  @property({ attribute: false }) affiliateCode: string | null = null;
  @property({ type: String }) search = "";
  // When set, render only this effectType and drop the sub-header.
  @property({ type: String }) effectType: EffectType | null = null;
  // Render an internal tab bar (one tab per effectType), one type at a time.
  @property({ type: Boolean }) tabbed = false;
  @property({ attribute: false })
  onActiveSlotChange?: (selection: EffectSlotSelection) => void;
  @property({ attribute: false })
  onPurchaseFocus?: (resolved: ResolvedCosmetic) => void;
  @property({ attribute: false })
  onVisiblePurchaseItemsChange?: (items: readonly ResolvedCosmetic[]) => void;
  @property({ attribute: false })
  renderPurchaseAction?: (resolved: ResolvedCosmetic) => TemplateResult;
  @property({ type: String }) focusedKey: string | null = null;
  @state() private activeType: EffectType = EFFECT_TYPES[0];
  // Active nuke-explosion sub-tab (atom / hydro / mirv); only shown for the
  // nukeExplosion effectType, which groups its effects by nukeType.
  @state() private activeNukeType: NukeExplosionType = NUKE_EXPLOSION_TYPES[0];

  private userSettings = new UserSettings();
  private renderedItems: ResolvedCosmetic[] = [];
  private _onChange = () => this.requestUpdate();

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener(
      `${USER_SETTINGS_CHANGED_EVENT}:${EFFECTS_KEY}`,
      this._onChange,
    );
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener(
      `${USER_SETTINGS_CHANGED_EVENT}:${EFFECTS_KEY}`,
      this._onChange,
    );
  }

  createRenderRoot() {
    return this;
  }

  // slot = effectType for trails, or the active nukeType for nuke explosions.
  private select(
    slot: string,
    name: string | null,
    selected?: ResolvedCosmetic,
  ) {
    this.userSettings.setSelectedEffectName(slot, name ?? undefined);
    // Unequip passes no cosmetic: nothing was selected, so say nothing.
    if (selected !== undefined) {
      window.dispatchEvent(
        new CustomEvent("show-message", {
          detail: {
            message: translateText("inventory.selected_cosmetic", {
              name: cosmeticSelectionLabel(selected),
            }),
            duration: 2000,
          },
        }),
      );
    }
    // Stay rendered; the change event re-renders this grid and the home button.
    this.requestUpdate();
  }

  private effectiveEffectType(): EffectType {
    return this.tabbed ? this.activeType : (this.effectType ?? this.activeType);
  }

  private activeSlot(): string {
    const type = this.effectiveEffectType();
    return type === "nukeExplosion" ? this.activeNukeType : type;
  }

  private resolvedItems(): ResolvedCosmetic[] {
    return resolveCosmetics(
      this.cosmetics,
      this.userMeResponse,
      this.affiliateCode,
    );
  }

  private emitActiveSlot(all: ResolvedCosmetic[] = this.resolvedItems()) {
    const effectType = this.effectiveEffectType();
    const slot = this.activeSlot();
    const selectedName = this.userSettings.getSelectedEffectName(slot);
    const resolved = selectedName
      ? (all.find(
          (item) =>
            item.type === "effect" &&
            item.effectType === effectType &&
            (item.cosmetic as Effect | null)?.name === selectedName &&
            this.slotForTile(effectType, item) === slot,
        ) ?? null)
      : null;
    this.onActiveSlotChange?.({
      effectType,
      slot,
      resolved,
    });
  }

  private selectEffectType(type: EffectType) {
    this.activeType = type;
    const all = this.resolvedItems();
    this.emitActiveSlot(all);
    this.emitVisiblePurchaseItems(all);
  }

  private selectNukeType(type: NukeExplosionType) {
    this.activeNukeType = type;
    const all = this.resolvedItems();
    this.emitActiveSlot(all);
    this.emitVisiblePurchaseItems(all);
  }

  // The selection slot for a tile: for nuke explosions the effect's own
  // nukeType (one selection per bomb type), else the effectType itself.
  private slotForTile(effectType: EffectType, r: ResolvedCosmetic): string {
    if (effectType !== "nukeExplosion") return effectType;
    return this.nukeTypeOf(r) ?? this.activeNukeType;
  }

  private matchesSearch(r: ResolvedCosmetic): boolean {
    const q = this.search.trim().toLowerCase();
    if (!q) return true;
    const name = (r.cosmetic as Effect | null)?.name;
    if (!name) return false;
    return (
      name.toLowerCase().includes(q) ||
      translateCosmetic("effects", name).toLowerCase().includes(q)
    );
  }

  private itemsForType(
    all: ResolvedCosmetic[],
    effectType: EffectType,
  ): ResolvedCosmetic[] {
    const ofType = all.filter(
      (r) =>
        r.type === "effect" &&
        r.cosmetic !== null &&
        r.effectType === effectType &&
        this.matchesSearch(r),
    );
    if (this.mode === "purchase") {
      return ofType.filter((r) => r.relationship === "purchasable");
    }
    return ofType.filter((r) => r.relationship === "owned");
  }

  private visiblePurchaseItems(all: ResolvedCosmetic[]): ResolvedCosmetic[] {
    const activeType = this.tabbed ? this.activeType : this.effectType;
    const types: readonly EffectType[] = activeType
      ? [activeType]
      : EFFECT_TYPES;
    return types.flatMap((type) => {
      const items = this.itemsForType(all, type);
      return type === "nukeExplosion"
        ? items.filter((item) => this.nukeTypeOf(item) === this.activeNukeType)
        : items;
    });
  }

  private emitVisiblePurchaseItems(all?: ResolvedCosmetic[]): void {
    if (this.mode !== "purchase") return;
    this.onVisiblePurchaseItemsChange?.(
      this.visiblePurchaseItems(all ?? this.resolvedItems()),
    );
  }

  protected updated(changed: PropertyValues<this>): void {
    if (
      changed.has("cosmetics") ||
      changed.has("userMeResponse") ||
      changed.has("affiliateCode") ||
      changed.has("mode") ||
      changed.has("search") ||
      changed.has("effectType") ||
      changed.has("tabbed")
    ) {
      this.emitVisiblePurchaseItems(this.renderedItems);
    }
  }

  private renderTile(slot: string, r: ResolvedCosmetic): TemplateResult {
    if (this.mode === "purchase") {
      return html`<cosmetic-card
        data-store-product
        class="block h-full min-w-0"
        .resolved=${r}
        state=${r.key === this.focusedKey ? "focused" : "idle"}
        .onActivate=${() => this.onPurchaseFocus?.(r)}
        .actionContent=${this.renderPurchaseAction?.(r) ?? nothing}
      ></cosmetic-card>`;
    }
    const name = (r.cosmetic as Effect | null)?.name ?? null;
    const selected = this.userSettings.getSelectedEffectName(slot);
    const isSelected =
      (name === null && selected === null) ||
      (name !== null && selected === name);
    return html`<cosmetic-card
      .resolved=${r}
      state=${isSelected ? "equipped" : "idle"}
      .onActivate=${() => this.select(slot, name, r)}
    ></cosmetic-card>`;
  }

  // The nukeType attribute of a nukeExplosion effect, else null (trail effects
  // and the Default tile have none).
  private nukeTypeOf(r: ResolvedCosmetic): string | null {
    const c = r.cosmetic as Effect | null;
    return c && isNukeExplosionEffect(c) ? c.attributes.nukeType : null;
  }

  // Secondary sub-tab bar for the nukeExplosion type: one pill per nukeType
  // (atom / hydro / mirv). Sits below the effectType label; always all three.
  private renderNukeTypeTabBar(): TemplateResult {
    return html`
      <div class="flex items-center justify-center gap-2 px-4 pt-3">
        ${NUKE_EXPLOSION_TYPES.map((nt) => {
          const active = this.activeNukeType === nt;
          return html`<button
            class="px-4 py-1.5 rounded-full text-xs font-black uppercase tracking-wider transition-colors ${active
              ? "bg-blue-600 text-white"
              : "bg-white/5 text-white/50 hover:text-white/80 hover:bg-white/10"}"
            @click=${() => this.selectNukeType(nt)}
          >
            ${translateText(`effects.nukeType.${nt}`)}
          </button>`;
        })}
      </div>
    `;
  }

  // Store's sub-tab bar: one tab per effectType, always present, styled like the
  // store's top-level tabs (blue active + underline).
  private renderTabBar(): TemplateResult {
    return html`
      <div
        class="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 border-b border-white/10 px-4 sm:flex-nowrap"
      >
        ${EFFECT_TYPES.map((type) => {
          const active = this.activeType === type;
          return html`<button
            class="-mb-px min-w-0 whitespace-nowrap border-b-2 px-4 py-3 text-sm font-bold uppercase tracking-wider transition-colors ${active
              ? "border-malibu-blue text-aquarius"
              : "border-transparent text-white/40 hover:text-white/70"}"
            @click=${() => this.selectEffectType(type)}
          >
            ${translateText(`effects.type.${type}`)}
          </button>`;
        })}
      </div>
    `;
  }

  private renderUnequip(): TemplateResult | typeof nothing {
    if (this.mode !== "select" || (!this.tabbed && this.effectType === null)) {
      return nothing;
    }
    const slot = this.activeSlot();
    const selected = this.userSettings.getSelectedEffectName(slot);
    return html`<div class="flex justify-end px-4 pt-3">
      <button
        type="button"
        data-effects-unequip
        ?disabled=${selected === null}
        class="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs font-black uppercase tracking-wider text-white transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
        @click=${() => this.select(slot, null)}
      >
        ${translateText("inventory.unequip")}
      </button>
    </div>`;
  }

  render() {
    const all = this.resolvedItems();
    this.renderedItems = all;
    // The active single type: the tab's selection (tabbed) or the effectType
    // prop; null = all types stacked with sub-headers.
    const activeType = this.tabbed ? this.activeType : this.effectType;
    const types: readonly EffectType[] = activeType
      ? [activeType]
      : EFFECT_TYPES;
    // nukeExplosion is split into per-nukeType sub-tabs: items are always
    // filtered to the active nukeType. The sub-tab bar renders at the top when
    // nukeExplosion is the single active type, else inside its section.
    const showNukeTabs = activeType === "nukeExplosion";
    const sections = types
      .map((type) => {
        let items = this.itemsForType(all, type);
        if (type === "nukeExplosion") {
          items = items.filter(
            (r) => this.nukeTypeOf(r) === this.activeNukeType,
          );
        }
        return { type, items };
      })
      .filter((s) => s.items.length > 0);

    let panel: TemplateResult;
    if (sections.length === 0) {
      // A single-type view names the type it is empty of ("…any Boat Trail
      // effects yet"), below this grid's own tab bar and Unequip control.
      panel =
        activeType && this.mode === "select"
          ? html`<p
              data-effects-empty=${activeType}
              class="px-4 pt-4 pb-8 text-center text-sm font-medium text-white/60"
            >
              ${translateText("inventory.no_owned_effects_of_type", {
                type: translateText(`effects.type.${activeType}`),
              })}
            </p>`
          : activeType
            ? html`<div class="p-4"></div>`
            : html`<div
                class="text-white/40 text-sm font-bold uppercase tracking-wider text-center py-8"
              >
                ${translateText("store.no_effects")}
              </div>`;
    } else {
      panel = html`
        <div class="flex flex-col gap-4 p-4">
          ${sections.map(
            (s) => html`
              <div class="flex flex-col">
                ${activeType
                  ? nothing
                  : html`<h3
                      class="text-white/70 text-sm font-black uppercase tracking-wider px-2 pb-2 mb-2 border-b border-white/10"
                    >
                      ${translateText(`effects.type.${s.type}`)}
                    </h3>`}
                ${!activeType && s.type === "nukeExplosion"
                  ? this.renderNukeTypeTabBar()
                  : nothing}
                <div
                  data-effects-items
                  class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
                >
                  ${s.items.map((r) =>
                    this.renderTile(this.slotForTile(s.type, r), r),
                  )}
                </div>
              </div>
            `,
          )}
        </div>
      `;
    }

    const nukeTabs = showNukeTabs ? this.renderNukeTypeTabBar() : nothing;
    const unequip = this.renderUnequip();
    return this.tabbed
      ? html`${this.renderTabBar()}${nukeTabs}${unequip}${panel}`
      : html`${nukeTabs}${unequip}${panel}`;
  }
}
