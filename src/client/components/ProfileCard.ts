import { html, LitElement, nothing, TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import { clampPrestige, levelFraction } from "../Progression";
import { translateText } from "../Utils";
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

// Each card names its own hex pattern: a shared id would resolve to the
// first card in the document, which may sit in a hidden page (Chrome draws no
// pattern from a display:none subtree).
let nextPatternId = 0;

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

  createRenderRoot() {
    return this;
  }

  private get compact(): boolean {
    return this.variant === "compact";
  }

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
      </button>
      <style>
        .profile-prestige-button {
          animation: profile-prestige-pulse 1.8s ease-in-out infinite;
        }
        @keyframes profile-prestige-pulse {
          0%,
          100% {
            box-shadow: 0 0 8px rgba(250, 204, 21, 0.45);
          }
          50% {
            box-shadow: 0 0 22px rgba(250, 204, 21, 0.9);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .profile-prestige-button {
            animation: none;
          }
        }
      </style>`;
  }

  private renderBackground(): TemplateResult {
    return html`<svg
      aria-hidden="true"
      class="pointer-events-none absolute inset-0 h-full w-full"
    >
      <defs>
        <pattern
          id=${this.patternId}
          width="60"
          height="103.92"
          patternUnits="userSpaceOnUse"
        >
          <path
            d="M30 0 L60 17.32 L60 51.96 L30 69.28 L0 51.96 L0 17.32 Z M30 69.28 L30 103.92"
            fill="none"
            stroke="#2dd4bf"
            stroke-opacity="0.07"
            stroke-width="1.5"
          ></path>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#${this.patternId})"></rect>
    </svg>`;
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
    const accent = levelBadgeAccent(
      progress.level,
      progress.legend,
      progress.prestige,
    );
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
        ${this.renderBackground()}
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

    return html`<section
      data-profile-card="full"
      class="relative overflow-hidden rounded-xl border border-white/10 bg-gradient-to-br from-[#0b1424] to-[#132644] p-5 text-white sm:p-6"
    >
      ${this.renderBackground()}
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
