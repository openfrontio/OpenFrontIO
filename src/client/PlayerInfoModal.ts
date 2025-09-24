import { LitElement, html } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import {
  PlayerGame,
  PlayerStatsTree,
  UserMeResponse,
} from "../core/ApiSchemas";
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
        <!-- discord-user-header -->

        <!-- player-stats-tree-view -->

        <!-- game-list -->
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
