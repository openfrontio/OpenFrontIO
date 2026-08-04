import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { PlayerStatsLeaf } from "../../../../core/ApiSchemas";
import { renderNumber, translateText } from "../../../Utils";

type PlayerSummaryMetricKey =
  | "cities"
  | "ports"
  | "factories"
  | "defensePosts"
  | "transports"
  | "landings"
  | "tradeArrived"
  | "tradeCaptured"
  | "outgoing"
  | "incoming"
  | "nukes"
  | "warships"
  | "tradeGold"
  | "piracyGold"
  | "trainGold"
  | "othersTrainGold";

export interface PlayerSummaryMetric {
  key: PlayerSummaryMetricKey;
  value: string;
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
  cities: "player_stats_tree.stats_cities_per_game",
  ports: "player_stats_tree.stats_ports_per_game",
  factories: "player_stats_tree.stats_factories_per_game",
  defensePosts: "player_stats_tree.stats_defense_posts_per_game",
  transports: "player_stats_tree.stats_transports_sent_per_game",
  landings: "player_stats_tree.stats_transports_landed_per_game",
  tradeArrived: "player_stats_tree.stats_trade_arrived_per_game",
  tradeCaptured: "player_stats_tree.stats_trade_captured_per_game",
  outgoing: "player_stats_tree.stats_troops_sent_per_game",
  incoming: "player_stats_tree.stats_troops_incoming_per_game",
  nukes: "player_stats_tree.stats_nukes_launched_per_game",
  warships: "player_stats_tree.stats_warships_built_per_game",
  tradeGold: "player_stats_tree.stats_trade_gold_per_game",
  piracyGold: "player_stats_tree.stats_piracy_gold_per_game",
  trainGold: "player_stats_tree.stats_train_gold_per_game",
  othersTrainGold: "player_stats_tree.stats_others_train_gold_per_game",
};

// One hue per family row rather than per tile, so colour reinforces the
// grouping instead of competing with it: units, naval, combat, gold.
const UNITS_TONE = "text-emerald-300 border-emerald-400/20";
const NAVAL_TONE = "text-blue-300 border-blue-400/20";
const COMBAT_TONE = "text-rose-300 border-rose-400/20";
const GOLD_TONE = "text-amber-300 border-amber-400/20";

const METRIC_TONES: Record<PlayerSummaryMetricKey, string> = {
  cities: UNITS_TONE,
  ports: UNITS_TONE,
  factories: UNITS_TONE,
  defensePosts: UNITS_TONE,
  transports: NAVAL_TONE,
  landings: NAVAL_TONE,
  tradeArrived: NAVAL_TONE,
  tradeCaptured: NAVAL_TONE,
  outgoing: COMBAT_TONE,
  incoming: COMBAT_TONE,
  nukes: COMBAT_TONE,
  warships: COMBAT_TONE,
  tradeGold: GOLD_TONE,
  piracyGold: GOLD_TONE,
  trainGold: GOLD_TONE,
  othersTrainGold: GOLD_TONE,
};

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
  const outgoing = stats?.attacks?.[0] ?? 0n;
  const incoming = stats?.attacks?.[1] ?? 0n;
  // Gold by source. Worker and war income are folded into the Gold Earned
  // total above rather than broken out. Indices match GOLD_INDEX_* in
  // StatsSchemas: trade, steal, train (own), train (other players').
  const tradeGold = stats?.gold?.[2] ?? 0n;
  const piracyGold = stats?.gold?.[3] ?? 0n;
  const trainGold = stats?.gold?.[4] ?? 0n;
  const othersTrainGold = stats?.gold?.[5] ?? 0n;
  // Structures built, per type. The other three unit outcomes (captured,
  // destroyed, lost) stay in the table below, where they can be read per
  // structure rather than lumped together.
  const cities = stats?.units?.city?.[0] ?? 0n;
  const ports = stats?.units?.port?.[0] ?? 0n;
  const factories = stats?.units?.fact?.[0] ?? 0n;
  const defensePosts = stats?.units?.defp?.[0] ?? 0n;
  const warships = stats?.units?.wshp?.[0] ?? 0n;
  // Warheads actually launched. mirvw is excluded: it counts the
  // sub-munitions a single MIRV releases, which swamps the real launches
  // (16.8 vs 2.1 per game on real data).
  const nukes =
    (stats?.bombs?.abomb?.[0] ?? 0n) +
    (stats?.bombs?.hbomb?.[0] ?? 0n) +
    (stats?.bombs?.mirv?.[0] ?? 0n);
  // Transports launched, plus the two trade-ship outcomes worth bragging
  // about: cargo landed and cargo taken off someone else.
  const transports = stats?.boats?.trans?.[0] ?? 0n;
  const landings = stats?.boats?.trans?.[1] ?? 0n;
  const tradeArrived = stats?.boats?.trade?.[1] ?? 0n;
  const tradeCaptured = stats?.boats?.trade?.[2] ?? 0n;
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
        key: "cities",
        value: formatPerGame(cities, games),
      },
      {
        key: "ports",
        value: formatPerGame(ports, games),
      },
      {
        key: "factories",
        value: formatPerGame(factories, games),
      },
      {
        key: "defensePosts",
        value: formatPerGame(defensePosts, games),
      },
      {
        key: "transports",
        value: formatPerGame(transports, games),
      },
      {
        key: "landings",
        value: formatPerGame(landings, games),
      },
      {
        key: "tradeArrived",
        value: formatPerGame(tradeArrived, games),
      },
      {
        key: "tradeCaptured",
        value: formatPerGame(tradeCaptured, games),
      },
      {
        key: "outgoing",
        value: formatPerGame(outgoing, games),
      },
      {
        key: "incoming",
        value: formatPerGame(incoming, games),
      },
      {
        key: "nukes",
        value: formatPerGame(nukes, games),
      },
      {
        key: "warships",
        value: formatPerGame(warships, games),
      },
      {
        key: "tradeGold",
        value: formatPerGame(tradeGold, games),
      },
      {
        key: "piracyGold",
        value: formatPerGame(piracyGold, games),
      },
      {
        key: "trainGold",
        value: formatPerGame(trainGold, games),
      },
      {
        key: "othersTrainGold",
        value: formatPerGame(othersTrainGold, games),
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
            <!-- Flex, not a 2-col grid: the halves of a grid would each take
            50% of this flexible column, so the two rates drift apart as the
            viewport widens. Flex sizes them to content and keeps the gap
            fixed. -->
            <div class="flex flex-wrap items-start gap-x-8 gap-y-3">
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

        <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
          ${summary.metrics.map(
            (metric) => html`
              <div
                data-stat=${metric.key}
                class="min-w-0 rounded-xl border bg-white/5 px-3 py-3 text-center ${METRIC_TONES[
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
                  ${metric.value}<span
                    data-per-game
                    class="ml-1 text-xs font-semibold text-white/35"
                    >${translateText(
                      "player_stats_tree.stats_per_game_suffix",
                    )}</span
                  >
                </div>
              </div>
            `,
          )}
        </div>
      </section>
    `;
  }
}
