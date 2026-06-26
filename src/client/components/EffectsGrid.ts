import { html, LitElement, TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
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
  };
}

/**
 * Renders effect cosmetics grouped by effectType, one sub-header per type.
 * Shared by the home selection modal and the Store's Effects tab.
 *
 * - mode="select": owned effects + a Default tile per type; clicking persists
 *   the selection to UserSettings and re-renders.
 * - mode="purchase": purchasable effects per type with the buy flow.
 */
@customElement("effects-grid")
export class EffectsGrid extends LitElement {
  @property({ attribute: false }) cosmetics: Cosmetics | null = null;
  @property({ attribute: false }) userMeResponse: UserMeResponse | false =
    false;
  @property({ type: String }) mode: "select" | "purchase" = "select";
  @property({ attribute: false }) affiliateCode: string | null = null;

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

  private itemsForType(
    all: ResolvedCosmetic[],
    effectType: EffectType,
  ): ResolvedCosmetic[] {
    const ofType = all.filter(
      (r) =>
        r.type === "effect" &&
        r.cosmetic !== null &&
        (r.cosmetic as Effect).effectType === effectType,
    );
    if (this.mode === "purchase") {
      return ofType.filter((r) => r.relationship === "purchasable");
    }
    return [
      noneTile(effectType),
      ...ofType.filter((r) => r.relationship === "owned"),
    ];
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

  render() {
    const all = resolveCosmetics(
      this.cosmetics,
      this.userMeResponse,
      this.affiliateCode,
    );
    const sections = EFFECT_TYPES.map((type) => ({
      type,
      items: this.itemsForType(all, type),
    })).filter((s) => s.items.length > 0);

    if (sections.length === 0) {
      return html`<div
        class="text-white/40 text-sm font-bold uppercase tracking-wider text-center py-8"
      >
        ${translateText("store.no_effects")}
      </div>`;
    }

    return html`
      <div class="flex flex-col gap-4 p-4">
        ${sections.map(
          (s) => html`
            <div class="flex flex-col">
              <h3
                class="text-white/70 text-sm font-black uppercase tracking-wider px-2 pb-2 mb-2 border-b border-white/10"
              >
                ${translateText(`effects.type.${s.type}`)}
              </h3>
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
}
