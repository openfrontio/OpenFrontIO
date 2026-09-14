import { LitElement, html, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import { translateText } from "../../../Utils";
import { RankType } from "./GameInfoRanking";

type Metric = { type: RankType; label: string };

const warMetrics: readonly Metric[] = [
  {
    type: RankType.ConquestHumans,
    label: "game_info_modal.num_of_conquests_humans",
  },
  {
    type: RankType.ConquestNations,
    label: "game_info_modal.num_of_conquests_nations",
  },
  {
    type: RankType.ConquestBots,
    label: "game_info_modal.num_of_conquests_bots",
  },
  { type: RankType.Atoms, label: "game_info_modal.atoms" },
  { type: RankType.Hydros, label: "game_info_modal.hydros" },
  { type: RankType.MIRV, label: "game_info_modal.mirv" },
];

const economyMetrics: readonly Metric[] = [
  { type: RankType.TotalGold, label: "game_info_modal.total_gold" },
  { type: RankType.ConqueredGold, label: "game_info_modal.conquered" },
  { type: RankType.StolenGold, label: "game_info_modal.pirate" },
  { type: RankType.TrainTrade, label: "game_info_modal.train_trade" },
  { type: RankType.NavalTrade, label: "game_info_modal.naval_trade" },
];

const includesMetric = (metrics: readonly Metric[], type: RankType) =>
  metrics.some((metric) => metric.type === type);

const isEconomyRanking = (type: RankType) =>
  includesMetric(economyMetrics, type);
const isWarRanking = (type: RankType) => includesMetric(warMetrics, type);

@customElement("ranking-controls")
export class RankingControls extends LitElement {
  @property({ type: String }) rankType = RankType.Lifetime;

  private onSort(type: RankType) {
    this.dispatchEvent(new CustomEvent("sort", { detail: type }));
  }

  private renderMainButtons() {
    return html`
      <div
        role="group"
        aria-label=${translateText("game_list.stats")}
        class="grid grid-cols-3 gap-1 rounded-xl border border-white/10 bg-white/[0.04] p-1"
      >
        ${this.renderButton(
          RankType.Lifetime,
          this.rankType === RankType.Lifetime,
          "game_info_modal.duration",
          this.renderClockIcon(),
        )}
        ${this.renderButton(
          RankType.ConquestHumans,
          isWarRanking(this.rankType),
          "game_info_modal.war",
          this.renderWarIcon(),
        )}
        ${this.renderButton(
          RankType.TotalGold,
          isEconomyRanking(this.rankType),
          "game_info_modal.economy",
          this.renderEconomyIcon(),
        )}
      </div>
    `;
  }

  private renderButton(
    type: RankType,
    active: boolean,
    label: string,
    icon: TemplateResult,
  ) {
    return html`
      <button
        type="button"
        data-ranking-category=${type}
        aria-pressed=${active}
        class="flex min-h-11 min-w-0 items-center justify-center gap-1.5 rounded-lg border px-2 py-2.5 text-[10px] font-bold uppercase tracking-wider transition-all duration-200 sm:gap-2 sm:px-4 sm:text-xs sm:tracking-widest ${active
          ? "border-malibu-blue/30 bg-malibu-blue/20 text-aquarius shadow-(--shadow-malibu-blue-soft)"
          : "border-transparent text-white/40 hover:bg-white/5 hover:text-white/75"} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aquarius/70"
        @click=${() => this.onSort(type)}
      >
        <span class="hidden sm:block" aria-hidden="true">${icon}</span>
        <span class="truncate">${translateText(label)}</span>
      </button>
    `;
  }

  private renderMetricSelector(metrics: readonly Metric[], ariaLabel: string) {
    const hasSixMetrics = metrics.length === 6;
    return html`
      <div
        role="group"
        aria-label=${ariaLabel}
        class="mt-2 grid grid-cols-6 gap-1 rounded-xl border border-white/10 bg-white/[0.03] p-1 ${hasSixMetrics
          ? "sm:grid-cols-6"
          : "sm:grid-cols-5"}"
      >
        ${metrics.map((metric, index) =>
          this.renderMetricButton(
            metric.type,
            metric.label,
            hasSixMetrics
              ? "col-span-2"
              : index < 2
                ? "col-span-3"
                : "col-span-2",
          ),
        )}
      </div>
    `;
  }

  private renderMetricButton(
    type: RankType,
    label: string,
    mobileSpan: string,
  ) {
    const active = this.rankType === type;
    return html`
      <button
        type="button"
        data-ranking-metric=${type}
        aria-pressed=${active}
        @click=${() => this.onSort(type)}
        title=${translateText(label)}
        class="${mobileSpan} min-h-11 min-w-0 rounded-lg border px-1.5 py-2 text-[10px] font-bold uppercase leading-tight tracking-wider transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aquarius/70 sm:col-span-1 sm:px-2 ${active
          ? "border-malibu-blue/30 bg-malibu-blue/15 text-aquarius"
          : "border-transparent text-white/40 hover:border-white/10 hover:bg-white/[0.06] hover:text-white/75"}"
      >
        <span class="block min-w-0 break-words">${translateText(label)}</span>
      </button>
    `;
  }

  private renderClockIcon(): TemplateResult {
    return html`<svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      class="size-4"
    >
      <circle cx="12" cy="12" r="8.5" stroke-width="1.7" />
      <path d="M12 7.5V12l3 2" stroke-width="1.7" stroke-linecap="round" />
    </svg>`;
  }

  private renderWarIcon(): TemplateResult {
    return html`<svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      class="size-4"
    >
      <path
        d="m6 4 12 12m0-12L6 16m-2 0 4 4m12-4-4 4M5 3l4 1-5 5-1-4 2-2Zm14 0-4 1 5 5 1-4-2-2Z"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>`;
  }

  private renderEconomyIcon(): TemplateResult {
    return html`<svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      class="size-4"
    >
      <ellipse cx="12" cy="7" rx="7.5" ry="3.5" stroke-width="1.6" />
      <path
        d="M4.5 7v5c0 2 3.4 3.5 7.5 3.5s7.5-1.5 7.5-3.5V7m-15 5v5c0 2 3.4 3.5 7.5 3.5s7.5-1.5 7.5-3.5v-5"
        stroke-width="1.6"
      />
    </svg>`;
  }

  render() {
    return html`
      ${this.renderMainButtons()}
      ${isWarRanking(this.rankType)
        ? this.renderMetricSelector(
            warMetrics,
            translateText("game_info_modal.war"),
          )
        : isEconomyRanking(this.rankType)
          ? this.renderMetricSelector(
              economyMetrics,
              translateText("game_info_modal.economy"),
            )
          : ""}
    `;
  }

  createRenderRoot() {
    return this;
  }
}
