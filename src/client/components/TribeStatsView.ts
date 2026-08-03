import { html, LitElement, nothing, PropertyValues, TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { TribeStatsResponse } from "../../core/ApiSchemas";
import { fetchTribeStats } from "../Api";
import { translateText } from "../Utils";
import { renderLoadingSpinner } from "./BaseModal";
import { formatWindowDate } from "./leaderboard/LeaderboardTribeTable";
import "./PlayerName";
import { modalHeader } from "./ui/ModalHeader";

// The tribe page: live stats for one custom tribe name (GET /public/tribe/
// :name). The store's Tribes tab renders it in place of the name list — the
// same in-modal handoff the profile modal uses from the leaderboard — and
// the header's back button returns to the list via the `back` event.
@customElement("tribe-stats-view")
export class TribeStatsView extends LitElement {
  @property({ attribute: false }) tribeName = "";

  // null = loading; false = load failed (including 404 — the name was taken
  // down while the list was open); otherwise the fetched stats.
  @state() private stats: TribeStatsResponse | false | null = null;

  // Guards against a stale response landing after the view was re-targeted
  // at a different name.
  private loadSeq = 0;

  createRenderRoot() {
    return this;
  }

  protected updated(changed: PropertyValues) {
    if (changed.has("tribeName") && this.tribeName !== "") {
      void this.load(this.tribeName);
    }
  }

  private async load(name: string) {
    const seq = ++this.loadSeq;
    this.stats = null;
    const stats = await fetchTribeStats(name);
    if (seq !== this.loadSeq) return;
    this.stats = stats;
  }

  private renderFigures(figures: {
    gamesAppeared: number;
    playerReach: number;
  }): TemplateResult {
    return html`<div class="grid grid-cols-2 gap-2">
      <div
        class="bg-surface rounded-lg border border-white/10 px-3 py-2 flex flex-col"
      >
        <span
          class="text-[11px] font-bold uppercase tracking-wider text-white/40"
        >
          ${translateText("store.tribe_stats_games")}
        </span>
        <span class="font-mono text-lg text-white">
          ${figures.gamesAppeared.toLocaleString()}
        </span>
      </div>
      <div
        class="bg-surface rounded-lg border border-white/10 px-3 py-2 flex flex-col"
        title=${translateText("store.tribe_stats_reach_tooltip", {
          count: figures.playerReach.toLocaleString(),
        })}
      >
        <span
          class="text-[11px] font-bold uppercase tracking-wider text-white/40"
        >
          ${translateText("store.tribe_stats_reach")}
        </span>
        <span class="font-mono text-lg text-white">
          ${figures.playerReach.toLocaleString()}
        </span>
      </div>
    </div>`;
  }

  private renderStats(stats: TribeStatsResponse): TemplateResult {
    // The window heading means little without its date span, but a heading
    // is still needed to separate the sections — fall back to the dateless
    // form if the wire format wobbles (see formatWindowDate).
    const start = formatWindowDate(stats.window.start);
    const end = formatWindowDate(stats.window.end);
    const windowHeading =
      start !== null && end !== null
        ? translateText("store.tribe_stats_window", {
            days: stats.window.days,
            start,
            end,
          })
        : translateText("store.tribe_stats_window_short", {
            days: stats.window.days,
          });
    return html`<div class="flex flex-col gap-4">
      <div class="flex items-center gap-2 text-sm">
        <span class="text-white/40 font-medium">
          ${translateText("store.tribe_stats_owner")}
        </span>
        <player-name
          class="min-w-0"
          .username=${stats.ownerUsername}
          .publicId=${stats.ownerPublicId}
        ></player-name>
      </div>
      <section class="flex flex-col gap-2">
        <h3 class="text-xs font-bold uppercase tracking-wider text-white/60">
          ${windowHeading}
        </h3>
        ${this.renderFigures(stats.window)}
      </section>
      <section class="flex flex-col gap-2">
        <h3 class="text-xs font-bold uppercase tracking-wider text-white/60">
          ${translateText("store.tribe_stats_lifetime")}
        </h3>
        ${this.renderFigures(stats.lifetime)}
      </section>
    </div>`;
  }

  private renderBody(): TemplateResult {
    if (this.stats === null) {
      return renderLoadingSpinner();
    }
    if (this.stats === false) {
      return html`<p class="text-sm font-medium text-red-400">
        ${translateText("store.tribe_stats_failed")}
      </p>`;
    }
    return this.renderStats(this.stats);
  }

  private renderBoostedBadge(): TemplateResult | typeof nothing {
    if (this.stats === null || this.stats === false) return nothing;
    const boosts = this.stats.activeBoosts;
    if (boosts === 0) return nothing;
    // Display multiplier = 1 + activeBoosts, the same convention as the
    // leaderboard's Boosts column and the owner's row in the store.
    return html`<span
      class="shrink-0 text-xs font-bold text-amber-300 bg-amber-400/10 border border-amber-400/20 rounded px-2 py-0.5"
    >
      ${translateText("store.tribe_stats_boosted", { multiplier: boosts + 1 })}
    </span>`;
  }

  render(): TemplateResult {
    // The heading shows the canonical display form once loaded; until then,
    // the name the row was opened with (identical for the owner's own list).
    const heading =
      this.stats !== null && this.stats !== false
        ? this.stats.name
        : this.tribeName;
    return html`<div class="flex flex-col gap-4">
      ${modalHeader({
        // titleContent rather than title: name casing is meaningful, so it
        // must not get the default title's uppercase treatment (same reason
        // the profile modal does this for usernames).
        titleContent: html`<span
          class="text-white text-xl font-bold tracking-wide break-words hyphens-auto min-w-0 inline-flex items-center gap-2"
        >
          ${heading} ${this.renderBoostedBadge()}
        </span>`,
        onBack: () => this.dispatchEvent(new CustomEvent("back")),
        ariaLabel: translateText("common.back"),
        padded: false,
        showDivider: false,
      })}
      ${this.renderBody()}
    </div>`;
  }
}
