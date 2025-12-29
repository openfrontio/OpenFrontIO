import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { PlayerGame } from "../../../../core/ApiSchemas";
import { GameMode } from "../../../../core/game/Game";
import { GameInfoModal } from "../../../GameInfoModal";
import { translateText } from "../../../Utils";

@customElement("game-list")
export class GameList extends LitElement {
  static styles = css`
    .section-title {
      color: #888;
      font-size: 1rem;
      font-weight: bold;
      margin-bottom: 0.5rem;
    }
    .card {
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 0.5rem;
      overflow: hidden;
      transition: all 0.3s ease;
    }
    .row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.5rem 1rem;
    }
    .title {
      font-size: 0.875rem;
      font-weight: 600;
      color: white;
    }
    .subtle {
      font-size: 0.75rem;
      color: #9ca3af;
    }
    .btn {
      font-size: 0.875rem;
      color: #d1d5db;
      background: #374151;
      padding: 0.25rem 0.75rem;
      border-radius: 0.25rem;
    }
    .btn.secondary {
      background: #4b5563;
    }
    .details {
      padding: 0 1rem 0.5rem 1rem;
      font-size: 0.75rem;
      color: #d1d5db;
      transition: all 0.3s ease;
    }
  `;

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
        <div class="section-title">
          🎮 ${translateText("game_list.recent_games")}
        </div>
        <div class="flex flex-col gap-2">
          ${this.games.map(
            (game) => html`
              <div class="card">
                <div class="row">
                  <div>
                    <div class="title">
                      ${translateText("game_list.game_id")}: ${game.gameId}
                    </div>
                    <div class="subtle">
                      ${translateText("game_list.mode")}:
                      ${game.mode === GameMode.FFA
                        ? translateText("game_list.mode_ffa")
                        : html`${translateText("game_list.mode_team")}`}
                    </div>
                  </div>
                  <div class="flex gap-2">
                    <button
                      class="btn"
                      @click=${() => this.onViewGame?.(game.gameId)}
                    >
                      ${translateText("game_list.view")}
                    </button>
                    <button
                      class="btn secondary"
                      @click=${() => this.toggle(game.gameId)}
                    >
                      ${translateText("game_list.details")}
                    </button>
                    <button
                      class="btn secondary"
                      @click=${() => this.showRanking(game.gameId)}
                    >
                      ${translateText("game_list.ranking")}
                    </button>
                  </div>
                </div>
                <div
                  class="details"
                  style="max-height:${this.expandedGameId === game.gameId
                    ? "200px"
                    : "0"}; ${this.expandedGameId === game.gameId
                    ? ""
                    : "padding-top:0; padding-bottom:0;"}"
                >
                  <div>
                    <span class="title" style="font-size:0.75rem;"
                      >${translateText("game_list.started")}:</span
                    >
                    ${new Date(game.start).toLocaleString()}
                  </div>
                  <div>
                    <span class="title" style="font-size:0.75rem;"
                      >${translateText("game_list.mode")}:</span
                    >
                    ${game.mode === GameMode.FFA
                      ? translateText("game_list.mode_ffa")
                      : translateText("game_list.mode_team")}
                  </div>
                  <div>
                    <span class="title" style="font-size:0.75rem;"
                      >${translateText("game_list.map")}:</span
                    >
                    ${game.map}
                  </div>
                  <div>
                    <span class="title" style="font-size:0.75rem;"
                      >${translateText("game_list.difficulty")}:</span
                    >
                    ${game.difficulty}
                  </div>
                  <div>
                    <span class="title" style="font-size:0.75rem;"
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
