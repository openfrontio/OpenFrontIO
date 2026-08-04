import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { PlayerStatsLeaf } from "../../../../core/ApiSchemas";
import { renderNumber, translateText } from "../../../Utils";

type PlayerSummaryMetricKey = "attacks" | "nukes" | "gold";

export interface PlayerSummaryMetric {
  key: PlayerSummaryMetricKey;
  value: string;
  total: string | null;
}

export interface PlayerStatsSummaryData {
  winRate: string;
  recentWinRate: string;
  played: string;
  wins: string;
  losses: string;
  metrics: PlayerSummaryMetric[];
}

const METRIC_LABELS: Record<PlayerSummaryMetricKey, string> = {
  attacks: "player_stats_tree.stats_attacks_per_game",
  nukes: "player_stats_tree.stats_nukes_per_game",
  gold: "player_stats_tree.stats_gold_per_game",
};

const METRIC_TONES: Record<PlayerSummaryMetricKey, string> = {
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
  const attacks = stats?.attacks?.[0] ?? 0n;
  const nukes = Object.values(stats?.bombs ?? {}).reduce(
    (total, values) => total + (values?.[0] ?? 0n),
    0n,
  );
  const gold = sum(stats?.gold);
  const legacyRecentGames = leaf.recentGames ?? [];
  const recentGames = leaf.recent?.games ?? legacyRecentGames.length;
  const recentWins =
    leaf.recent?.wins ?? legacyRecentGames.filter((game) => game.won).length;

  return {
    winRate:
      games > 0n
        ? `${((Number(leaf.wins) / Number(games)) * 100).toFixed(1)}%`
        : "—",
    recentWinRate:
      recentGames > 0
        ? `${((recentWins / recentGames) * 100).toFixed(1)}%`
        : "—",
    played: renderNumber(games),
    wins: renderNumber(leaf.wins),
    losses: renderNumber(leaf.losses),
    metrics: [
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
    const recentGames =
      this.leaf.recent?.games ?? this.leaf.recentGames?.length ?? 0;
    const showRecentWinRate = this.leaf.total > 100n && recentGames > 0;
    const recordStats = [
      {
        key: "played",
        label: "player_stats_tree.stats_played",
        value: summary.played,
        tone: "text-sky-200",
      },
      {
        key: "victories",
        label: "player_stats_tree.stats_victories",
        value: summary.wins,
        tone: "text-emerald-300",
      },
      {
        key: "losses",
        label: "player_stats_tree.stats_losses",
        value: summary.losses,
        tone: "text-rose-300",
      },
    ] as const;

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
          <div
            class="relative grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(17rem,20rem)] sm:items-center"
          >
            <div class=${showRecentWinRate ? "grid grid-cols-2 gap-4" : ""}>
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
              ${showRecentWinRate
                ? html`
                    <div data-last-100>
                      <div
                        class="text-[10px] font-bold uppercase tracking-[0.18em] text-blue-200/60"
                      >
                        ${translateText("player_stats_tree.stats_last_100")}
                      </div>
                      <div
                        class="mt-1 text-3xl font-black leading-none tabular-nums text-cyan-300"
                      >
                        ${summary.recentWinRate}
                      </div>
                    </div>
                  `
                : ""}
            </div>
            <div
              data-record-group
              class="grid grid-cols-3 overflow-hidden rounded-lg border border-white/10 bg-black/20 shadow-inner shadow-black/20"
            >
              ${recordStats.map(
                (stat, index) => html`
                  <div
                    data-record-stat=${stat.key}
                    class="min-w-0 px-2 py-3 text-center ${index === 0
                      ? ""
                      : "border-l border-white/10"}"
                  >
                    <div
                      class="truncate text-[10px] font-bold uppercase tracking-wider text-blue-200/55"
                      title=${translateText(stat.label)}
                    >
                      ${translateText(stat.label)}
                    </div>
                    <div
                      class="mt-1 truncate text-xl font-black leading-none tabular-nums ${stat.tone}"
                    >
                      ${stat.value}
                    </div>
                  </div>
                `,
              )}
            </div>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
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
