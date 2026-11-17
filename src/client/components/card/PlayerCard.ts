import { assetUrl } from "@openfront/shared/AssetUrls";
import { html, LitElement, nothing, TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import { translateText } from "../../Utils";
import { levelBadgeAccent } from "../LevelBadge";
import "./CardBackground";
import { formatTracker, type PlayerCardView } from "./PlayerCardModel";
import {
  clanTemplate,
  levelLineTemplate,
  nameTemplate,
} from "./ProfileIdentity";

// The player card: a thin banner strip with the player's level badge, flag,
// clan tag and name, prestige · level line, equipped title and up to three
// tracked stats, over their card background. Shown on the end screens (the
// player who eliminated you, the winner), as the Account page's header, and
// as a small preview in the store.
//
//   size "end"      652 × ~92 px on the end screens, 64 px badge
//   size "account"  the Account header, 96 px badge
//   size "thumb"    160 × 64 store / customiser preview: the background only
//
// Below 400 px wide (`narrow`, set from the strip's own width) the trackers
// move under the name as one line with short numbers.

export type PlayerCardSize = "end" | "account" | "thumb";

const NARROW_BELOW_PX = 400;

@customElement("player-card")
export class PlayerCard extends LitElement {
  @property({ attribute: false }) view: PlayerCardView | null = null;
  @property({ type: String }) size: PlayerCardSize = "end";
  // Set from the strip's width when ResizeObserver is available; a host may
  // also set it.
  @property({ type: Boolean }) narrow = false;
  // Whether the card's background may animate (one card per screen).
  @property({ type: Boolean }) animated = false;

  private resizeObserver: ResizeObserver | null = null;

  createRenderRoot() {
    return this;
  }

  connectedCallback(): void {
    super.connectedCallback();
    ensurePlayerCardStyles();
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver((entries) => {
        const width = entries[0]?.contentRect.width ?? 0;
        if (width > 0) this.narrow = width < NARROW_BELOW_PX;
      });
      this.resizeObserver.observe(this);
    }
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
  }

  private renderBadge(view: PlayerCardView): TemplateResult | typeof nothing {
    const badge = view.badge;
    if (badge === null) return nothing;
    const px = this.size === "account" ? 96 : 64;
    const accent = levelBadgeAccent(badge.prestige, badge.legend);
    return html`<div class="relative grid shrink-0 place-items-center">
      <div
        aria-hidden="true"
        class="absolute -inset-3 rounded-full"
        style="background: radial-gradient(circle, ${accent}55 0%, transparent 70%)"
      ></div>
      <level-badge
        class="relative"
        .level=${badge.level}
        .prestige=${badge.prestige}
        .legend=${badge.legend}
        .size=${px}
      ></level-badge>
    </div>`;
  }

  private renderTrackers(
    view: PlayerCardView,
  ): TemplateResult | typeof nothing {
    if (view.trackers.length === 0) return nothing;
    if (this.narrow) {
      return html`<div
        data-card-trackers-inline
        class="mt-0.5 flex flex-wrap gap-x-3 text-xs text-white/70"
      >
        ${view.trackers.map(
          (t) =>
            html`<span data-card-tracker=${t.stat}
              ><span class="font-black text-white tabular-nums"
                >${formatTracker(t.value, true)}</span
              >
              ${translateText(`player_card.tracker_${t.stat}`)}</span
            >`,
        )}
      </div>`;
    }
    return html`<div data-card-trackers class="flex shrink-0 items-stretch">
      ${view.trackers.map(
        (t, i) =>
          html`<div
            data-card-tracker=${t.stat}
            class="flex min-w-[4.5rem] flex-col items-center justify-center px-3 ${
              i > 0 ? "border-l border-white/15" : ""
            }"
          >
            <span
              class="font-black tabular-nums leading-none text-white ${
                this.size === "account" ? "text-2xl" : "text-xl"
              }"
              >${formatTracker(t.value, false)}</span
            >
            <span
              class="mt-1 text-[10px] font-bold uppercase tracking-wider text-white/55"
              >${translateText(`player_card.tracker_${t.stat}`)}</span
            >
          </div>`,
      )}
    </div>`;
  }

  render() {
    const view = this.view;
    if (view === null) return nothing;
    const rarity = view.background?.rarity ?? "common";
    const height =
      this.size === "thumb"
        ? "h-16 w-40"
        : this.size === "account"
          ? "min-h-[140px] w-full"
          : "min-h-[92px] w-full";
    if (this.size === "thumb") {
      return html`<section
        data-player-card="thumb"
        data-card-rarity=${rarity}
        class="player-card relative overflow-hidden rounded-lg border-2 ${height}"
      >
        <card-background .background=${view.background}></card-background>
      </section>`;
    }
    return html`<section
      data-player-card=${this.size}
      data-card-rarity=${rarity}
      class="player-card relative overflow-hidden rounded-xl border-2 text-white ${height}"
    >
      <card-background
        .background=${view.background}
        .animated=${this.animated}
      ></card-background>
      <div
        class="relative flex h-full items-center gap-4 ${
          this.size === "account" ? "px-6 py-5" : "px-4 py-3"
        }"
      >
        ${this.renderBadge(view)}
        <div class="min-w-0 flex-1">
          <div class="flex min-w-0 items-center gap-2">
            ${
              view.flag === undefined
                ? nothing
                : html`<img
                    data-card-flag
                    class="h-4 w-auto shrink-0 rounded-[2px]"
                    src=${assetUrl(view.flag)}
                    alt=""
                  />`
            }
            ${clanTemplate(view.clanTag, true)}
            ${nameTemplate(
              view.username,
              this.size === "account" ? "text-3xl" : "text-2xl",
            )}
          </div>
          ${view.badge === null ? nothing : levelLineTemplate(view.badge, true)}
          ${
            view.title === null
              ? nothing
              : html`<div
                  data-card-title
                  class="truncate text-sm font-bold"
                  style="color: ${view.title.accent ?? "#fbbf24"}"
                >
                  ${view.title.text}
                </div>`
          }
          ${this.narrow ? this.renderTrackers(view) : nothing}
        </div>
        ${this.narrow ? nothing : this.renderTrackers(view)}
      </div>
    </section>`;
  }
}

// The rarity borders, in the store's colours, plus the 1 of 1 treatment.
// Injected once, like the profile card's styles.
let stylesInjected = false;
function ensurePlayerCardStyles(): void {
  if (stylesInjected || typeof document === "undefined") return;
  stylesInjected = true;
  const style = document.createElement("style");
  style.textContent = `
    .player-card[data-card-rarity="common"] { border-color: rgba(255,255,255,0.15); }
    .player-card[data-card-rarity="uncommon"] { border-color: rgba(74,222,128,0.45); }
    .player-card[data-card-rarity="rare"] { border-color: rgba(96,165,250,0.5); }
    .player-card[data-card-rarity="epic"] { border-color: rgba(192,132,252,0.6); }
    .player-card[data-card-rarity="legendary"] { border-color: rgba(251,146,60,0.65); }
    .player-card[data-card-rarity="oneofone"] {
      border-color: rgba(253,224,71,0.85);
      box-shadow: 0 0 0 1px rgba(232,121,249,0.5), 0 0 18px rgba(253,224,71,0.25);
    }
  `;
  document.head.appendChild(style);
}
