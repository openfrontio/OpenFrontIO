import {
  html,
  LitElement,
  nothing,
  PropertyValues,
  svg,
  SVGTemplateResult,
  TemplateResult,
} from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { clampPrestige, levelFraction } from "../Progression";
import { translateText } from "../Utils";
import { prefersReducedMotion } from "./Ceremony";
import "./LevelBadge";
import { levelBadgeAccent } from "./LevelBadge";
import { formatXp, xpProgressText } from "./XpBar";

// The level side of a player, at a glance: their badge, name and clan, the
// level line and the XP bar. The same look a shared profile link unfurls with
// (the API renders that one as an image), so a player recognises it.
//
// `full` heads a Stats tab (yours and public profiles): a big badge, and the
// lifetime XP. Games and wins are left to the stats right under it, so
// nothing shows twice. `compact` is one row, for the account page.
//
// The full card opens with a flourish, once per opening of the page it's on
// (`openKey`; not again on a tab switch): the badge settles in, the XP bar
// fills, a sheen crosses the card and a pulse of light runs out from behind
// the badge through the card's own hex pattern. A Legend's card is edged and
// patterned in gold, its pulse is gold and comes back gently for a while.

export interface ProfileCardProgress {
  prestige: number;
  level: number;
  legend: boolean;
  lifetimeXp: number;
  // Missing when the source doesn't say (an older public endpoint): the XP
  // bar is left out then.
  xpInLevel?: number;
  xpForNext?: number;
  // At level 100 with ranks left: the Prestige button shows on your own card.
  canPrestige?: boolean;
}

// Segments the XP bar is drawn in, as on the end-of-game screen.
const BAR_SEGMENTS = 10;

// The pulses' bands, as wide as their brightest part reaches past the ring.
const BLUE_BAND = 90;
const GOLD_BAND = 110;
// The pulses' final animations: when they end, the layer goes.
const BLUE_PULSE_END = "profile-card-pulse-fade";
const GOLD_PULSE_END = "profile-card-gold-ring";

// Each card names its own hex pattern: a shared id would resolve to the
// first card in the document, which may sit in a hidden page (Chrome draws no
// pattern from a display:none subtree).
let nextPatternId = 0;

// The pages that already played their opening flourish, by openKey.
const playedOpenKeys = new Set<string>();

function isEmbedded(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

// Whether the opening flourish may play at all: never under reduced motion,
// on a hidden page, or inside another site's frame (CrazyGames and the like).
function flourishAllowed(): boolean {
  return (
    !prefersReducedMotion() &&
    document.visibilityState !== "hidden" &&
    !isEmbedded()
  );
}

interface Pulse {
  kind: "blue" | "gold";
  // Where it starts (the badge's middle), in the card's own pixels, and how
  // far it runs (to the farthest corner, and its band past it).
  cx: number;
  cy: number;
  reach: number;
}

@customElement("profile-card")
export class ProfileCard extends LitElement {
  private readonly patternId = `profile-card-hex-${nextPatternId++}`;
  @property({ type: String }) variant: "full" | "compact" = "full";
  @property({ type: String }) username = "";
  @property({ attribute: false }) clanTag: string | null = null;
  // Null when progression is off: nothing renders.
  @property({ attribute: false }) progress: ProfileCardProgress | null = null;
  // Your own card: offers Prestige when you can. Emits `prestige-request`.
  @property({ type: Boolean }) prestigeable = false;
  // Names one opening of the page the card is on: the flourish plays once per
  // key, however often the card is rendered again (a tab switch builds a new
  // one). Without a key it plays once per card.
  @property({ attribute: false }) openKey: string | undefined = undefined;

  @state() private intro = false;
  @state() private pulse: Pulse | null = null;
  private introDecided = false;
  private pulseMeasured = false;

  createRenderRoot() {
    return this;
  }

  connectedCallback(): void {
    super.connectedCallback();
    ensureProfileCardStyles();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.stopPulse();
  }

  private get compact(): boolean {
    return this.variant === "compact";
  }

  protected willUpdate(changed: PropertyValues<this>): void {
    super.willUpdate(changed);
    // Decided before the first paint with a progress, so the badge never
    // shows once and then jumps into its entrance.
    if (this.introDecided || this.compact || this.progress === null) return;
    this.introDecided = true;
    const key = this.openKey;
    if (key !== undefined) {
      if (playedOpenKeys.has(key)) return;
      playedOpenKeys.add(key);
    }
    this.intro = flourishAllowed();
  }

  protected updated(changed: PropertyValues<this>): void {
    super.updated(changed);
    if (!this.intro || this.pulseMeasured) return;
    this.pulseMeasured = true;
    void this.startPulse();
  }

  // Measures where the pulse starts (the badge's middle) and how far it runs,
  // once the badge has drawn itself at its size, then starts it.
  private async startPulse(): Promise<void> {
    const card = this.querySelector<HTMLElement>('[data-profile-card="full"]');
    if (card === null) return;
    const badgeEl = card.querySelector<LitElement>("level-badge");
    await badgeEl?.updateComplete;
    if (!this.isConnected || !this.intro) return;
    const box = card.getBoundingClientRect();
    // Not laid out (a hidden page): no pulse.
    if (box.width === 0 || box.height === 0) return;
    // In the card's own pixels: the modal around it may still be scaling in.
    const scale = card.offsetWidth > 0 ? card.offsetWidth / box.width : 1;
    const width = box.width * scale;
    const height = box.height * scale;
    const badge = badgeEl?.getBoundingClientRect();
    const origin = badge && badge.width > 0 ? badge : box;
    const cx = (origin.left + origin.width / 2 - box.left) * scale;
    const cy = (origin.top + origin.height / 2 - box.top) * scale;
    const far = Math.max(
      Math.hypot(cx, cy),
      Math.hypot(width - cx, cy),
      Math.hypot(cx, height - cy),
      Math.hypot(width - cx, height - cy),
    );
    const kind = this.progress?.legend ? "gold" : "blue";
    this.pulse = {
      kind,
      cx: Math.round(cx),
      cy: Math.round(cy),
      reach: Math.round(far + (kind === "gold" ? GOLD_BAND : BLUE_BAND)),
    };
    document.addEventListener("visibilitychange", this.onVisibilityChange);
  }

  // A hidden page drops the pulse: it would only play on, unseen.
  private onVisibilityChange = (): void => {
    if (document.visibilityState === "hidden") this.stopPulse();
  };

  private stopPulse(): void {
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
    this.pulse = null;
  }

  // The layer's last animation ending (the names are its own).
  private onPulseEnd = (e: AnimationEvent): void => {
    const end = this.pulse?.kind === "gold" ? GOLD_PULSE_END : BLUE_PULSE_END;
    if (e.animationName === end) this.stopPulse();
  };

  // "PRESTIGE 3 · LEVEL 47", "LEVEL 47", or "LEGEND · PRESTIGE 10".
  private renderLevelLine(progress: ProfileCardProgress): TemplateResult {
    const size = this.compact
      ? "text-sm tracking-wider"
      : "text-lg tracking-widest sm:text-xl";
    const prestige = clampPrestige(progress.prestige);
    if (progress.legend) {
      return html`<div
        data-profile-level-line
        class="bg-gradient-to-r from-yellow-300 via-fuchsia-300 to-yellow-300 bg-clip-text font-black uppercase text-transparent ${size}"
      >
        ${translateText("progression.legend")}
        <span class="text-white/40">·</span>
        ${translateText("progression.prestige", { prestige })}
      </div>`;
    }
    return html`<div
      data-profile-level-line
      class="font-black uppercase text-white ${size}"
    >
      ${prestige > 0
        ? html`<span class="text-yellow-300"
              >${translateText("progression.prestige", { prestige })}</span
            >
            <span class="text-white/30">·</span>`
        : nothing}
      ${translateText("progression.level", { level: progress.level })}
    </div>`;
  }

  private renderBar(fill: number): TemplateResult {
    return html`<div
      data-xp-bar
      class="relative w-full overflow-hidden rounded-sm bg-white/15 ${this
        .compact
        ? "h-2"
        : "h-3"}"
      role="progressbar"
      aria-valuemin="0"
      aria-valuemax="100"
      aria-valuenow=${Math.round(fill * 100)}
    >
      <div
        data-xp-bar-fill
        class="h-full bg-yellow-400 shadow-[0_0_10px_rgba(250,204,21,0.6)]"
        style="width: ${fill * 100}%"
      ></div>
      ${Array.from(
        { length: BAR_SEGMENTS - 1 },
        (_, i) =>
          html`<span
            aria-hidden="true"
            class="absolute top-0 h-full w-[2px] -translate-x-1/2 bg-[#0b1424]"
            style="left: ${((i + 1) * 100) / BAR_SEGMENTS}%"
          ></span>`,
      )}
    </div>`;
  }

  // The XP bar, with the lifetime XP on the left under it (full only) and
  // the progress through the level on the right.
  private renderXp(progress: ProfileCardProgress): TemplateResult {
    const { xpInLevel, xpForNext } = progress;
    const hasBar = xpInLevel !== undefined && xpForNext !== undefined;
    const fill = progress.legend
      ? 1
      : levelFraction(xpInLevel ?? 0, xpForNext ?? 0);
    const lifetime = this.compact
      ? nothing
      : html`<div data-profile-lifetime class="truncate">
          <span
            class="text-[10px] font-bold uppercase tracking-wider text-blue-200/55"
            >${translateText("profile_card.lifetime_xp")}</span
          >
          <span class="ml-1 font-black tabular-nums text-yellow-300"
            >${formatXp(progress.lifetimeXp)}</span
          >
        </div>`;
    return html`<div class=${this.compact ? "mt-1.5" : "mt-3"}>
      ${hasBar ? this.renderBar(fill) : nothing}
      <div
        class="mt-1 flex items-baseline justify-between gap-3 text-xs ${this
          .compact
          ? "justify-end"
          : ""}"
      >
        ${lifetime}
        ${hasBar
          ? html`<div
              data-profile-xp
              class="shrink-0 font-semibold tabular-nums text-white/55"
            >
              ${xpProgressText(xpInLevel, progress.legend ? 0 : xpForNext)}
            </div>`
          : nothing}
      </div>
    </div>`;
  }

  // The compact card's progress: the XP figure over the bar, as one block of
  // a fixed width, so the bar doesn't stretch across the whole card.
  private renderCompactXp(
    progress: ProfileCardProgress,
  ): TemplateResult | typeof nothing {
    const { xpInLevel, xpForNext } = progress;
    if (xpInLevel === undefined || xpForNext === undefined) return nothing;
    const fill = progress.legend ? 1 : levelFraction(xpInLevel, xpForNext);
    return html`<div class="w-full shrink-0 sm:w-64">
      <div
        data-profile-xp
        class="mb-1.5 text-right text-xs font-semibold tabular-nums text-white/60"
      >
        ${xpProgressText(xpInLevel, progress.legend ? 0 : xpForNext)}
      </div>
      ${this.renderBar(fill)}
    </div>`;
  }

  private canPrestige(progress: ProfileCardProgress): boolean {
    return this.prestigeable && progress.canPrestige === true;
  }

  private renderPrestigeButton(): TemplateResult {
    return html`<button
      type="button"
      data-profile-prestige
      class="profile-prestige-button rounded-xl border border-yellow-300/70 bg-gradient-to-b from-yellow-300 to-amber-500 px-6 py-2.5 text-sm font-black uppercase tracking-widest text-zinc-900 transition-transform hover:-translate-y-0.5"
      @click=${() =>
        this.dispatchEvent(
          new CustomEvent("prestige-request", {
            bubbles: true,
            composed: true,
          }),
        )}
    >
      ${translateText("prestige.button")}
    </button>`;
  }

  // The hex pattern behind the card: teal, or gold on a Legend's full card.
  // `pulse` draws the brighter copy the opening pulse lights up.
  private renderPattern(
    id: string,
    paths: SVGTemplateResult,
    extra: { className: string; style?: string },
  ): TemplateResult {
    return html`<svg
      aria-hidden="true"
      class="pointer-events-none absolute inset-0 h-full w-full ${extra.className}"
      style=${extra.style ?? nothing}
    >
      <defs>
        <pattern
          id=${id}
          width="60"
          height="103.92"
          patternUnits="userSpaceOnUse"
        >
          ${paths}
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#${id})"></rect>
    </svg>`;
  }

  private hexPath(
    stroke: string,
    opacity: number,
    width: number,
  ): SVGTemplateResult {
    // svg``, not html``: a fragment on its own is parsed as HTML, which
    // would make an HTML element named "path" that draws nothing.
    return svg`<path
      d="M30 0 L60 17.32 L60 51.96 L30 69.28 L0 51.96 L0 17.32 Z M30 69.28 L30 103.92"
      fill="none"
      stroke=${stroke}
      stroke-opacity=${opacity}
      stroke-width=${width}
    ></path>`;
  }

  private renderBackground(gold: boolean): TemplateResult {
    return this.renderPattern(
      this.patternId,
      gold
        ? this.hexPath("#facc15", 0.075, 1.5)
        : this.hexPath("#2dd4bf", 0.07, 1.5),
      { className: "" },
    );
  }

  // The opening pulse: a second, brighter copy of the card's hex pattern,
  // seen only through a ring-shaped mask that grows out from behind the
  // badge. Drawn once; only the mask's radius (a registered custom property)
  // animates. Blue rings twice and goes; a Legend's gold ring comes back
  // every few seconds for about half a minute.
  private renderPulse(pulse: Pulse): TemplateResult {
    const paths =
      pulse.kind === "gold"
        ? svg`${this.hexPath("#f59e0b", 0.25, 6)}${this.hexPath(
            "#fde68a",
            0.8,
            1.8,
          )}`
        : this.hexPath("#7dd3fc", 0.75, 2);
    const svgTemplate = this.renderPattern(`${this.patternId}-pulse`, paths, {
      className: `profile-card-pulse profile-card-pulse-${pulse.kind}`,
      style: `--cx: ${pulse.cx}px; --cy: ${pulse.cy}px; --reach: ${pulse.reach}px`,
    });
    return html`<div
      data-profile-pulse=${pulse.kind}
      class="pointer-events-none absolute inset-0"
      @animationend=${this.onPulseEnd}
    >
      ${svgTemplate}
    </div>`;
  }

  private renderBadge(
    progress: ProfileCardProgress,
    accent: string,
  ): TemplateResult {
    return html`<div class="relative grid shrink-0 place-items-center">
      <div
        aria-hidden="true"
        class="absolute rounded-full ${this.compact ? "-inset-4" : "-inset-8"}"
        style="background: radial-gradient(circle, ${accent}55 0%, transparent 70%)"
      ></div>
      <level-badge
        class="relative"
        .level=${progress.level}
        .prestige=${progress.prestige}
        .legend=${progress.legend}
        .size=${this.compact ? 64 : 120}
      ></level-badge>
    </div>`;
  }

  render() {
    const progress = this.progress;
    if (progress === null) return nothing;
    const accent = levelBadgeAccent(progress.level, progress.legend);
    const clan =
      this.clanTag === null
        ? nothing
        : html`<span
            data-profile-clan
            class="font-black tracking-wider text-aquarius ${this.compact
              ? "shrink-0 text-sm"
              : "block text-sm"}"
            >[${this.clanTag}]</span
          >`;
    const name = html`<span
      data-profile-name
      class="truncate font-black leading-tight ${this.compact
        ? "text-2xl"
        : "block text-3xl sm:text-4xl"}"
      title=${this.username}
      >${this.username}</span
    >`;

    if (this.compact) {
      // One row: the badge and who you are on the left, the level's progress
      // in a block of its own on the right (under them on a phone).
      return html`<section
        data-profile-card="compact"
        class="relative overflow-hidden rounded-xl border border-white/10 bg-gradient-to-br from-[#0b1424] to-[#132644] px-5 py-4 text-white"
      >
        ${this.renderBackground(false)}
        <div
          class="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-6"
        >
          <div class="flex min-w-0 flex-1 items-center gap-4">
            ${this.renderBadge(progress, accent)}
            <div class="min-w-0">
              <div class="flex min-w-0 items-baseline gap-2">
                ${clan} ${name}
              </div>
              <div class="mt-0.5">${this.renderLevelLine(progress)}</div>
            </div>
          </div>
          ${this.canPrestige(progress)
            ? html`<div class="flex shrink-0 justify-end">
                ${this.renderPrestigeButton()}
              </div>`
            : this.renderCompactXp(progress)}
        </div>
      </section>`;
    }

    const legend = progress.legend;
    return html`<section
      data-profile-card="full"
      ?data-profile-legend=${legend}
      class="relative overflow-hidden rounded-xl border border-white/10 bg-gradient-to-br from-[#0b1424] to-[#132644] p-5 text-white sm:p-6 ${legend
        ? "profile-card-legend"
        : ""} ${this.intro ? "profile-card-intro" : ""}"
    >
      ${this.renderBackground(legend)}
      ${this.pulse === null ? nothing : this.renderPulse(this.pulse)}
      <div
        class="relative flex flex-col items-center gap-5 sm:flex-row sm:gap-7"
      >
        ${this.renderBadge(progress, accent)}
        <div class="w-full min-w-0 flex-1 text-center sm:text-left">
          ${clan} ${name} ${this.renderLevelLine(progress)}
          ${this.renderXp(progress)}
          ${this.canPrestige(progress)
            ? html`<div
                class="mt-4 flex flex-col items-center gap-3 sm:flex-row sm:justify-between"
              >
                <span class="text-sm text-yellow-100/80"
                  >${translateText("prestige.ready")}</span
                >
                ${this.renderPrestigeButton()}
              </div>`
            : nothing}
        </div>
      </div>
    </section>`;
  }
}

const STYLE_ID = "profile-card-styles";

// Once per document, in <head>: the pulses' radii are registered custom
// properties, which only a document stylesheet can declare.
function ensureProfileCardStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = PROFILE_CARD_CSS;
  document.head.appendChild(style);
}

const blueMask = `radial-gradient(circle at var(--cx) var(--cy),
    transparent calc(var(--pc-wave1) - var(--band)),
    rgba(0, 0, 0, 0.35) calc(var(--pc-wave1) - var(--band) * 0.55),
    #000 calc(var(--pc-wave1) - var(--band) * 0.1),
    transparent calc(var(--pc-wave1) + var(--band) * 0.2)),
  radial-gradient(circle at var(--cx) var(--cy),
    transparent calc(var(--pc-wave2) - var(--band) * 0.8),
    rgba(0, 0, 0, 0.45) calc(var(--pc-wave2) - var(--band) * 0.15),
    transparent calc(var(--pc-wave2) + var(--band) * 0.15))`;

const goldMask = `radial-gradient(circle at var(--cx) var(--cy),
    transparent calc(var(--pc-gold) - var(--band)),
    rgba(0, 0, 0, 0.28) calc(var(--pc-gold) - var(--band) * 0.55),
    rgba(0, 0, 0, 0.7) calc(var(--pc-gold) - var(--band) * 0.12),
    transparent calc(var(--pc-gold) + var(--band) * 0.18))`;

const PROFILE_CARD_CSS = /* css */ `
@property --pc-wave1 { syntax: "<length>"; inherits: false; initial-value: 0px; }
@property --pc-wave2 { syntax: "<length>"; inherits: false; initial-value: 0px; }
@property --pc-gold { syntax: "<length>"; inherits: false; initial-value: 0px; }

/* Opening: the badge settles in, the XP bar fills, one sheen crosses. */
.profile-card-intro level-badge {
  animation: profile-card-badge-in 520ms cubic-bezier(0.2, 0.9, 0.3, 1.25) 100ms both;
}
@keyframes profile-card-badge-in {
  from { opacity: 0; transform: scale(0.7); }
}
.profile-card-intro [data-xp-bar-fill] {
  transform-origin: left center;
  animation: profile-card-bar-in 900ms cubic-bezier(0.2, 0.8, 0.2, 1) 250ms both;
}
@keyframes profile-card-bar-in {
  from { transform: scaleX(0); }
}
.profile-card-intro::after {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: linear-gradient(105deg, transparent 35%, rgba(255, 255, 255, 0.1) 47%,
    rgba(255, 255, 255, 0.18) 50%, rgba(255, 255, 255, 0.1) 53%, transparent 65%);
  transform: translateX(-100%);
  animation: profile-card-sheen 1100ms ease-out 450ms both;
}
@keyframes profile-card-sheen {
  to { transform: translateX(100%); }
}

/* The pulse layers. */
.profile-card-pulse-blue {
  --band: ${BLUE_BAND}px;
  filter: drop-shadow(0 0 4px #38bdf8);
  -webkit-mask-image: ${blueMask};
  mask-image: ${blueMask};
  animation:
    profile-card-wave1 1700ms cubic-bezier(0.3, 0.55, 0.45, 1) 150ms both,
    profile-card-wave2 1700ms cubic-bezier(0.3, 0.55, 0.45, 1) 560ms both,
    ${BLUE_PULSE_END} 2400ms linear both;
}
@keyframes profile-card-wave1 {
  from { --pc-wave1: 0px; }
  to { --pc-wave1: var(--reach); }
}
@keyframes profile-card-wave2 {
  from { --pc-wave2: 0px; }
  to { --pc-wave2: var(--reach); }
}
@keyframes ${BLUE_PULSE_END} {
  0%, 70% { opacity: 1; }
  100% { opacity: 0; }
}
.profile-card-pulse-gold {
  --band: ${GOLD_BAND}px;
  -webkit-mask-image: ${goldMask};
  mask-image: ${goldMask};
  animation: ${GOLD_PULSE_END} 3600ms cubic-bezier(0.33, 0.5, 0.5, 1) 300ms 8 both;
}
@keyframes ${GOLD_PULSE_END} {
  0% { --pc-gold: 0px; opacity: 0; }
  6% { opacity: 1; }
  70% { opacity: 1; }
  100% { --pc-gold: var(--reach); opacity: 0; }
}

/* A Legend's full card: a thin gold edge and a gold-tinted pattern. */
.profile-card-legend {
  border-color: rgba(250, 204, 21, 0.38);
  box-shadow: 0 0 0 1px rgba(250, 204, 21, 0.12), 0 0 28px rgba(250, 204, 21, 0.1),
    inset 0 0 40px rgba(250, 204, 21, 0.05);
  background-image: linear-gradient(135deg, rgba(250, 204, 21, 0.06), transparent 45%),
    linear-gradient(to bottom right, #0b1424, #132644);
}
/* Its Legend line shimmers once as the card opens. */
.profile-card-legend.profile-card-intro [data-profile-level-line] {
  background-size: 200% 100%;
  animation: profile-card-line-shimmer 2.4s ease-in-out both;
}
@keyframes profile-card-line-shimmer {
  from { background-position: 100% 0; }
  to { background-position: -100% 0; }
}

/* The Prestige button glows on and off: the glow is its own layer, and only
   that layer's opacity animates. */
.profile-prestige-button {
  position: relative;
  box-shadow: 0 0 8px rgba(250, 204, 21, 0.45);
}
.profile-prestige-button::before {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  box-shadow: 0 0 22px rgba(250, 204, 21, 0.9);
  opacity: 0;
  pointer-events: none;
  animation: profile-prestige-glow 1.8s ease-in-out infinite;
}
@keyframes profile-prestige-glow {
  50% { opacity: 1; }
}

@media (prefers-reduced-motion: reduce) {
  .profile-card-intro level-badge,
  .profile-card-intro [data-xp-bar-fill],
  .profile-card-legend.profile-card-intro [data-profile-level-line],
  .profile-prestige-button::before {
    animation: none;
  }
  .profile-card-intro::after,
  .profile-card-pulse {
    display: none;
  }
}
`;
