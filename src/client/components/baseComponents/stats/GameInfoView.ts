import { html, LitElement, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { type GameEndInfo } from "../../../../core/Schemas";
import { GameMode, type GameMapType } from "../../../../core/game/Game";
import { fetchGameById } from "../../../Api";
import { terrainMapFileLoader } from "../../../TerrainMapFileLoader";
import { getMapName, renderDuration, translateText } from "../../../Utils";
import { Ranking, RankType, type PlayerInfo } from "../ranking/GameInfoRanking";
import "../ranking/PlayerRow";
import "../ranking/RankingControls";
import "../ranking/RankingHeader";

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
      <div class="w-full max-w-[500px] mx-auto text-center">
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
        <div class="flex flex-col items-center justify-center p-6 text-white">
          <p class="mb-2">${translateText("game_info_modal.no_winner")}</p>
        </div>
      `;
    }
    return html`
      ${this.renderGameInfo()}
      <ranking-controls
        .rankType=${this.rankType}
        @sort=${this.sort}
      ></ranking-controls>
      ${this.renderSummaryTable()}
    `;
  }

  private renderError() {
    return html`
      <div
        class="flex flex-col items-center justify-center gap-3 p-6 text-white"
      >
        <p class="mb-1">${translateText("game_info_modal.load_failed")}</p>
        <button
          type="button"
          @click=${() => this.retry()}
          class="px-3 py-1.5 text-xs font-bold text-white/80 uppercase tracking-wider bg-white/10 hover:bg-white/20 border border-white/10 rounded-lg transition-colors"
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
    return html`
      <div class="flex flex-col items-center justify-center p-6 text-white">
        <p class="mb-2">
          ${translateText("game_info_modal.loading_game_info")}
        </p>
        <div
          class="w-6 h-6 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"
        ></div>
      </div>
    `;
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
    return html`
      <div
        class="h-37.5 flex relative justify-between rounded-xl bg-black/20 items-center"
      >
        ${this.mapImage
          ? html`<img
              src=${this.mapImage}
              class="absolute place-self-start col-span-full row-span-full h-full rounded-xl mask-[linear-gradient(to_left,transparent,#fff)] object-cover object-center"
            />`
          : html`<div
              class="place-self-start col-span-full row-span-full h-full rounded-xl bg-gray-300"
            ></div>`}
        <div class="text-right p-3 w-full">
          <div class="font-normal pl-1 pr-1">
            <span class="bg-white text-blue-800 font-normal pl-1 pr-1"
              >${translateText(
                info.config.gameMode === GameMode.Team
                  ? "game_mode.teams"
                  : "game_mode.ffa",
              )}</span
            >
            <span class="font-bold"
              >${getMapName(info.config.gameMap) ?? info.config.gameMap}</span
            >
          </div>
          <div>${renderDuration(info.duration)}</div>
          <div>
            ${info.players.length} ${translateText("game_info_modal.players")}
          </div>
        </div>
      </div>
    `;
  }

  private renderSummaryTable() {
    const bestScore =
      this.rankedPlayers.length > 0 ? this.score(this.rankedPlayers[0]) : 0;
    return html`
      <ul>
        <ranking-header
          .rankType=${this.rankType}
          @sort=${this.sort}
        ></ranking-header>
        ${this.rankedPlayers.map(
          (player, index) => html`
            <player-row
              .player=${player}
              .rank=${index + 1}
              .score=${this.ranking?.score(player, this.rankType) ?? 0}
              .rankType=${this.rankType}
              .bestScore=${bestScore}
            ></player-row>
          `,
        )}
      </ul>
    `;
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
