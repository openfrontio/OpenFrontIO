import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { Difficulty, GameMapType, GameType } from "../core/game/Game";
import { consolex } from "../core/Consolex";
import { getMapsImage } from "./utilities/Maps";
import { GameID, GameInfo } from "../core/Schemas";

@customElement("public-lobby")
export class PublicLobby extends LitElement {
  @state() private lobbies: GameInfo[] = [];
  @state() public isLobbyHighlighted: boolean = false;
  @state() private isButtonDebounced: boolean = false;
  private lobbiesInterval: number | null = null;
  private currLobby: GameInfo = null;
  private debounceDelay: number = 750;
  private lobbyIDToStart = new Map<GameID, number>();

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.fetchAndUpdateLobbies();
    this.lobbiesInterval = window.setInterval(
      () => this.fetchAndUpdateLobbies(),
      1000,
    );
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this.lobbiesInterval !== null) {
      clearInterval(this.lobbiesInterval);
      this.lobbiesInterval = null;
    }
  }

  private async fetchAndUpdateLobbies(): Promise<void> {
    try {
      this.lobbies = await this.fetchLobbies();
      this.lobbies.forEach((l) => {
        // Store the start time on first fetch because endpoint is cached, causing
        // the time to appear irregular.
        if (!this.lobbyIDToStart.has(l.gameID)) {
          this.lobbyIDToStart.set(l.gameID, l.msUntilStart + Date.now());
        }
      });
    } catch (error) {
      consolex.error("Error fetching lobbies:", error);
    }
  }

  async fetchLobbies(): Promise<GameInfo[]> {
    try {
      const response = await fetch(`/api/public_lobbies`);
      if (!response.ok)
        throw new Error(`HTTP error! status: ${response.status}`);
      const data = await response.json();
      return data.lobbies;
    } catch (error) {
      consolex.error("Error fetching lobbies:", error);
      throw error;
    }
  }

  public stop() {
    if (this.lobbiesInterval !== null) {
      this.isLobbyHighlighted = false;
      clearInterval(this.lobbiesInterval);
      this.lobbiesInterval = null;
    }
  }

  render() {
    if (this.lobbies.length === 0) return html``;

    const lobby = this.lobbies[0];
    if (!lobby?.gameConfig) {
      return;
    }
    const timeRemaining = Math.max(
      0,
      Math.floor((this.lobbyIDToStart.get(lobby.gameID) - Date.now()) / 1000),
    );

    // Format time to show minutes and seconds
    const minutes = Math.floor(timeRemaining / 60);
    const seconds = timeRemaining % 60;
    const timeDisplay = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;

    return html`
      <button
        @click=${() => this.lobbyClicked(lobby)}
        ?disabled=${this.isButtonDebounced}
        class="w-full mx-auto p-4 md:p-6 ${this.isLobbyHighlighted
          ? "bg-gradient-to-r from-green-600 to-green-500"
          : "bg-gradient-to-r from-blue-600 to-blue-500"} text-white font-medium rounded-xl transition-opacity duration-200 hover:opacity-90 ${this
          .isButtonDebounced
          ? "opacity-70 cursor-not-allowed"
          : ""}"
      >
        <div class="text-lg md:text-2xl font-semibold mb-2">Join next Game</div>
        <div class="flex">
          <img
            src="${getMapsImage(lobby.gameConfig.gameMap)}"
            alt="${lobby.gameConfig.gameMap}"
            class="w-1/3 md:w-1/5 md:h-[80px]"
            style="border: 1px solid rgba(255, 255, 255, 0.5)"
          />
          <div
            class="w-full flex flex-col md:flex-row items-center justify-center gap-4"
          >
            <div class="flex flex-col items-start">
              <div class="text-md font-medium text-blue-100">
                ${lobby.gameConfig.gameMap}
              </div>
            </div>
            <div class="flex flex-col items-start">
              <div class="text-md font-medium text-blue-100">
                ${lobby.numClients}
                ${lobby.numClients === 1 ? "Player" : "Players"} waiting
              </div>
            </div>
            <div class="flex items-center">
              <div
                class="min-w-20 text-sm font-medium px-2 py-1 bg-white/10 rounded-xl text-blue-100 text-center"
              >
                ${timeDisplay}
              </div>
            </div>
          </div>
        </div>
      </button>
    `;
  }

  leaveLobby() {
    this.isLobbyHighlighted = false;
    this.currLobby = null;
  }

  private lobbyClicked(lobby: GameInfo) {
    if (this.isButtonDebounced) {
      return;
    }

    // Set debounce state
    this.isButtonDebounced = true;

    // Reset debounce after delay
    setTimeout(() => {
      this.isButtonDebounced = false;
    }, this.debounceDelay);

    if (this.currLobby == null) {
      this.isLobbyHighlighted = true;
      this.currLobby = lobby;
      this.dispatchEvent(
        new CustomEvent("join-lobby", {
          detail: {
            lobby,
            gameType: GameType.Public,
            map: GameMapType.World,
            difficulty: Difficulty.Medium,
          },
          bubbles: true,
          composed: true,
        }),
      );
    } else {
      this.dispatchEvent(
        new CustomEvent("leave-lobby", {
          detail: { lobby: this.currLobby },
          bubbles: true,
          composed: true,
        }),
      );
      this.leaveLobby();
    }
  }
}
