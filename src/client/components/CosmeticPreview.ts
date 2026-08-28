import { html, LitElement, nothing, TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import {
  Crown,
  Effect,
  Flag,
  isNukeExplosionEffect,
  Pack,
  Pattern,
  Skin,
  Subscription,
} from "../../core/CosmeticSchemas";
import { PlayerPattern } from "../../core/Schemas";
import { ResolvedCosmetic } from "../Cosmetics";
import { translateText } from "../Utils";
import "./CapIcon";
import { cosmeticDisplayName } from "./CosmeticPresentation";
import "./EffectPreview";
import { renderPatternPreview } from "./PatternPreview";
import "./PlutoniumIcon";

@customElement("cosmetic-preview")
export class CosmeticPreview extends LitElement {
  @property({ attribute: false })
  resolved!: ResolvedCosmetic;

  @property({ type: String })
  size: "card" | "detail" = "card";

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    // CosmeticPreview is used inside flex/grid cards and also in the compact
    // inventory loadout. Make the light-DOM host participate in those layouts
    // so previews with no intrinsic size (trail/structure effects) still get a
    // real box to paint into.
    this.classList.add("block", "h-full", "w-full");
  }

  render() {
    return html`<div
      data-cosmetic-preview=${this.resolved.cosmetic === null
        ? "default"
        : this.resolved.type}
      class=${this.size === "detail"
        ? "h-full w-full"
        : // A subscription paints a wrapping list of perks, not artwork: a square
          // box cuts the last perk off once cards are phone-width.
          this.resolved.type === "subscription"
          ? "w-full"
          : "aspect-square w-full"}
    >
      ${this.renderResolvedPreview()}
    </div>`;
  }

  private renderResolvedPreview(): TemplateResult {
    if (this.resolved.type === "pattern") {
      const cosmetic = this.resolved.cosmetic;
      const playerPattern: PlayerPattern | null =
        cosmetic === null
          ? null
          : {
              name: cosmetic.name,
              patternData: (cosmetic as Pattern).pattern,
              colorPalette: this.resolved.colorPalette ?? undefined,
            };
      return renderPatternPreview(playerPattern, 150, 150);
    }

    if (this.resolved.type === "skin") {
      const cosmetic = this.resolved.cosmetic as Skin | null;
      if (cosmetic === null) {
        return this.renderDefaultPreview();
      }
      return html`<img
        src=${cosmetic.url}
        alt=${cosmeticDisplayName(this.resolved)}
        class="w-full h-full object-contain pointer-events-none"
        draggable="false"
        loading="lazy"
      />`;
    }

    if (this.resolved.type === "effect") {
      const cosmetic = this.resolved.cosmetic as Effect | null;
      if (cosmetic === null) {
        return this.renderDefaultPreview();
      }
      if (isNukeExplosionEffect(cosmetic)) {
        if (cosmetic.attributes.type === "sparkles") {
          return html`<sparkles-swatch
            class="block w-full h-full"
            .explosion=${cosmetic.attributes}
          ></sparkles-swatch>`;
        }
        return html`<shockwave-swatch
          class="block w-full h-full"
          .explosion=${cosmetic.attributes}
        ></shockwave-swatch>`;
      }
      return html`<effect-scene
        class="block w-full h-full"
        .effect=${cosmetic}
      ></effect-scene>`;
    }

    if (this.resolved.type === "crown") {
      const cosmetic = this.resolved.cosmetic as Crown | null;
      if (cosmetic === null) {
        return this.renderDefaultPreview();
      }
      return html`<img
        src=${cosmetic.url}
        alt=${cosmeticDisplayName(this.resolved)}
        class="w-full h-full object-contain pointer-events-none"
        draggable="false"
        loading="lazy"
      />`;
    }

    if (this.resolved.type === "pack") {
      const pack = this.resolved.cosmetic as Pack;
      const isHard = pack.currency === "hard";
      const icon = isHard
        ? html`<plutonium-icon
            class="block shrink-0"
            .size=${80}
          ></plutonium-icon>`
        : html`<cap-icon class="block shrink-0" .size=${80}></cap-icon>`;
      const colorClass = isHard ? "text-green-400" : "text-amber-700";
      const currencyKey = isHard ? "cosmetics.hard" : "cosmetics.soft";
      return html`<div
        class="relative flex h-full w-full flex-col items-center justify-center gap-0.5 overflow-visible text-center"
      >
        ${icon}
        <span class="text-lg font-black leading-none ${colorClass}"
          >${pack.amount.toLocaleString()}</span
        >
        <span class="text-[10px] font-bold leading-none text-white/50 uppercase"
          >${translateText(currencyKey)}</span
        >
        ${pack.bonusAmount > 0
          ? html`<div
              class="absolute top-8 -right-10 w-40 bg-green-500 text-white text-[10px] font-black py-0.5 rotate-45 shadow-md uppercase tracking-wide pointer-events-none"
            >
              ${translateText("cosmetics.free", {
                numFree: pack.bonusAmount.toLocaleString(),
              })}
            </div>`
          : nothing}
      </div>`;
    }

    if (this.resolved.type === "cosmeticPack") {
      return this.renderPackPreview(this.resolved.packItems ?? []);
    }

    if (this.resolved.type === "subscription") {
      const subscription = this.resolved.cosmetic as Subscription;
      return html`<div
        class="flex flex-col items-center justify-center h-full w-full text-center gap-2 p-1"
      >
        <div class="flex flex-col items-center gap-1 w-full">
          <div class="self-start flex items-center gap-1.5">
            <plutonium-icon .size=${24}></plutonium-icon>
            <span class="text-sm font-bold text-green-400"
              >${subscription.hardCurrencySignupBonus.toLocaleString()}</span
            >
            <span class="text-[10px] text-white/50 uppercase"
              >${translateText("cosmetics.signup_bonus")}</span
            >
          </div>
          <div class="self-start flex items-center gap-1.5">
            <plutonium-icon .size=${24}></plutonium-icon>
            <span class="text-sm font-bold text-green-400"
              >${subscription.dailyHardCurrency.toLocaleString()}</span
            >
            <span class="text-[10px] text-white/50 uppercase"
              >${translateText("cosmetics.per_day")}</span
            >
          </div>
          <span
            class="self-start text-left text-[10px] font-bold text-purple-300 uppercase tracking-wide"
            ><span class="text-green-400">✓</span> ${translateText(
              "cosmetics.verified_name",
            )}</span
          >
          ${subscription.unlimitedRanked
            ? html`<span
                class="self-start text-left text-[10px] font-bold text-purple-300 uppercase tracking-wide"
                ><span class="text-green-400">✓</span> ${translateText(
                  "cosmetics.unlimited_ranked",
                )}</span
              >`
            : nothing}
          ${subscription.canCreatePublicLobbies
            ? html`<span
                class="self-start text-left text-[10px] font-bold text-purple-300 uppercase tracking-wide"
                ><span class="text-green-400">✓</span> ${translateText(
                  "cosmetics.public_lobbies",
                )}</span
              >`
            : nothing}
        </div>
      </div>`;
    }

    const flag = this.resolved.cosmetic as Flag;
    return html`<img
      src=${flag.url}
      alt=${cosmeticDisplayName(this.resolved)}
      class="w-full h-full object-contain pointer-events-none"
      draggable="false"
      loading="lazy"
      @error=${(event: Event) => {
        const image = event.currentTarget as HTMLImageElement;
        const fallback = "/flags/xx.svg";
        if (image.src && !image.src.endsWith(fallback)) {
          image.src = fallback;
        }
      }}
    />`;
  }

  // Up to four of the pack's items tiled 2×2; more are summed up in a badge
  // (each tile is a live preview, so a big pack shouldn't paint them all).
  private renderPackPreview(
    items: readonly ResolvedCosmetic[],
  ): TemplateResult {
    const shown = items.slice(0, 4);
    const hidden = items.length - shown.length;
    return html`<div
      class="relative grid h-full w-full grid-cols-2 grid-rows-2 gap-1 overflow-hidden"
    >
      ${shown.map(
        (item) =>
          html`<div
            data-cosmetic-pack-item=${item.key}
            class="flex min-h-0 min-w-0 items-center justify-center overflow-hidden rounded bg-black/30 p-1"
          >
            <cosmetic-preview .resolved=${item} size="card"></cosmetic-preview>
          </div>`,
      )}
      ${hidden > 0
        ? html`<span
            class="absolute bottom-1 right-1 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-white"
            >${translateText("cosmetics.pack_more_items", {
              count: hidden,
            })}</span
          >`
        : nothing}
    </div>`;
  }

  private renderDefaultPreview(): TemplateResult {
    return html`<div
      class="w-full h-full flex items-center justify-center text-white/40 text-xs uppercase"
    >
      ${translateText("territory_patterns.pattern.default")}
    </div>`;
  }
}
