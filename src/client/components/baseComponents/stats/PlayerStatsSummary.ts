import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { PlayerStatsLeaf } from "../../../../core/ApiSchemas";
import { renderNumber, translateText } from "../../../Utils";

type PlayerSummaryMetricKey =
  | "games"
  | "victories"
  | "conquests"
  | "attacks"
  | "nukes"
  | "gold";

export interface PlayerSummaryMetric {
  key: PlayerSummaryMetricKey;
  value: string;
  total: string | null;
}

export interface PlayerStatsSummaryData {
  winRate: string;
  wins: string;
  losses: string;
  metrics: PlayerSummaryMetric[];
}

const METRIC_LABELS: Record<PlayerSummaryMetricKey, string> = {
  games: "player_stats_tree.stats_games_played",
  victories: "player_stats_tree.stats_victories",
  conquests: "player_stats_tree.stats_conquests_per_game",
  attacks: "player_stats_tree.stats_attacks_per_game",
  nukes: "player_stats_tree.stats_nukes_per_game",
  gold: "player_stats_tree.stats_gold_per_game",
};

const METRIC_TONES: Record<PlayerSummaryMetricKey, string> = {
  games: "text-sky-300 border-sky-400/20",
  victories: "text-emerald-300 border-emerald-400/20",
  conquests: "text-violet-300 border-violet-400/20",
  attacks: "text-cyan-300 border-cyan-400/20",
  nukes: "text-rose-300 border-rose-400/20",
  gold: "text-amber-300 border-amber-400/20",
};

function sum(values: readonly bigint[] | undefined): bigint {
  return values?.reduce((total, value) => total + value, 0n) ?? 0n;
}

function formatPerGame(total: bigint, games: bigint): string {
  if (games <= 0n) return "—";
  const average = Number(total) / Number(games);
  if (average >= 1_000) return renderNumber(average);
  if (average >= 10) return Math.round(average).toString();
  return average.toFixed(1);
}

export function buildPlayerStatsSummary(
  leaf: PlayerStatsLeaf,
): PlayerStatsSummaryData {
  const games = leaf.total;
  const stats = leaf.stats;
  const conquests = sum(stats?.conquests);
  const attacks = stats?.attacks?.[0] ?? 0n;
  const nukes = Object.values(stats?.bombs ?? {}).reduce(
    (total, values) => total + (values?.[0] ?? 0n),
    0n,
  );
  const gold = sum(stats?.gold);

  return {
    winRate:
      games > 0n
        ? `${((Number(leaf.wins) / Number(games)) * 100).toFixed(1)}%`
        : "—",
    wins: renderNumber(leaf.wins),
    losses: renderNumber(leaf.losses),
    metrics: [
      {
        key: "games",
        value: renderNumber(games),
        total: null,
      },
      {
        key: "victories",
        value: renderNumber(leaf.wins),
        total: null,
      },
      {
        key: "conquests",
        value: formatPerGame(conquests, games),
        total: renderNumber(conquests),
      },
      {
        key: "attacks",
        value: formatPerGame(attacks, games),
        total: renderNumber(attacks),
      },
      {
        key: "nukes",
        value: formatPerGame(nukes, games),
        total: renderNumber(nukes),
      },
      {
        key: "gold",
        value: formatPerGame(gold, games),
        total: renderNumber(gold),
      },
    ],
  };
}

@customElement("player-stats-summary")
export class PlayerStatsSummary extends LitElement {
  @property({ attribute: false }) leaf?: PlayerStatsLeaf;

  createRenderRoot() {
    return this;
  }

  render() {
    if (!this.leaf) return html``;
    const summary = buildPlayerStatsSummary(this.leaf);

    return html`
      <section
        class="space-y-3"
        aria-label=${translateText("player_stats_tree.stats_summary")}
      >
        <div
          data-win-rate
          class="relative overflow-hidden rounded-xl border border-malibu-blue/25 bg-gradient-to-br from-malibu-blue/15 via-white/5 to-transparent px-4 py-3"
        >
          <div
            class="pointer-events-none absolute -right-8 -top-12 h-32 w-32 rounded-full bg-aquarius/10 blur-2xl"
          ></div>
          <div class="relative flex items-end justify-between gap-4">
            <div>
              <div
                class="text-[10px] font-bold uppercase tracking-[0.18em] text-blue-200/60"
              >
                ${translateText("player_stats_tree.stats_win_rate")}
              </div>
              <div
                class="mt-1 text-3xl font-black leading-none tabular-nums text-emerald-300"
              >
                ${summary.winRate}
              </div>
            </div>
            <div
              class="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm font-bold tabular-nums text-white/70"
            >
              ${translateText("player_stats_tree.stats_record", {
                wins: summary.wins,
                losses: summary.losses,
              })}
            </div>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          ${summary.metrics.map(
            (metric) => html`
              <div
                data-stat=${metric.key}
                class="min-w-0 rounded-xl border bg-white/5 px-3 py-3 ${METRIC_TONES[
                  metric.key
                ]}"
              >
                <div
                  class="truncate text-[10px] font-bold uppercase tracking-wider text-blue-200/55"
                  title=${translateText(METRIC_LABELS[metric.key])}
                >
                  ${translateText(METRIC_LABELS[metric.key])}
                </div>
                <div
                  class="mt-1 truncate text-2xl font-black leading-none tabular-nums"
                >
                  ${metric.value}
                </div>
                <div class="mt-1 min-h-4 text-[10px] text-white/35">
                  ${metric.total === null
                    ? ""
                    : translateText("player_stats_tree.stats_total", {
                        total: metric.total,
                      })}
                </div>
              </div>
            `,
          )}
        </div>
      </section>
    `;
  }
}
