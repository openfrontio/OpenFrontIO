import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { GameMapType } from "../core/game/Game";
import { GameID, PublicGameInfo, PublicGames } from "../core/Schemas";
import { PublicLobbySocket } from "./LobbySocket";
import { terrainMapFileLoader } from "./TerrainMapFileLoader";
import {
  getGameModeLabel,
  getModifierLabels,
  normaliseMapKey,
  renderDuration,
  translateText,
} from "./Utils";

export interface ShowPublicLobbyModalEvent {
  lobby: PublicGameInfo;
}

@customElement("public-lobby")
export class PublicLobby extends LitElement {
  @state() private publicGames: PublicGames | null = null;
  @state() public isLobbyHighlighted: boolean = false;
  @state() private mapImages: Map<GameID, string> = new Map();

  private lobbyIDToStart = new Map<GameID, number>();
  private serverTimeOffset = 0;
  private lobbySocket = new PublicLobbySocket((data) =>
    this.handleLobbiesUpdate(data),
  );

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.lobbySocket.start();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.lobbySocket.stop();
  }

  private handleLobbiesUpdate(publicGames: PublicGames) {
    this.publicGames = publicGames;

    // Calculate offset between server time and client time
    if (this.publicGames) {
      this.serverTimeOffset = this.publicGames.serverTime - Date.now();
    }
    this.publicGames.games.forEach((l) => {
      if (!this.lobbyIDToStart.has(l.gameID)) {
        // Convert server's startsAt to client time by subtracting offset
        const startsAt = l.startsAt ?? Date.now();
        this.lobbyIDToStart.set(l.gameID, startsAt - this.serverTimeOffset);
      }

      if (l.gameConfig && !this.mapImages.has(l.gameID)) {
        this.loadMapImage(l.gameID, l.gameConfig.gameMap);
      }
    });
    this.requestUpdate();
  }

  private async loadMapImage(gameID: GameID, gameMap: string) {
    try {
      const mapType = gameMap as GameMapType;
      const data = terrainMapFileLoader.getMapData(mapType);
      this.mapImages.set(gameID, await data.webpPath());
      this.requestUpdate();
    } catch (error) {
      console.error("Failed to load map image:", error);
    }
  }

  render() {
    if (!this.publicGames) return html``;

    const lobby = this.publicGames.games[0];
    if (!lobby?.gameConfig) return html``;

    const start = this.lobbyIDToStart.get(lobby.gameID) ?? 0;
    const timeRemaining = Math.max(0, Math.floor((start - Date.now()) / 1000));
    const isStarting = timeRemaining <= 2;
    const timeDisplay = renderDuration(timeRemaining);

    const modeLabel = getGameModeLabel(lobby.gameConfig);
    const modifierLabels = getModifierLabels(
      lobby.gameConfig.publicGameModifiers,
    );
    const mapImageSrc = this.mapImages.get(lobby.gameID);

    return html`
      <button
        @click=${() => this.lobbyClicked(lobby)}
        class="group relative isolate flex flex-col w-full h-80 lg:h-96 overflow-hidden rounded-2xl transition-all duration-200 bg-[#3d7bab] hover:scale-[1.01] active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
      >
        <div class="font-sans w-full h-full flex flex-col">
          <!-- Main card gradient - stops before text -->
          <div class="absolute inset-0 pointer-events-none z-10"></div>

          <!-- Map Image Area with gradient overlay -->
          <div class="flex-1 w-full relative overflow-hidden">
            ${mapImageSrc
              ? html`<img
                  src="${mapImageSrc}"
                  alt="${lobby.gameConfig.gameMap}"
                  class="absolute inset-0 w-full h-full object-cover object-center z-10"
                />`
              : ""}
            <!-- Vignette overlay for dark edges -->
            <div class="pointer-events-none absolute inset-0 z-20"></div>
          </div>

          <!-- Mode Badge in top left -->
          ${modeLabel
            ? html`<span
                class="absolute top-4 left-4 px-4 py-1 rounded font-bold text-sm lg:text-base uppercase tracking-widest z-30 bg-slate-800 text-white ring-1 ring-white/10 shadow-sm"
              >
                ${modeLabel}
              </span>`
            : ""}

          <!-- Timer in top right -->
          ${timeRemaining > 0
            ? html`
                <span
                  class="absolute top-4 right-4 px-4 py-1 rounded font-bold text-sm lg:text-base tracking-widest z-30 bg-blue-600 text-white"
                >
                  ${timeDisplay}
                </span>
              `
            : html`<span
                class="absolute top-4 right-4 px-4 py-1 rounded font-bold text-sm lg:text-base uppercase tracking-widest z-30 bg-green-600 text-white"
              >
                ${translateText("public_lobby.started")}
              </span>`}

          <!-- Content Banner -->
          <div class="absolute bottom-0 left-0 right-0 z-20">
            <!-- Modifier badges placed just above the gradient overlay -->
            ${modifierLabels.length > 0
              ? html`<div
                  class="absolute -top-8 left-4 z-30 flex gap-2 flex-wrap"
                >
                  ${modifierLabels.map(
                    (label) => html`
                      <span
                        class="px-2 py-0.5 rounded text-xs font-medium uppercase tracking-wide bg-purple-600 text-white"
                      >
                        ${label}
                      </span>
                    `,
                  )}
                </div>`
              : html``}

            <!-- Gradient overlay for text area - adds extra darkening -->
            <div
              class="absolute inset-0 bg-gradient-to-b from-black/60 to-black/90 pointer-events-none"
            ></div>

            <div class="relative p-6 flex flex-col gap-2 text-left">
              <!-- Header row: Status/Join on left, Player Count on right -->
              <div class="flex items-center justify-between w-full">
                <div class="text-base uppercase tracking-widest text-white">
                  ${isStarting
                    ? html`<span class="text-green-400 animate-pulse"
                        >${translateText("public_lobby.starting_game")}</span
                      >`
                    : html`${translateText("public_lobby.join")}`}
                </div>

                <div class="flex items-center gap-2 text-white z-30">
                  <span class="text-base font-bold uppercase tracking-widest"
                    >${lobby.numClients}/${lobby.gameConfig.maxPlayers}</span
                  >
                  <svg
                    class="w-5 h-5 text-white"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      d="M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v3h8v-3zM6 8a2 2 0 11-4 0 2 2 0 014 0zM16 18v-3a5.972 5.972 0 00-.75-2.906A3.005 3.005 0 0119 15v3h-3zM4.75 12.094A5.973 5.973 0 004 15v3H1v-3a3 3 0 013.75-2.906z"
                    ></path>
                  </svg>
                </div>
              </div>

              <!-- Map Name - Full Width -->
              <div
                class="text-2xl lg:text-3xl font-bold text-white leading-none uppercase tracking-widest w-full"
              >
                ${translateText(
                  `map.${normaliseMapKey(lobby.gameConfig.gameMap)}`,
                )}
              </div>

              <!-- modifiers moved above gradient overlay -->
            </div>
          </div>
        </div>
      </button>
    `;
  }

  public stop() {
    this.lobbySocket.stop();
  }

  private lobbyClicked(lobby: PublicGameInfo) {
    // Validate username before opening the modal
    const usernameInput = document.querySelector("username-input") as any;
    if (
      usernameInput &&
      typeof usernameInput.isValid === "function" &&
      !usernameInput.isValid()
    ) {
      window.dispatchEvent(
        new CustomEvent("show-message", {
          detail: {
            message: usernameInput.validationError,
            color: "red",
            duration: 3000,
          },
        }),
      );
      return;
    }

    this.dispatchEvent(
      new CustomEvent("show-public-lobby-modal", {
        detail: { lobby } as ShowPublicLobbyModalEvent,
        bubbles: true,
        composed: true,
      }),
    );
  }
}
