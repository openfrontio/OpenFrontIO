import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { Lobby } from "../core/Schemas";
import { Difficulty, GameMapType, GameType } from "../core/game/Game";
import { consolex } from "../core/Consolex";
import { getMapsImage } from "./utilities/Maps";

@customElement("public-lobby")
export class PublicLobby extends LitElement {
  @state() private lobbies: Lobby[] = [];
  @state() private isLobbyHighlighted: boolean = false;
  private currLobby: Lobby = null;
  private timer: NodeJS.Timeout | null = null;
  private nextFetch: NodeJS.Timeout | null = null;
  @state() private timeRemaining: number = 0;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.fetchAndUpdateLobbies();
  }

  disconnectedCallback() {
    super.disconnectedCallback();

    if (this.timer !== null) {
      clearTimeout(this.timer);
    }

    if (this.nextFetch !== null) {
      clearTimeout(this.nextFetch);
    }
  }

  private startTimer(lobby: Lobby) {
    if (this.timer !== null) {
      clearTimeout(this.timer);
    }

    this.timer = setInterval(() => {
      const lobby = this.lobbies[0];
      const timeRemaining = Math.max(
        0,
        Math.floor((lobby.msUntilStart -= 100) / 1000),
      );
      this.timeRemaining = timeRemaining;
      this.requestUpdate();
    }, 100);
  }

  private async fetchAndUpdateLobbies(): Promise<void> {
    try {
      let lobbies = [];
      while (lobbies.length === 0) {
        lobbies = await this.fetchLobbies();

        if (lobbies.length !== 0) {
          this.lobbies = lobbies;
          this.scheduleNextFetch(lobbies[0].msUntilStart + 200);
          this.startTimer(lobbies[0]);
        }
      }
    } catch (error) {
      consolex.error("Error fetching lobbies:", error);
    }
  }

  private scheduleNextFetch(msUntilStart: number): void {
    const timeRemaining = Math.max(0, msUntilStart);
    this.nextFetch = setTimeout(() => {
      this.fetchAndUpdateLobbies();
    }, timeRemaining + 300);
  }

  async fetchLobbies(): Promise<Lobby[]> {
    try {
      const response = await fetch("/lobbies");
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
    if (this.timer !== null) {
      clearTimeout(this.timer);
    }

    if (this.nextFetch !== null) {
      clearTimeout(this.nextFetch);
    }
  }

  render() {
    if (this.lobbies.length === 0) return html``;

    const lobby = this.lobbies[0];

    // Format time to show minutes and seconds
    const minutes = Math.floor(this.timeRemaining / 60);
    const seconds = this.timeRemaining % 60;
    const timeDisplay = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;

    return html`
      <button
        @click=${() => this.lobbyClicked(lobby)}
        class="w-full mx-auto p-4 md:p-6 ${this.isLobbyHighlighted
          ? "bg-gradient-to-r from-green-600 to-green-500"
          : "bg-gradient-to-r from-blue-600 to-blue-500"} text-white font-medium rounded-xl transition-opacity duration-200 hover:opacity-90"
      >
        <div class="text-lg md:text-2xl font-semibold mb-2">Next Game</div>
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

  private lobbyClicked(lobby: Lobby) {
    this.isLobbyHighlighted = !this.isLobbyHighlighted;
    if (this.currLobby == null) {
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
      this.currLobby = null;
    }
  }
}
