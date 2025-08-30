import "./components/baseComponents/stats/DiscordUserHeader";
import "./components/baseComponents/stats/GameList";
import "./components/baseComponents/stats/PlayerStatsTable";
import "./components/baseComponents/stats/PlayerStatsTree";
import { Difficulty, GameMode, GameType, isGameMode } from "../core/game/Game";
import { LitElement, html } from "lit";
import {
  PlayerGame,
  PlayerStatsTree,
  UserMeResponse,
} from "../core/ApiSchemas";
import { customElement, query, state } from "lit/decorators.js";
import { fetchPlayerById } from "./jwt";
import { translateText } from "./Utils";

@customElement("player-info-modal")
export class PlayerInfoModal extends LitElement {
  @query("o-modal") private readonly modalEl!: HTMLElement & {
    open: () => void;
    close: () => void;
  };

  @state() private userMeResponse: UserMeResponse | null = null;
  @state() private loadError: string | null = null;
  @state() private warningMessage: string | null = null;

  private statsTree: PlayerStatsTree | null = null;
  private recentGames: PlayerGame[] = [];

  private viewGame(gameId: string): void {
    this.close();
    const path = location.pathname;
    const { search } = location;
    const hash = `#join=${encodeURIComponent(gameId)}`;
    const newUrl = `${path}${search}${hash}`;

    history.pushState({ join: gameId }, "", newUrl);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  }

  createRenderRoot() {
    return this;
  }

  render() {
    return html`
      <o-modal
        id="playerInfoModal"
        title="${translateText("player_modal.title")}"
        alwaysMaximized
      >
        <div class="flex flex-col items-center mt-2 mb-4">
          ${this.loadError
            ? html`
                <div
                  class="w-full max-w-md mb-3 px-3 py-2 rounded border text-sm text-center"
                  style="
                    background: rgba(220,38,38,0.15);
                    border-color: rgba(248,113,113,0.6);
                    color: rgb(254,202,202);
                  "
                >
                  ${translateText(this.loadError)}
                </div>
              `
            : null}
          ${this.warningMessage
            ? html`
                <div
                  class="w-full max-w-md mb-3 px-3 py-2 rounded border text-sm text-center"
                  style="background: rgba(202,138,4,0.15); border-color: rgba(253,224,71,0.6); color: rgb(253,224,71);"
                >
                  ${translateText(this.warningMessage)}
                </div>
              `
            : null}
          <br />
          <discord-user-header
            .data=${this.userMeResponse?.user ?? null}
          ></discord-user-header>

          <player-stats-tree-view
            .statsTree=${this.statsTree}
          ></player-stats-tree-view>

          <hr class="w-2/3 border-gray-600 my-2" />

          <game-list
            .games=${this.recentGames}
            .onViewGame=${(id: string) => this.viewGame(id)}
          ></game-list>

        </div>
      </o-modal>
    `;
  }

  public open() {
    this.loadError = null;
    this.requestUpdate();
    this.modalEl?.open();
  }

  public close() {
    this.modalEl?.close();
  }

  onUserMe(userMeResponse: UserMeResponse | null) {
    this.userMeResponse = userMeResponse;
    const playerId = userMeResponse?.player?.publicId;
    if (playerId) {
      this.loadFromApi(playerId);
    } else {
      this.statsTree = null;
      this.recentGames = [];
      this.warningMessage = null;
      this.loadError = null;
    }
    this.requestUpdate();
  }

  private async loadFromApi(playerId: string): Promise<void> {
    try {
      this.loadError = null;

      const data = await fetchPlayerById(playerId);
      if (!data) {
        this.loadError = "player_modal.error.load";
        this.requestUpdate();
        return;
      }

      this.recentGames = data.games;
      this.statsTree = data.stats;

      this.requestUpdate();
    } catch (err) {
      console.warn("Failed to load player data:", err);
      this.loadError = "player_modal.error.load";
      this.requestUpdate();
    }
  }
}
