import { html, LitElement, nothing, TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { UserMeResponse } from "../../core/ApiSchemas";
import {
  Cosmetics,
  Effect,
  isNukeExplosionEffect,
} from "../../core/CosmeticSchemas";
import { PlayerCosmetics } from "../../core/Schemas";
import { getUserMe } from "../Api";
import {
  fetchCosmetics,
  resolveCosmetics,
  translateCosmetic,
} from "../Cosmetics";
import { translateText } from "../Utils";
import { storeRouteFor, WornCosmetic, wornCosmetics } from "../WornCosmetics";
import "./EffectPreview";
import { renderPatternPreview } from "./PatternPreview";

const rarityRing: Record<string, string> = {
  common: "ring-white/15",
  uncommon: "ring-green-400/50",
  rare: "ring-blue-400/50",
  epic: "ring-purple-300/50",
  legendary: "ring-orange-400/60",
};

/**
 * The cosmetics a player is wearing, as a row of small tiles under their name.
 * Tiles the viewer doesn't own link to that item in the store, opened in a new
 * tab so the running game is left alone.
 */
@customElement("worn-cosmetics-row")
export class WornCosmeticsRow extends LitElement {
  @property({ attribute: false })
  cosmetics: PlayerCosmetics = {};

  @state() private catalog: Cosmetics | null = null;
  @state() private userMe: UserMeResponse | false = false;

  createRenderRoot() {
    return this;
  }

  protected updated(): void {
    // Light DOM, so the host stays a flex item even when nothing renders and
    // would add a gap under the identity row for a player with no cosmetics.
    this.toggleAttribute("hidden", this.childElementCount === 0);
  }

  connectedCallback() {
    super.connectedCallback();
    void this.load();
  }

  private async load() {
    const [catalog, userMe] = await Promise.all([
      fetchCosmetics(),
      getUserMe(),
    ]);
    this.catalog = catalog;
    this.userMe = userMe;
  }

  private openStore(worn: WornCosmetic) {
    const route = storeRouteFor(worn);
    if (route === null) return;
    window.open(
      new URL(route, `${window.location.origin}/`).toString(),
      "_blank",
      "noopener",
    );
  }

  private displayName(worn: WornCosmetic): string {
    if (worn.type === "crown") return translateCosmetic("crowns", worn.name);
    if (worn.type === "effect") return translateCosmetic("effects", worn.name);
    return translateCosmetic("territory_patterns.pattern", worn.name);
  }

  private renderPreview(worn: WornCosmetic): TemplateResult {
    if (worn.pattern !== null) {
      return renderPatternPreview(worn.pattern, 48, 48);
    }
    if (worn.imageUrl !== null) {
      return html`<img
        src=${worn.imageUrl}
        alt=""
        class="h-full w-full object-contain pointer-events-none"
        draggable="false"
        loading="lazy"
      />`;
    }
    const effect = worn.resolved?.cosmetic as Effect | undefined;
    if (effect === undefined) {
      return html`<span class="text-xs font-bold text-white/40">?</span>`;
    }
    if (isNukeExplosionEffect(effect)) {
      return effect.attributes.type === "sparkles"
        ? html`<sparkles-swatch
            class="block h-full w-full"
            .explosion=${effect.attributes}
          ></sparkles-swatch>`
        : html`<shockwave-swatch
            class="block h-full w-full"
            .explosion=${effect.attributes}
          ></shockwave-swatch>`;
    }
    return html`<trail-swatch
      class="block h-full w-full"
      .trail=${effect.attributes}
    ></trail-swatch>`;
  }

  private renderTile(worn: WornCosmetic): TemplateResult {
    const name = this.displayName(worn);
    const buyable = storeRouteFor(worn) !== null;
    const rarity = worn.resolved?.cosmetic?.rarity ?? "";
    const ring = rarityRing[rarity] ?? "ring-white/15";
    const label = buyable
      ? translateText("player_panel.cosmetic_get_label", { name })
      : name;

    return html`
      <button
        type="button"
        class=${`relative h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-white/5 p-1 ring-1 ${ring}
          ${buyable ? "cursor-pointer transition hover:bg-white/10 active:scale-95" : "cursor-default"}`}
        title=${label}
        aria-label=${label}
        ?disabled=${!buyable}
        @click=${(e: Event) => {
          e.stopPropagation();
          this.openStore(worn);
        }}
      >
        ${this.renderPreview(worn)}
        ${buyable
          ? html`<span
              class="absolute bottom-0 right-0 rounded-tl bg-malibu-blue px-1 text-[10px] font-black leading-tight text-white"
              aria-hidden="true"
              >+</span
            >`
          : nothing}
      </button>
    `;
  }

  render() {
    const worn = wornCosmetics(
      this.cosmetics,
      resolveCosmetics(this.catalog, this.userMe, null),
    );
    if (worn.length === 0) return nothing;

    return html`
      <div class="flex items-center gap-2">
        <span
          class="text-xs font-semibold uppercase tracking-wider text-zinc-400"
        >
          ${translateText("player_panel.cosmetics")}
        </span>
        <div class="flex flex-wrap items-center gap-1.5">
          ${worn.map((w) => this.renderTile(w))}
        </div>
      </div>
    `;
  }
}
