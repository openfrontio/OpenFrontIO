import { html, LitElement, PropertyValues, TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { GameMapType } from "../../../../core/game/Game";
import { GameEndInfo } from "../../../../core/Schemas";
import { fetchGameById } from "../../../Api";
import { terrainMapFileLoader } from "../../../TerrainMapFileLoader";
import { renderDuration, translateText } from "../../../Utils";
import { renderLoadingSpinner } from "../../BaseModal";
import { PlayerInfo, Ranking, RankType } from "./GameInfoRanking";
import "./PlayerRow";
import "./RankingControls";
import "./RankingHeader";

// Post-game ranking panel for a finished game, rendered inside a host modal
// (e.g. the account modal's Games tab) as a sub-view rather than as its own
// popup layered on top.
@customElement("game-ranking-view")
export class GameRankingView extends LitElement {
  createRenderRoot() {
    return this;
  }

  @property() gameId = "";
  @property() currentClientID: string | null = null;

  @state() private mapImage: string | null = null;
  @state() private gameInfo: GameEndInfo | null = null;
  @state() private rankedPlayers: PlayerInfo[] = [];
  @state() private rankType = RankType.Lifetime;
  @state() private loading = true;

  private ranking: Ranking | null = null;
  // Guards against a stale fetch resolving after the host switched gameId.
  private asyncGeneration = 0;

  willUpdate(changed: PropertyValues) {
    if (changed.has("gameId")) {
      void this.loadGame();
    }
  }

  private async loadGame() {
    const gen = ++this.asyncGeneration;
    this.loading = true;
    this.gameInfo = null;
    this.ranking = null;
    this.rankedPlayers = [];
    this.mapImage = null;
    if (!this.gameId) {
      this.loading = false;
      return;
    }
    try {
      const session = await fetchGameById(this.gameId);
      if (gen !== this.asyncGeneration) return;
      if (!session) return;
      this.gameInfo = session.info;
      this.ranking = new Ranking(session);
      this.updateRanking();
      this.loadMapImage(session.info.config.gameMap);
    } catch (err) {
      console.error("Failed to load game:", err);
    } finally {
      if (gen === this.asyncGeneration) this.loading = false;
    }
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

  private loadMapImage(gameMap: string) {
    try {
      const mapType = gameMap as GameMapType;
      const data = terrainMapFileLoader.getMapData(mapType);
      this.mapImage = data.webpPath;
    } catch (error) {
      console.error("Failed to load map image:", error);
    }
  }

  render(): TemplateResult {
    if (this.loading) {
      return renderLoadingSpinner(
        translateText("game_info_modal.loading_game_info"),
      );
    }
    if (this.rankedPlayers.length === 0) {
      return html`
        <div class="flex flex-col items-center justify-center p-6 text-white">
          <p class="mb-2">❌ ${translateText("game_info_modal.no_winner")}</p>
        </div>
      `;
    }
    return html`
      <div class="w-full max-w-125 mx-auto text-center">
        ${this.renderGameInfo()}
        <ranking-controls
          .rankType=${this.rankType}
          @sort=${this.sort}
        ></ranking-controls>
        ${this.renderSummaryTable()}
      </div>
    `;
  }

  private renderGameInfo() {
    const info = this.gameInfo;
    if (!info) {
      return html``;
    }
    return html`
      <div
        class="h-37.5 flex relative justify-between rounded-xl bg-black/20 items-center"
      >
        ${this.mapImage
          ? html`<img
              src="${this.mapImage}"
              class="absolute place-self-start col-span-full row-span-full h-full rounded-xl mask-[linear-gradient(to_left,transparent,#fff)] object-cover object-center"
            />`
          : html`<div
              class="place-self-start col-span-full row-span-full h-full rounded-xl bg-gray-300"
            ></div>`}
        <div class="text-right p-3 w-full">
          <div class="font-normal pl-1 pr-1">
            <span class="bg-white text-blue-800 font-normal pl-1 pr-1"
              >${info.config.gameMode}</span
            >
            <span class="font-bold">${info.config.gameMap}</span>
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
      this.rankedPlayers.length > 0
        ? (this.ranking?.score(this.rankedPlayers[0], this.rankType) ?? 0)
        : 0;
    return html`
      <ul>
        <ranking-header
          .rankType=${this.rankType}
          @sort=${this.sort}
        ></ranking-header>
        ${this.rankedPlayers.map(
          (player: PlayerInfo, index) => html`
            <player-row
              .player=${player}
              .rank=${index + 1}
              .score=${this.ranking?.score(player, this.rankType) ?? 0}
              .rankType=${this.rankType}
              .bestScore=${bestScore}
              .currentPlayer=${this.currentClientID === player.id}
            ></player-row>
          `,
        )}
      </ul>
    `;
  }
}
