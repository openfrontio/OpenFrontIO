import { html, LitElement } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { GameEndInfo } from "../core/Schemas";
import { GameMapType } from "../core/game/Game";
import { fetchGameById } from "./Api";
import { terrainMapFileLoader } from "./TerrainMapFileLoader";
import { UsernameInput } from "./UsernameInput";
import { renderDuration, translateText } from "./Utils";
import {
  PlayerInfo,
  Ranking,
  RankType,
} from "./components/baseComponents/ranking/GameInfoRanking";
import "./components/baseComponents/ranking/PlayerRow";
import "./components/baseComponents/ranking/RankingControls";
import "./components/baseComponents/ranking/RankingHeader";

@customElement("game-info-modal")
export class GameInfoModal extends LitElement {
  @query("o-modal") private modalEl!: HTMLElement & {
    open: () => void;
    close: () => void;
  };

  @state() private mapImage: string | null = null;
  @state() private gameInfo: GameEndInfo | null = null;
  @state() private rankedPlayers: Array<PlayerInfo> = [];
  @property({ type: String }) gameId: string | null = null;
  @property({ type: String }) rankType = RankType.Lifetime;

  @state() private username: string | null = null;
  @state() private isLoadingGame: boolean = true;

  private ranking: Ranking | null = null;

  connectedCallback() {
    super.connectedCallback();
    this.updateRanking();
  }

  createRenderRoot() {
    return this;
  }

  render() {
    return html`
      <o-modal
        id="gameInfoModal"
        title="${translateText("game_info_modal.title")}"
        translationKey="main.game_info"
      >
        <div
          class="flex flex-col items-center pl-[100px] pr-[100px] text-center mb-4"
        >
          <div class="w-[300px] sm:w-[500px]">
            ${this.isLoadingGame
              ? this.renderLoadingAnimation()
              : this.renderRanking()}
          </div>
        </div>
      </o-modal>
    `;
  }

  private renderRanking() {
    if (this.rankedPlayers.length === 0) {
      return html`
        <div class="flex flex-col items-center justify-center p-6 text-white">
          <p class="mb-2">❌ ${translateText("game_info_modal.no_winner")}</p>
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

  private renderLoadingAnimation() {
    return html` <div
      class="flex flex-col items-center justify-center p-6 text-white"
    >
      <p class="mb-2">${translateText("game_info_modal.loading_game_info")}</p>
      <div
        class="w-6 h-6 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"
      ></div>
    </div>`;
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
    if (!info) {
      return html``;
    }
    return html`
      <div
        class="h-[150px] flex relative justify-between rounded-xl bg-blue-600 items-center"
      >
        ${this.mapImage
          ? html`<img
              src="${this.mapImage}"
              class="absolute place-self-start col-span-full row-span-full h-full rounded-xl"
              style="mask-image: linear-gradient(to left, transparent, #fff)"
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
      this.rankedPlayers.length > 0 ? this.score(this.rankedPlayers[0]) : 0;
    return html`
      <ul class="">
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
              .currentPlayer=${this.username === player.rawUsername}
            ></player-row>
          `,
        )}
      </ul>
    `;
  }

  public open() {
    this.modalEl?.open();
  }

  public close() {
    this.modalEl?.close();
  }

  private score(player: PlayerInfo): number {
    if (!this.ranking) return 0;
    return this.ranking.score(player, this.rankType);
  }

  private async loadMapImage(gameMap: string) {
    try {
      const mapType = gameMap as GameMapType;
      const data = terrainMapFileLoader.getMapData(mapType);
      this.mapImage = await data.webpPath();
    } catch (error) {
      console.error("Failed to load map image:", error);
    }
  }

  public loadUserName() {
    const usernameInput = document.querySelector(
      "username-input",
    ) as UsernameInput;
    if (usernameInput) {
      this.username = usernameInput.getCurrentUsername();
    }
  }

  public async loadGame(gameId: string) {
    try {
      this.isLoadingGame = true;
      this.loadUserName();
      const session = await fetchGameById(gameId);
      if (!session) return;

      this.gameInfo = session.info;
      this.ranking = new Ranking(session);
      this.updateRanking();
      this.isLoadingGame = false;
      await this.loadMapImage(session.info.config.gameMap);
    } catch (err) {
      console.error("Failed to load game:", err);
    } finally {
      this.isLoadingGame = false;
    }
  }
}
