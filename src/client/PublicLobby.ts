import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { renderDuration, translateText } from "../client/Utils";
import { GameMapType, GameMode } from "../core/game/Game";
import { GameID, GameInfo } from "../core/Schemas";
import { generateID } from "../core/Util";
import { JoinLobbyEvent } from "./Main";
import { terrainMapFileLoader } from "./TerrainMapFileLoader";

@customElement("public-lobby")
export class PublicLobby extends LitElement {
  @state() private lobbies: GameInfo[] = [];
  @state() public isLobbyHighlighted: boolean = false;
  @state() private isButtonDebounced: boolean = false;
  @state() private mapImages: Map<GameID, string> = new Map();
  @state() private currentLobbyIndex: number = 0;
  private lobbiesInterval: number | null = null;
  private currLobby: GameInfo | null = null;
  private debounceDelay: number = 750;
  private lobbyIDToStart = new Map<GameID, number>();
  private isDragging: boolean = false;
  private startX: number = 0;
  private currentX: number = 0;
  private dragOffset: number = 0;
  private hasDragged: boolean = false;

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
      const previousLobbies = [...this.lobbies];
      this.lobbies = await this.fetchLobbies();

      // If we have a selected lobby, try to follow it in the carousel
      if (this.currLobby) {
        this.followSelectedLobby(previousLobbies);
      }

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
    // Hide the component when stopping
    this.style.display = "none";
  }

  render() {
    if (this.lobbies.length === 0) return html``;

    const lobbiesToShow = this.lobbies.slice(0, 3);

    return html`
      <div class="relative flex items-center">
        <!-- Left Arrow -->
        ${lobbiesToShow.length > 1
          ? html`
              <button
                @click=${this.previousLobby}
                class="absolute -left-12 top-1/2 transform -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white rounded-full w-10 h-10 flex items-center justify-center transition-colors z-20 disabled:opacity-30 disabled:cursor-not-allowed"
                ?disabled=${this.currentLobbyIndex === 0}
              >
                ←
              </button>
            `
          : ""}

        <!-- Carousel Container -->
        <div class="relative overflow-hidden rounded-xl flex-1">
          <!-- Lobby Display -->
          <div
            class="flex ${this.isDragging
              ? ""
              : "transition-transform duration-300 ease-in-out"}"
            style="transform: translateX(calc(-${this.currentLobbyIndex *
            100}% + ${this.dragOffset}px))"
            @mousedown=${this.handleMouseDown}
            @touchstart=${this.handleTouchStart}
          >
            ${lobbiesToShow.map(
              (lobby, index) =>
                html`<div
                  class="w-full flex-shrink-0"
                  @click=${(e: Event) => this.handleLobbyClick(e, lobby)}
                >
                  ${this.renderLobby(lobby, index)}
                </div>`,
            )}
          </div>
        </div>

        <!-- Right Arrow -->
        ${lobbiesToShow.length > 1
          ? html`
              <button
                @click=${this.nextLobby}
                class="absolute -right-12 top-1/2 transform -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white rounded-full w-10 h-10 flex items-center justify-center transition-colors z-20 disabled:opacity-30 disabled:cursor-not-allowed"
                ?disabled=${this.currentLobbyIndex >= lobbiesToShow.length - 1}
              >
                →
              </button>
            `
          : ""}

        <!-- Dots Indicator -->
        ${lobbiesToShow.length > 1
          ? html`
              <div
                class="absolute bottom-2 left-1/2 transform -translate-x-1/2 flex gap-2"
              >
                ${lobbiesToShow.map(
                  (_, index) => html`
                    <button
                      @click=${() => this.goToLobby(index)}
                      class="w-2 h-2 rounded-full transition-colors ${index ===
                      this.currentLobbyIndex
                        ? "bg-blue-300"
                        : "bg-white hover:bg-gray-400"}"
                    ></button>
                  `,
                )}
              </div>
            `
          : ""}
      </div>
    `;
  }

  private renderLobby(lobby: GameInfo, index: number) {
    if (!lobby?.gameConfig) {
      return html``;
    }

    const start = this.lobbyIDToStart.get(lobby.gameID) ?? 0;
    const timeRemaining = Math.max(0, Math.floor((start - Date.now()) / 1000));

    // Format time to show minutes and seconds
    const timeDisplay = renderDuration(timeRemaining);

    const teamCount =
      lobby.gameConfig.gameMode === GameMode.Team
        ? (lobby.gameConfig.playerTeams ?? 0)
        : null;

    const mapImageSrc = this.mapImages.get(lobby.gameID);
    const isCurrentLobby = this.currLobby?.gameID === lobby.gameID;

    return html`
      <div
        class="isolate grid h-40 grid-cols-[100%] grid-rows-[100%] place-content-stretch w-full overflow-hidden ${isCurrentLobby
          ? "bg-gradient-to-r from-green-600 to-green-500"
          : "bg-gradient-to-r from-blue-600 to-blue-500"} text-white font-medium rounded-xl transition-opacity duration-200 hover:opacity-90 cursor-pointer select-none"
      >
        ${mapImageSrc
          ? html`<img
              src="${mapImageSrc}"
              alt="${lobby.gameConfig.gameMap}"
              class="place-self-start col-span-full row-span-full h-full -z-10"
              style="mask-image: linear-gradient(to left, transparent, #fff)"
            />`
          : html`<div
              class="place-self-start col-span-full row-span-full h-full -z-10 bg-gray-300"
            ></div>`}
        <div
          class="flex flex-col justify-between h-full col-span-full row-span-full p-4 md:p-6 text-right z-0"
        >
          <div>
            <div class="text-lg md:text-2xl font-semibold">
              ${translateText("public_lobby.join")}
              ${index > 0
                ? html`<span class="text-sm opacity-75"> (#${index + 1})</span>`
                : ""}
            </div>
            <div class="text-md font-medium text-blue-100">
              <span
                class="text-sm ${isCurrentLobby
                  ? "text-green-600"
                  : "text-blue-600"} bg-white rounded-sm px-1"
              >
                ${lobby.gameConfig.gameMode === GameMode.Team
                  ? typeof teamCount === "string"
                    ? translateText(`public_lobby.teams_${teamCount}`)
                    : translateText("public_lobby.teams", {
                        num: teamCount ?? 0,
                      })
                  : translateText("game_mode.ffa")}</span
              >
              <span
                >${translateText(
                  `map.${lobby.gameConfig.gameMap.toLowerCase().replace(/\s+/g, "")}`,
                )}</span
              >
            </div>
          </div>

          <div>
            <div class="text-md font-medium text-blue-100">
              ${lobby.numClients} / ${lobby.gameConfig.maxPlayers}
            </div>
            <div class="text-md font-medium text-blue-100">${timeDisplay}</div>
          </div>
        </div>
      </div>
    `;
  }

  leaveLobby() {
    this.isLobbyHighlighted = false;
    this.currLobby = null;
  }

  private followSelectedLobby(previousLobbies: GameInfo[]) {
    if (!this.currLobby) return;

    const previousIndex = previousLobbies.findIndex(
      (lobby) => lobby.gameID === this.currLobby!.gameID,
    );
    const newIndex = this.lobbies.findIndex(
      (lobby) => lobby.gameID === this.currLobby!.gameID,
    );

    if (newIndex !== -1) {
      const wasShowingSelectedLobby = this.currentLobbyIndex === previousIndex;
      const lobbyMovedPosition =
        previousIndex !== newIndex && previousIndex !== -1;

      if (wasShowingSelectedLobby && lobbyMovedPosition) {
        const maxIndex = Math.min(this.lobbies.length - 1, 2); // Max 3 lobbies
        this.currentLobbyIndex = Math.min(newIndex, maxIndex);
      }
    } else {
      this.currLobby = null;
      this.isLobbyHighlighted = false;
    }
  }

  private nextLobby() {
    const maxIndex = Math.min(this.lobbies.length - 1, 2); // Max 3 lobbies
    if (this.currentLobbyIndex < maxIndex) {
      this.currentLobbyIndex++;
    }
  }

  private previousLobby() {
    if (this.currentLobbyIndex > 0) {
      this.currentLobbyIndex--;
    }
  }

  private goToLobby(index: number) {
    const maxIndex = Math.min(this.lobbies.length - 1, 2);
    this.currentLobbyIndex = Math.max(0, Math.min(index, maxIndex));
  }

  private handleMouseDown(e: MouseEvent) {
    this.isDragging = true;
    this.hasDragged = false;
    this.startX = e.clientX;
    this.currentX = e.clientX;
    this.dragOffset = 0;

    const handleMouseMove = (e: MouseEvent) => {
      if (!this.isDragging) return;
      this.currentX = e.clientX;
      this.dragOffset = this.currentX - this.startX;

      if (Math.abs(this.dragOffset) > 5) {
        this.hasDragged = true;
      }

      this.requestUpdate();
    };

    const handleMouseUp = () => {
      if (this.isDragging) {
        this.handleDragEnd();
      }
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }

  private handleTouchStart(e: TouchEvent) {
    this.isDragging = true;
    this.startX = e.touches[0].clientX;
    this.currentX = e.touches[0].clientX;

    const handleTouchMove = (e: TouchEvent) => {
      if (!this.isDragging) return;
      this.currentX = e.touches[0].clientX;
    };

    const handleTouchEnd = () => {
      if (this.isDragging) {
        this.handleDragEnd();
      }
      document.removeEventListener("touchmove", handleTouchMove);
      document.removeEventListener("touchend", handleTouchEnd);
    };

    document.addEventListener("touchmove", handleTouchMove);
    document.addEventListener("touchend", handleTouchEnd);
  }

  private handleDragEnd() {
    const deltaX = this.dragOffset;
    const threshold = 50;

    if (Math.abs(deltaX) > threshold) {
      if (deltaX > 0) {
        this.previousLobby();
      } else {
        this.nextLobby();
      }
    }

    this.isDragging = false;
    this.dragOffset = 0;
    this.requestUpdate();

    // Reset hasDragged after a short delay to prevent accidental clicks
    setTimeout(() => {
      this.hasDragged = false;
    }, 100);
  }

  private handleLobbyClick(e: Event, lobby: GameInfo) {
    if (this.hasDragged) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    this.lobbyClicked(lobby);
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
  }
}
