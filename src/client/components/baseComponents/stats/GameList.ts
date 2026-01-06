import { LitElement, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { PlayerGame } from "../../../../core/ApiSchemas";
import { GameMode } from "../../../../core/game/Game";
import { GameInfoModal } from "../../../GameInfoModal";
import { translateText } from "../../../Utils";

@customElement("game-list")
export class GameList extends LitElement {
  createRenderRoot() {
    return this;
  }

  @property({ type: Array }) games: PlayerGame[] = [];
  @property({ attribute: false }) onViewGame?: (id: string) => void;

  @state() private expandedGameId: string | null = null;

  private toggle(gameId: string) {
    this.expandedGameId = this.expandedGameId === gameId ? null : gameId;
  }

  private showRanking(gameId: string) {
    const gameInfoModal = document.querySelector(
      "game-info-modal",
    ) as GameInfoModal;

    if (!gameInfoModal) {
      console.warn("Game info modal element not found");
    } else {
      gameInfoModal.loadGame(gameId);
      gameInfoModal.open();
    }
  }

  render() {
    return html` <div class="mt-4 w-full max-w-md">
      <div class="text-sm text-gray-400 font-semibold mb-1">
        <div class="text-gray-400 text-base font-bold mb-2">
          🎮 ${translateText("game_list.recent_games")}
        </div>
        <div class="flex flex-col gap-2">
          ${this.games.map(
            (game) => html`
              <div
                class="bg-white/5 border border-white/10 rounded-lg overflow-hidden transition-all duration-300"
              >
                <div class="flex items-center justify-between px-4 py-2">
                  <div>
                    <div class="text-sm font-semibold text-white">
                      ${translateText("game_list.game_id")}: ${game.gameId}
                    </div>
                    <div class="text-xs text-gray-400">
                      ${translateText("game_list.mode")}:
                      ${game.mode === GameMode.FFA
                        ? translateText("game_list.mode_ffa")
                        : html`${translateText("game_list.mode_team")}`}
                    </div>
                  </div>
                  <div class="flex gap-2">
                    <button
                      class="text-sm text-gray-300 bg-gray-700 px-3 py-1 rounded cursor-pointer"
                      @click=${() => this.onViewGame?.(game.gameId)}
                    >
                      ${translateText("game_list.view")}
                    </button>
                    <button
                      class="text-sm text-gray-300 bg-gray-600 px-3 py-1 rounded cursor-pointer"
                      @click=${() => this.toggle(game.gameId)}
                    >
                      ${translateText("game_list.details")}
                    </button>
                    <button
                      class="text-sm text-gray-300 bg-gray-600 px-3 py-1 rounded cursor-pointer"
                      @click=${() => this.showRanking(game.gameId)}
                    >
                      ${translateText("game_list.ranking")}
                    </button>
                  </div>
                </div>
                <div
                  class="px-4 pb-2 text-xs text-gray-300 transition-all duration-300"
                  style="max-height:${this.expandedGameId === game.gameId
                    ? "200px"
                    : "0"}; ${this.expandedGameId === game.gameId
                    ? ""
                    : "padding-top:0; padding-bottom:0;"}"
                >
                  <div class="flex items-center gap-1">
                    <span
                      class="text-sm font-semibold text-white"
                      style="font-size:0.75rem;"
                      >${translateText("game_list.started")}:</span
                    >
                    ${new Date(game.start).toLocaleString()}
                  </div>
                  <div class="flex items-center gap-1">
                    <span
                      class="text-sm font-semibold text-white"
                      style="font-size:0.75rem;"
                      >${translateText("game_list.mode")}:</span
                    >
                    ${game.mode === GameMode.FFA
                      ? translateText("game_list.mode_ffa")
                      : translateText("game_list.mode_team")}
                  </div>
                  <div class="flex items-center gap-1">
                    <span
                      class="text-sm font-semibold text-white"
                      style="font-size:0.75rem;"
                      >${translateText("game_list.map")}:</span
                    >
                    ${game.map}
                  </div>
                  <div class="flex items-center gap-1">
                    <span
                      class="text-sm font-semibold text-white"
                      style="font-size:0.75rem;"
                      >${translateText("game_list.difficulty")}:</span
                    >
                    ${game.difficulty}
                  </div>
                  <div class="flex items-center gap-1">
                    <span
                      class="text-sm font-semibold text-white"
                      style="font-size:0.75rem;"
                      >${translateText("game_list.type")}:</span
                    >
                    ${game.type}
                  </div>
                </div>
              </div>
            `,
          )}
        </div>
      </div>
    </div>`;
  }
}
