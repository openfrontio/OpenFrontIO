import { html, LitElement, nothing, TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { UserMeResponse } from "../../core/ApiSchemas";
import {
  Cosmetics,
  Effect,
  EFFECT_TYPES,
  EffectType,
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

  private select(effectType: EffectType, name: string | null) {
    this.userSettings.setSelectedEffectName(effectType, name ?? undefined);
    // Stay rendered; the change event re-renders this grid and the home button.
    this.requestUpdate();
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

  private renderTile(
    effectType: EffectType,
    r: ResolvedCosmetic,
  ): TemplateResult {
    if (this.mode === "purchase") {
      return html`<cosmetic-button
        .resolved=${r}
        .onPurchase=${purchaseCosmetic}
      ></cosmetic-button>`;
    }
    const name = (r.cosmetic as Effect | null)?.name ?? null;
    const selected = this.userSettings.getSelectedEffectName(effectType);
    const isSelected =
      (name === null && selected === null) ||
      (name !== null && selected === name);
    return html`<cosmetic-button
      .resolved=${r}
      .selected=${isSelected}
      .onSelect=${() => this.select(effectType, name)}
    ></cosmetic-button>`;
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
    const sections = types
      .map((type) => ({ type, items: this.itemsForType(all, type) }))
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
                <div
                  class="flex flex-wrap gap-4 justify-center items-stretch content-start"
                >
                  ${s.items.map((r) => this.renderTile(s.type, r))}
                </div>
              </div>
            `,
          )}
        </div>
      `;
    }

    return this.tabbed ? html`${this.renderTabBar()}${panel}` : panel;
  }
}
