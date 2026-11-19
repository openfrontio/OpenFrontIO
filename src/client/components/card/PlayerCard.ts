import { assetUrl } from "@openfront/shared/AssetUrls";
import { html, LitElement, nothing, TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { prefersReducedMotion } from "../../utilities/ReducedMotion";
import { translateText } from "../../Utils";
import { levelBadgeAccent } from "../LevelBadge";
import "./CardBackground";
import { CARD_TAUNTS_ENABLED, CARD_TITLES_ENABLED } from "./HeldBack";
import { formatTracker, type PlayerCardView } from "./PlayerCardModel";
import {
  clanTemplate,
  levelLineTemplate,
  nameTemplate,
} from "./ProfileIdentity";
import {
  ensureTauntStyles,
  TAUNT_PRESETS,
  type TauntPreset,
  tauntPlayback,
} from "./taunts/TauntPresets";

// The player card: a thin banner strip with the player's level badge, flag,
// clan tag and name, prestige · level line, equipped title and up to three
// tracked stats, over their card background. Shown on the end screens (the
// player who eliminated you, the winner), as the Account page's header, and
// as a small preview in the store.
//
//   size "end"      652 × ~92 px on the end screens, 64 px badge
//   size "account"  the Account header, 96 px badge
//   size "thumb"    160 × 64 store / customiser preview: the background only
//   size "panel"    the in-game player panel: one strip, 28 px badge, then
//                   flag, clan tag and name over a small prestige · level
//                   line, then short trackers (value over label). Always still (never animated) and never a title or
//                   taunt: it sits beside a running game.
//
// Below 400 px wide (`narrow`, set from the strip's own width) the trackers
// move under the name as one line with short numbers.

export type PlayerCardSize = "end" | "account" | "thumb" | "panel";

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
  // Names one showing of the card: its taunt plays once per key (none: it
  // rests). The end screen passes the game and screen.
  @property({ type: String }) showKey: string | null = null;
  // The viewer's "Mute taunts": no taunt of either kind.
  @property({ type: Boolean }) tauntsMuted = false;
  // The card owner's territory colour, for the territory sweep.
  @property({ type: String }) territoryColor: string | null = null;

  // Whether the taunt is mid-animation, and the last showing it played for.
  @state() private tauntPlaying = false;
  private playedKey: string | null = null;

  private resizeObserver: ResizeObserver | null = null;

  createRenderRoot() {
    return this;
  }

  connectedCallback(): void {
    super.connectedCallback();
    ensurePlayerCardStyles();
    ensureTauntStyles();
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

  private preset(): TauntPreset | null {
    // Held back: a saved taunt never shows or plays.
    if (!CARD_TAUNTS_ENABLED) return null;
    if (this.size === "panel") return null;
    const taunt = this.view?.taunt;
    if (!taunt) return null;
    const preset = TAUNT_PRESETS[taunt.preset];
    return preset?.kind === taunt.tauntKind ? preset : null;
  }

  private playback(preset: TauntPreset) {
    return tauntPlayback(preset, {
      reducedMotion: prefersReducedMotion(),
      muted: this.tauntsMuted,
    });
  }

  protected willUpdate(): void {
    // A new showing starts the taunt, once.
    const key = this.showKey;
    if (key === null || key === this.playedKey) return;
    const preset = this.preset();
    if (preset === null || this.playback(preset) !== "play") return;
    this.playedKey = key;
    this.tauntPlaying = true;
    this.dispatchEvent(
      new CustomEvent("card-taunt-played", { bubbles: true, composed: true }),
    );
  }

  private onTauntEnd = (): void => {
    this.tauntPlaying = false;
  };

  private renderTauntIcon(
    view: PlayerCardView,
  ): TemplateResult | typeof nothing {
    const preset = this.preset();
    if (preset === null || preset.kind !== "icon") return nothing;
    if (this.playback(preset) === "none") return nothing;
    const animate = this.tauntPlaying && this.playback(preset) === "play";
    const flag = preset.restingFrame === "" ? view.flag : undefined;
    return html`<span
      data-card-taunt-icon
      class="inline-grid h-6 w-6 shrink-0 place-items-center text-lg leading-none ${
        animate ? preset.className : ""
      }"
      @animationend=${this.onTauntEnd}
      >${
        flag !== undefined
          ? html`<img class="h-4 w-auto" src=${assetUrl(flag)} alt="" />`
          : preset.restingFrame
      }</span
    >`;
  }

  private renderTauntOverlay(): TemplateResult | typeof nothing {
    const preset = this.preset();
    if (preset === null || preset.kind !== "card") return nothing;
    if (!this.tauntPlaying || this.playback(preset) !== "play") return nothing;
    const name = this.view!.taunt!.preset;
    const look: Record<string, string> = {
      nuke_flash:
        "inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-white to-transparent",
      shockwave:
        "left-8 top-1/2 h-16 w-16 -translate-y-1/2 rounded-full border-4 border-white/80",
      tremor: "inset-0",
      territory_sweep: "inset-0 origin-left",
      badge_pulse:
        "left-4 top-1/2 h-16 w-16 -translate-y-1/2 rounded-full bg-amber-200/60",
    };
    const style =
      name === "territory_sweep"
        ? `background: ${this.territoryColor ?? "#3b82f6"}`
        : "";
    return html`<div
      data-card-taunt-overlay
      aria-hidden="true"
      class="pointer-events-none absolute ${look[name] ?? "inset-0"} ${preset.className}"
      style=${style}
      @animationend=${this.onTauntEnd}
    ></div>`;
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

  // The panel strip: everything on one line, the name truncating first.
  private renderPanel(view: PlayerCardView, rarity: string): TemplateResult {
    const badge = view.badge;
    return html`<section
      data-player-card="panel"
      data-card-rarity=${rarity}
      class="player-card relative w-full overflow-hidden rounded-xl border-2 text-white"
    >
      <card-background
        .background=${view.background}
        .animated=${false}
      ></card-background>
      <div
        data-card-row
        class="relative flex min-h-[52px] items-center gap-1.5 px-3 py-2"
      >
        ${
          badge === null
            ? nothing
            : html`<level-badge
                class="shrink-0"
                .level=${badge.level}
                .prestige=${badge.prestige}
                .legend=${badge.legend}
                .size=${28}
              ></level-badge>`
        }
        <div class="min-w-0 flex-1">
          <div class="flex min-w-0 items-center gap-1.5">
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
            ${nameTemplate(view.username, "min-w-0 text-base")}
          </div>
          ${
            badge === null
              ? nothing
              : html`<div
                  class="truncate [&_[data-profile-level-line]]:truncate [&_[data-profile-level-line]]:text-[11px] [&_[data-profile-level-line]]:tracking-normal"
                >
                  ${levelLineTemplate(badge, true)}
                </div>`
          }
        </div>
        ${
          view.trackers.length === 0
            ? nothing
            : html`<div
                data-card-trackers-inline
                class="flex shrink-0 items-stretch"
              >
                ${view.trackers.map(
                  (t, i) =>
                    html`<div
                      data-card-tracker=${t.stat}
                      class="flex max-w-[4.5rem] flex-col items-center justify-center px-1 ${
                        i > 0 ? "border-l border-white/15" : ""
                      }"
                    >
                      <span
                        class="text-sm font-black leading-none text-white tabular-nums"
                        >${formatTracker(t.value, true)}</span
                      >
                      <span
                        class="mt-0.5 max-w-full truncate text-[11px] leading-tight text-white/60"
                        >${translateText(`player_card.tracker_${t.stat}`)}</span
                      >
                    </div>`,
                )}
              </div>`
        }
      </div>
    </section>`;
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
    if (this.size === "panel") return this.renderPanel(view, rarity);
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
      ${this.renderTauntOverlay()}
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
            ${this.renderTauntIcon(view)}
          </div>
          ${view.badge === null ? nothing : levelLineTemplate(view.badge, true)}
          ${
            view.title === null || !CARD_TITLES_ENABLED
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
    /* A block, so the ResizeObserver sees its width (an inline host reads 0
       and the phone layout never turns on). */
    player-card { display: block; }
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
