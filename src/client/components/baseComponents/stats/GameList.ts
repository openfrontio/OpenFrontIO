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
    return html` <div class="w-full">
      <div class="flex flex-col gap-3">
        ${this.games.map(
          (game) => html`
            <div
              class="bg-white/5 border border-white/5 rounded-xl overflow-hidden hover:bg-white/10 transition-all duration-200"
            >
              <div
                class="flex flex-col sm:flex-row sm:items-center justify-between px-4 py-3 gap-3"
              >
                <div class="flex items-center gap-4">
                  <div class="p-2 bg-blue-500/20 rounded-lg text-blue-400">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      class="w-5 h-5"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    >
                      <circle cx="12" cy="12" r="10"></circle>
                      <polygon points="10 8 16 12 10 16 10 8"></polygon>
                    </svg>
                  </div>
                  <div>
                    <div class="text-sm font-bold text-white tracking-wide">
                      ${new Date(game.start).toLocaleDateString()}
                    </div>
                    <div
                      class="text-xs text-blue-200/60 font-semibold uppercase tracking-wider"
                    >
                      ${translateText("game_list.mode")}:
                      ${game.mode === GameMode.FFA
                        ? translateText("game_list.mode_ffa")
                        : html`${translateText("game_list.mode_team")}`}
                    </div>
                  </div>
                </div>

                <div class="flex gap-2 self-end sm:self-auto">
                  <button
                    class="text-xs font-bold text-white bg-blue-600 hover:bg-blue-500 px-3 py-1.5 rounded-lg transition-colors shadow-lg shadow-blue-900/20"
                    @click=${() => this.onViewGame?.(game.gameId)}
                  >
                    ${translateText("game_list.replay")}
                  </button>
                  <button
                    class="text-xs font-bold text-gray-300 bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-lg transition-colors border border-white/5"
                    @click=${() => this.toggle(game.gameId)}
                  >
                    ${translateText("game_list.details")}
                  </button>
                  <button
                    class="text-xs font-bold text-gray-300 bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-lg transition-colors border border-white/5"
                    @click=${() => this.showRanking(game.gameId)}
                  >
                    ${translateText("game_list.ranking")}
                  </button>
                </div>
              </div>

              <div
                class="bg-black/20 border-t border-white/5 px-4 text-xs text-gray-400 transition-all duration-300 overflow-hidden"
                style="max-height:${this.expandedGameId === game.gameId
                  ? "200px"
                  : "0"}; opacity:${this.expandedGameId === game.gameId
                  ? "1"
                  : "0"}"
              >
                <div class="grid grid-cols-2 sm:grid-cols-4 gap-4 py-3">
                  <div>
                    <div
                      class="font-bold text-white uppercase tracking-wider text-[10px] mb-1"
                    >
                      ${translateText("game_list.game_id")}
                    </div>
                    <div class="text-white font-mono">${game.gameId}</div>
                  </div>
                  <div>
                    <div
                      class="font-bold text-white uppercase tracking-wider text-[10px] mb-1"
                    >
                      ${translateText("game_list.map")}
                    </div>
                    <div class="text-white">${game.map}</div>
                  </div>
                  <div>
                    <div
                      class="font-bold text-white uppercase tracking-wider text-[10px] mb-1"
                    >
                      ${translateText("game_list.difficulty")}
                    </div>
                    <div class="text-white">${game.difficulty}</div>
                  </div>
                  <div>
                    <div
                      class="font-bold text-white uppercase tracking-wider text-[10px] mb-1"
                    >
                      ${translateText("game_list.type")}
                    </div>
                    <div class="text-white">${game.type}</div>
                  </div>
                </div>
              </div>
            </div>
          `,
        )}
      </div>
    </div>`;
  }
}
