import {
  html,
  LitElement,
  type PropertyValues,
  type TemplateResult,
} from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { type GameEndInfo } from "../../../../core/Schemas";
import {
  GameMode,
  GameType,
  type GameMapType,
} from "../../../../core/game/Game";
import { fetchGameById } from "../../../Api";
import { terrainMapFileLoader } from "../../../TerrainMapFileLoader";
import { getMapName, renderDuration, translateText } from "../../../Utils";
import { renderLoadingSpinner } from "../../BaseModal";
import {
  RANK_TYPE_LABEL_KEYS,
  Ranking,
  RankType,
  type PlayerInfo,
} from "../ranking/GameInfoRanking";
import "../ranking/PlayerRow";
import "../ranking/RankingControls";
import { formatAbsoluteTime } from "./GameHistoryDates";

/**
 * Game-stats content for the Account > Games > Stats drill-down.
 */
@customElement("game-info-view")
export class GameInfoView extends LitElement {
  @property({ type: String }) gameId: string | null = null;

  @state() private rankType = RankType.Lifetime;
  @state() private mapImage: string | null = null;
  @state() private gameInfo: GameEndInfo | null = null;
  @state() private rankedPlayers: PlayerInfo[] = [];
  @state() private isLoadingGame = true;
  @state() private loadFailed = false;

  private ranking: Ranking | null = null;
  private requestedGameId: string | null = null;
  // Loading a second game does not cancel the first request, so generations
  // prevent a late response for the old game from replacing the current one.
  private loadGeneration = 0;

  createRenderRoot() {
    return this;
  }

  protected updated(changed: PropertyValues<this>): void {
    if (changed.has("gameId") && this.gameId !== this.requestedGameId) {
      this.requestedGameId = this.gameId;
      if (this.gameId) {
        void this.fetchGame(this.gameId);
      } else {
        ++this.loadGeneration;
        this.isLoadingGame = false;
        this.loadFailed = false;
        this.mapImage = null;
        this.gameInfo = null;
        this.ranking = null;
        this.rankedPlayers = [];
      }
    }
  }

  render() {
    if (!this.gameId) return html``;
    return html`
      <div class="w-full max-w-[800px] mx-auto">
        ${this.isLoadingGame
          ? this.renderLoadingAnimation()
          : this.loadFailed
            ? this.renderError()
            : this.renderRanking()}
      </div>
    `;
  }

  private renderRanking() {
    if (this.rankedPlayers.length === 0) {
      return html`
        ${this.renderGameInfo()}
        <div
          class="mt-5 flex min-h-56 flex-col items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center text-white"
        >
          <div
            class="mb-4 flex size-12 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-white/35"
            aria-hidden="true"
          >
            ${this.renderTrophyIcon("size-6")}
          </div>
          <p class="max-w-md text-sm leading-relaxed text-white/60">
            ${translateText("game_info_modal.no_winner")}
          </p>
        </div>
      `;
    }
    return html`
      ${this.renderGameInfo()}
      <div class="mt-5 flex flex-col gap-3">
        <ranking-controls
          .rankType=${this.rankType}
          @sort=${this.sort}
        ></ranking-controls>
        ${this.renderSummaryTable()}
      </div>
    `;
  }

  private renderError() {
    return html`
      <div
        role="alert"
        class="flex min-h-80 flex-col items-center justify-center rounded-2xl border border-red-400/15 bg-red-400/[0.04] p-8 text-center text-white"
      >
        <div
          class="mb-4 flex size-12 items-center justify-center rounded-xl border border-red-300/15 bg-red-400/10 text-red-200/70"
          aria-hidden="true"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            class="size-6"
          >
            <path
              d="M12 9v4m0 4h.01M10.3 3.8 2.4 17.5A2 2 0 0 0 4.1 20h15.8a2 2 0 0 0 1.7-2.5L13.7 3.8a2 2 0 0 0-3.4 0Z"
              stroke-width="1.7"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </div>
        <p class="mb-5 text-sm text-white/65">
          ${translateText("game_info_modal.load_failed")}
        </p>
        <button
          type="button"
          @click=${() => this.retry()}
          class="rounded-lg border border-malibu-blue/40 bg-malibu-blue/20 px-5 py-2.5 text-xs font-bold uppercase tracking-widest text-aquarius transition-colors hover:border-malibu-blue/60 hover:bg-malibu-blue/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aquarius/70"
        >
          ${translateText("game_info_modal.retry")}
        </button>
      </div>
    `;
  }

  private retry(): void {
    if (this.gameId) void this.fetchGame(this.gameId);
  }

  private renderLoadingAnimation() {
    return renderLoadingSpinner(
      translateText("game_info_modal.loading_game_info"),
    );
  }

  private sort(e: CustomEvent<RankType>) {
    this.rankType = e.detail;
    this.updateRanking();
  }

  private updateRanking() {
    if (this.ranking) {
      this.rankedPlayers = this.ranking.sortedBy(this.rankType);
    }
  }

  private renderGameInfo() {
    const info = this.gameInfo;
    if (!info) return html``;
    const mapName = getMapName(info.config.gameMap) ?? info.config.gameMap;
    const startDate = new Date(info.start).toISOString();
    return html`
      <div
        data-game-summary
        class="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.08] to-white/[0.025] shadow-[0_18px_50px_rgba(0,0,0,0.2)]"
      >
        <div class="grid sm:grid-cols-[240px_minmax(0,1fr)]">
          <div
            class="relative min-h-36 overflow-hidden border-b border-white/10 bg-deep-navy sm:min-h-44 sm:border-b-0 sm:border-r"
          >
            ${this.mapImage
              ? html`<img
                  data-map-image
                  src=${this.mapImage}
                  alt=${mapName}
                  draggable="false"
                  decoding="async"
                  @error=${() => this.handleMapImageError()}
                  class="absolute inset-0 h-full w-full object-cover"
                />`
              : this.renderMapFallback()}
            <div
              class="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/65 via-black/5 to-black/10 sm:bg-gradient-to-r sm:from-transparent sm:via-transparent sm:to-black/25"
            ></div>
          </div>
          <div class="flex min-w-0 flex-col justify-between p-4 sm:p-5">
            <div>
              <div class="mb-2 flex flex-wrap items-center gap-2">
                <span
                  class="rounded-md border border-malibu-blue/25 bg-malibu-blue/15 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-aquarius"
                >
                  ${translateText(
                    info.config.gameMode === GameMode.Team
                      ? "game_mode.teams"
                      : "game_mode.ffa",
                  )}
                </span>
                <span
                  class="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-white/45"
                >
                  ${this.gameTypeLabel(info.config.gameType)}
                </span>
              </div>
              <h2
                class="truncate text-xl font-bold tracking-wide text-white sm:text-2xl"
                title=${mapName}
              >
                ${mapName}
              </h2>
              <div
                data-game-date
                class="mt-2 flex items-center gap-1.5 text-xs font-medium tabular-nums text-white/50"
              >
                <span class="text-aquarius/70" aria-hidden="true">
                  ${this.renderCalendarIcon("size-3.5")}
                </span>
                <time datetime=${startDate}
                  >${formatAbsoluteTime(startDate)}</time
                >
              </div>
            </div>
            <div class="mt-3 grid grid-cols-2 gap-3">
              ${this.renderInfoMetric(
                this.renderClockIcon("size-4"),
                translateText("game_info_modal.duration"),
                renderDuration(info.duration),
              )}
              ${this.renderInfoMetric(
                this.renderPlayersIcon("size-4"),
                translateText("game_info_modal.players"),
                String(info.players.length),
              )}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  private renderInfoMetric(
    icon: TemplateResult,
    label: string,
    value: string,
  ): TemplateResult {
    return html`
      <div class="rounded-xl border border-white/[0.08] bg-black/15 p-2.5">
        <div
          class="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-white/35"
        >
          <span class="text-aquarius/70" aria-hidden="true">${icon}</span>
          ${label}
        </div>
        <div class="text-sm font-semibold tabular-nums text-white/85">
          ${value}
        </div>
      </div>
    `;
  }

  private renderMapFallback(): TemplateResult {
    return html`
      <div
        data-map-fallback
        class="absolute inset-0 flex items-center justify-center bg-[radial-gradient(circle_at_50%_40%,rgba(0,132,209,0.18),transparent_65%)] text-aquarius/35"
        aria-hidden="true"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          class="size-12"
        >
          <path
            d="m3 6 5-2 8 3 5-2v13l-5 2-8-3-5 2V6Z"
            stroke-width="1.3"
            stroke-linejoin="round"
          />
          <path d="M8 4v13m8-10v13" stroke-width="1.3" />
        </svg>
      </div>
    `;
  }

  private handleMapImageError(): void {
    this.mapImage = null;
  }

  private gameTypeLabel(gameType: GameType): string {
    switch (gameType) {
      case GameType.Public:
        return translateText("account_modal.games_type_public");
      case GameType.Private:
        return translateText("account_modal.games_type_private");
      case GameType.Singleplayer:
        return translateText("account_modal.games_type_singleplayer");
      default:
        return translateText("game_info_modal.unknown_game_type");
    }
  }

  private renderSummaryTable() {
    const bestScore = this.rankedPlayers.reduce(
      (best, player) => Math.max(best, this.score(player)),
      0,
    );
    return html`
      <section
        aria-label=${translateText(RANK_TYPE_LABEL_KEYS[this.rankType])}
        class="overflow-hidden rounded-2xl border border-white/10 bg-black/15 shadow-[0_12px_35px_rgba(0,0,0,0.16)]"
      >
        <ol class="divide-y divide-white/[0.06]">
          ${this.rankedPlayers.map(
            (player, index) => html`
              <player-row
                class="block"
                .player=${player}
                .rank=${index + 1}
                .score=${this.ranking?.score(player, this.rankType) ?? 0}
                .rankType=${this.rankType}
                .bestScore=${bestScore}
              ></player-row>
            `,
          )}
        </ol>
      </section>
    `;
  }

  private renderClockIcon(className: string): TemplateResult {
    return html`<svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      class=${className}
    >
      <circle cx="12" cy="12" r="8.5" stroke-width="1.7" />
      <path
        d="M12 7.5V12l3 2"
        stroke-width="1.7"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>`;
  }

  private renderCalendarIcon(className: string): TemplateResult {
    return html`<svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      class=${className}
    >
      <rect x="3.5" y="5" width="17" height="15.5" rx="2" stroke-width="1.7" />
      <path
        d="M8 3v4m8-4v4M3.5 9.5h17"
        stroke-width="1.7"
        stroke-linecap="round"
      />
    </svg>`;
  }

  private renderPlayersIcon(className: string): TemplateResult {
    return html`<svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      class=${className}
    >
      <path
        d="M16 19v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 17.5V19m14-7.8a3 3 0 0 1 2 2.8v1M10 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm6-5.7a3 3 0 0 1 0 5.4"
        stroke-width="1.7"
        stroke-linecap="round"
      />
    </svg>`;
  }

  private renderTrophyIcon(className: string): TemplateResult {
    return html`<svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      class=${className}
    >
      <path
        d="M8 4h8v3.5a4 4 0 0 1-8 0V4Zm4 7.5V16m-3 4h6m-5-4h4M8 6H5v1a4 4 0 0 0 4 4m7-5h3v1a4 4 0 0 1-4 4"
        stroke-width="1.6"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>`;
  }

  private score(player: PlayerInfo): number {
    if (!this.ranking) return 0;
    return this.ranking.score(player, this.rankType);
  }

  private async fetchGame(gameId: string): Promise<void> {
    const generation = ++this.loadGeneration;
    this.isLoadingGame = true;
    this.loadFailed = false;
    this.mapImage = null;
    this.gameInfo = null;
    this.ranking = null;
    this.rankedPlayers = [];
    this.rankType = RankType.Lifetime;

    try {
      const session = await fetchGameById(gameId);
      if (generation !== this.loadGeneration) return;
      if (!session) {
        this.loadFailed = true;
        return;
      }

      this.gameInfo = session.info;
      this.ranking = new Ranking(session);
      this.updateRanking();
      try {
        const mapType = session.info.config.gameMap as GameMapType;
        this.mapImage = terrainMapFileLoader.getMapData(mapType).webpPath;
      } catch (error) {
        console.error("Failed to load map image:", error);
      }
    } catch (err) {
      if (generation === this.loadGeneration) {
        console.error("Failed to load game:", err);
        this.loadFailed = true;
      }
    } finally {
      if (generation === this.loadGeneration) {
        this.isLoadingGame = false;
      }
    }
  }
}
