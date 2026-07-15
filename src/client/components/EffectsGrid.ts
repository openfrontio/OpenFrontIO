import { html, LitElement, nothing, TemplateResult } from "lit";
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
  purchaseCosmetic,
  resolveCosmetics,
  ResolvedCosmetic,
  translateCosmetic,
} from "../Cosmetics";
import { translateText } from "../Utils";
import "./CosmeticButton";

// "Default" (none) tile — selecting it clears the effect for that effectType.
function noneTile(effectType: EffectType): ResolvedCosmetic {
  return {
    type: "effect",
    cosmetic: null,
    colorPalette: null,
    relationship: "owned",
    key: `effect:none:${effectType}`,
    effectType,
  };
}

/**
 * Renders effect cosmetics grouped by effectType, one sub-header per type.
 * Shared by the home selection modal and the Store's Effects tab.
 *
 * - mode="select": owned effects + a Default tile per type; clicking persists
 *   the selection to UserSettings and re-renders.
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
  @state() private activeType: EffectType = EFFECT_TYPES[0];
  // Active nuke-explosion sub-tab (atom / hydro / mirv); only shown for the
  // nukeExplosion effectType, which groups its effects by nukeType.
  @state() private activeNukeType: NukeExplosionType = NUKE_EXPLOSION_TYPES[0];

  private userSettings = new UserSettings();
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
  private select(slot: string, name: string | null) {
    this.userSettings.setSelectedEffectName(slot, name ?? undefined);
    // Stay rendered; the change event re-renders this grid and the home button.
    this.requestUpdate();
  }

  // The selection slot for a tile: for nuke explosions the effect's own nukeType
  // (one selection per bomb type; the Default tile has none, so use the active
  // sub-tab), else the effectType itself.
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
    const owned = ofType.filter((r) => r.relationship === "owned");
    // The Default tile has no name to match — hide it while searching.
    return this.search.trim() ? owned : [noneTile(effectType), ...owned];
  }

  private renderTile(slot: string, r: ResolvedCosmetic): TemplateResult {
    if (this.mode === "purchase") {
      return html`<cosmetic-button
        .resolved=${r}
        .onPurchase=${purchaseCosmetic}
      ></cosmetic-button>`;
    }
    const name = (r.cosmetic as Effect | null)?.name ?? null;
    const selected = this.userSettings.getSelectedEffectName(slot);
    const isSelected =
      (name === null && selected === null) ||
      (name !== null && selected === name);
    return html`<cosmetic-button
      .resolved=${r}
      .selected=${isSelected}
      .onSelect=${() => this.select(slot, name)}
    ></cosmetic-button>`;
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
            @click=${() => (this.activeNukeType = nt)}
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
        class="flex items-center justify-center gap-6 border-b border-white/10 px-4"
      >
        ${EFFECT_TYPES.map((type) => {
          const active = this.activeType === type;
          return html`<button
            class="-mb-px border-b-2 px-2 py-3 text-sm font-black uppercase tracking-wider transition-colors ${active
              ? "border-blue-500 text-blue-400"
              : "border-transparent text-white/50 hover:text-white/80"}"
            @click=${() => (this.activeType = type)}
          >
            ${translateText(`effects.type.${type}`)}
          </button>`;
        })}
      </div>
    `;
  }

  render() {
    const all = resolveCosmetics(
      this.cosmetics,
      this.userMeResponse,
      this.affiliateCode,
    );
    // The active single type: the tab's selection (tabbed) or the effectType
    // prop; null = all types stacked with sub-headers.
    const activeType = this.tabbed ? this.activeType : this.effectType;
    const types: readonly EffectType[] = activeType
      ? [activeType]
      : EFFECT_TYPES;
    // nukeExplosion is split into per-nukeType sub-tabs: items are always
    // filtered to the active nukeType (keep the Default tile) so the Default
    // tile's slot matches what's on screen. The sub-tab bar renders at the top
    // when nukeExplosion is the single active type, else inside its section.
    const showNukeTabs = activeType === "nukeExplosion";
    const sections = types
      .map((type) => {
        let items = this.itemsForType(all, type);
        if (type === "nukeExplosion") {
          items = items.filter(
            (r) =>
              r.cosmetic === null || this.nukeTypeOf(r) === this.activeNukeType,
          );
        }
        return { type, items };
      })
      .filter((s) => s.items.length > 0);

    let panel: TemplateResult;
    if (sections.length === 0) {
      // A single-type view keeps its (empty) panel — the tab stays present and
      // just shows nothing. Only the all-types view shows the "no effects" notice.
      panel = activeType
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
                  class="flex flex-wrap gap-4 justify-center items-stretch content-start"
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
    return this.tabbed
      ? html`${this.renderTabBar()}${nukeTabs}${panel}`
      : html`${nukeTabs}${panel}`;
  }
}
