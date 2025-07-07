import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { GameMapType, GameMode } from "../../core/game/Game";
import { terrainMapFileLoader } from "../../core/game/TerrainMapFileLoader";
import { GameID, GameInfo } from "../../core/Schemas";
import { generateID } from "../../core/Util";
import { JoinLobbyEvent } from "../Main";
import { translateText } from "../Utils";

@customElement("public-lobby")
export class PublicLobby extends LitElement {
  @state() private lobbies: GameInfo[] = [];
  @state() public isLobbyHighlighted: boolean = false;
  @state() private isButtonDebounced: boolean = false;
  @state() private mapImages: Map<GameID, string> = new Map();
  private lobbiesInterval: number | null = null;
  private currLobby: GameInfo | null = null;
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
          const msUntilStart = l.msUntilStart ?? 0;
          this.lobbyIDToStart.set(l.gameID, msUntilStart + Date.now());
        }
        // Load map image if not already loaded
        if (l.gameConfig && !this.mapImages.has(l.gameID)) {
          this.loadMapImage(l.gameID, l.gameConfig.gameMap);
        }
      });
    } catch (error) {
      console.error("Error fetching lobbies:", error);
    }
  }
  private async loadMapImage(gameID: GameID, gameMap: string) {
    try {
      // Convert string to GameMapType enum value
      const mapType = gameMap as GameMapType;
      const data = terrainMapFileLoader.getMapData(mapType);
      this.mapImages.set(gameID, await data.webpPath());
      this.requestUpdate();
    } catch (error) {
      console.error("Failed to load map image:", error);
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
      console.error("Error fetching lobbies:", error);
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
    const start = this.lobbyIDToStart.get(lobby.gameID) ?? 0;
    const timeRemaining = Math.max(0, Math.floor((start - Date.now()) / 1000));

    // Format time to show minutes and seconds
    const minutes = Math.floor(timeRemaining / 60);
    const seconds = timeRemaining % 60;
    const timeDisplay = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;

    const teamCount =
      lobby.gameConfig.gameMode === GameMode.Team
        ? lobby.gameConfig.playerTeams || 0
        : null;

    const isJoined = this.isLobbyHighlighted;
    const isTemporarilyDisabled = this.isButtonDebounced;
    const mapImageSrc = this.mapImages.get(lobby.gameID);

    return html`
      <button
        @click=${() => this.lobbyClicked(lobby)}
        class="background-panel p-4 h-full cursor-pointer transition-base duration-300 hover:backgroundDark hover:border-primary ${isJoined
          ? "border-primaryLighter has-grey"
          : ""} ${isTemporarilyDisabled ? "opacity-70 cursor-not-allowed" : ""}"
      >
        <div class="relative h-64 mb-4 ">
          ${mapImageSrc
            ? html`<img
                src="${mapImageSrc}"
                alt="${lobby.gameConfig.gameMap}"
                class="absolute inset-0 w-full h-full object-cover bg-backgroundDark"
                style="image-rendering: pixelated;"
              />`
            : html`<div
                class="place-self-start col-span-full row-span-full h-full -z-10 bg-gray-300"
              ></div>`}

          <div
            class="absolute inset-0 bg-gradient-to-t from-backgroundDark to-transparent "
          ></div>
          <div class="absolute bottom-0 left-0 p-4">
            <h3
              class="font-title text-large mb-2 transition-colors duration-300 ${isJoined
                ? "text-primaryLighter"
                : "text-textLight"}"
            >
              ${translateText(
                `map.${lobby.gameConfig.gameMap.toLowerCase().replace(/\s+/g, "")}`,
              )}
            </h3>
            <div class="flex flex-col  md:flex-row md:items-center gap-2">
              <span
                class="px-2 py-1 text-textLight text-xsmall font-title uppercase transition-colors duration-300 ${isJoined
                  ? "bg-primaryLighter"
                  : "bg-primary"}"
              >
                ${translateText(
                  isJoined ? "public_lobby.leave" : "public_lobby.join",
                )}
              </span>
              <span
                class="px-2 py-1 bg-green text-textLight text-xsmall font-title animate-pulse uppercase"
              >
                ${translateText("game_starting_modal.title")}
              </span>
              ${isJoined
                ? html`<span
                    class="px-2 py-1 bg-green text-textLight text-xsmall font-title animate-pulse"
                  >
                    ${translateText("private_lobby.joined_waiting")}
                  </span>`
                : null}
            </div>
          </div>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div
            class="background-panel p-3 transition-base duration-300 ${isJoined
              ? "has-grey border-base"
              : ""}"
          >
            <div class="flex items-center gap-2 mb-1">
              <o-icon
                src="icons/users.svg"
                size="medium"
                color="${isJoined
                  ? "var(--primary-color-lighter)"
                  : "var(--primary-color-lighter)"}"
              ></o-icon>
              <span class="font-title text-xsmall text-textGrey uppercase"
                >${translateText("private_lobby.players")}</span
              >
            </div>
            <p
              class="font-title transition-colors duration-300 ${isJoined
                ? "text-primaryLighter"
                : "text-textLight"}"
            >
              ${lobby.numClients}/${lobby.gameConfig.maxPlayers}
            </p>
          </div>
          <div
            class="background-panel p-3 transition-base duration-300 ${isJoined
              ? "has-grey border-primary"
              : ""}"
          >
            <div class="flex items-center gap-2 mb-1">
              <o-icon
                src="icons/dices.svg"
                size="medium"
                color="${isJoined
                  ? "var(--primary-color-lighter)"
                  : "var(--green-color)"}"
              ></o-icon>
              <span class="font-title text-xsmall text-textGrey uppercase"
                >${translateText("public_lobby.game_mode")}</span
              >
            </div>
            <p
              class="font-title transition-colors duration-300 ${isJoined
                ? "text-primaryLighter"
                : "text-textLight"}"
            >
              ${lobby.gameConfig.gameMode === GameMode.Team
                ? translateText("public_lobby.teams", { num: teamCount ?? 0 })
                : translateText("game_mode.ffa")}
            </p>
          </div>
          <div
            class="background-panel p-3 transition-all duration-300 ${isJoined
              ? "has-grey border-primary"
              : ""}"
          >
            <div class="flex items-center gap-2 mb-1">
              <o-icon
                src="icons/clock.svg"
                size="medium"
                color="${isJoined
                  ? "var(--primary-color-lighter)"
                  : "var(--orange-color)"}"
              ></o-icon>
              <span class="font-title text-xsmall text-textGrey uppercase"
                >${translateText("public_lobby.time")}</span
              >
            </div>
            <p
              class="font-title animate-pulse transition-colors duration-300 ${isJoined
                ? "text-primaryLighter"
                : "text-textLight"}"
            >
              ${timeDisplay}
            </p>
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

    if (this.currLobby === null) {
      this.isLobbyHighlighted = true;
      this.currLobby = lobby;
      this.dispatchEvent(
        new CustomEvent("join-lobby", {
          detail: {
            gameID: lobby.gameID,
            clientID: generateID(),
          } as JoinLobbyEvent,
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
