import { html, LitElement, type TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import {
  Duos,
  GameMapType,
  GameMode,
  HumansVsNations,
  PublicGameModifiers,
  Quads,
  Trios,
} from "../../core/game/Game";
import { GameID, GameInfo } from "../../core/Schemas";
import { getClientIDForGame } from "../Auth";
import { PublicLobbySocket } from "../LobbySocket";
import { JoinLobbyEvent } from "../Main";
import { terrainMapFileLoader } from "../TerrainMapFileLoader";
import { renderDuration, translateText } from "../Utils";

@customElement("game-mode-selector")
export class GameModeSelector extends LitElement {
  @state() private lobbies: GameInfo[] = [];
  @state() private mapImages: Map<GameID, string> = new Map();

  private lobbySocket = new PublicLobbySocket((lobbies) =>
    this.handleLobbiesUpdate(lobbies),
  );
  private lobbyIDToStart = new Map<GameID, number>();
  private updateIntervalId?: number;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.lobbySocket.start();
    // Update time remaining every second
    this.updateIntervalId = window.setInterval(
      () => this.requestUpdate(),
      1000,
    );
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.lobbySocket.stop();
    if (this.updateIntervalId !== undefined) {
      clearInterval(this.updateIntervalId);
    }
  }

  private handleLobbiesUpdate(lobbies: GameInfo[]) {
    this.lobbies = lobbies;

    document.dispatchEvent(
      new CustomEvent("public-lobbies-update", {
        detail: { lobbies },
      }),
    );

    // Get current lobby IDs
    const currentLobbyIDs = new Set(lobbies.map((l) => l.gameID));

    // Clean up old lobby data that's no longer in the list
    for (const gameID of this.lobbyIDToStart.keys()) {
      if (!currentLobbyIDs.has(gameID)) {
        this.lobbyIDToStart.delete(gameID);
      }
    }
    for (const gameID of this.mapImages.keys()) {
      if (!currentLobbyIDs.has(gameID)) {
        this.mapImages.delete(gameID);
      }
    }

    // Store start times and load map images
    this.lobbies.forEach((l) => {
      if (!this.lobbyIDToStart.has(l.gameID)) {
        const msUntilStart = l.msUntilStart ?? 0;
        this.lobbyIDToStart.set(l.gameID, msUntilStart + Date.now());
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

  private getSoonestLobby(filter: (l: GameInfo) => boolean): GameInfo | null {
    const lobbies = this.lobbies.filter(filter);
    if (lobbies.length === 0) return null;
    return lobbies.reduce((a, b) => {
      const aStart = this.lobbyIDToStart.get(a.gameID) ?? Infinity;
      const bStart = this.lobbyIDToStart.get(b.gameID) ?? Infinity;
      return aStart < bStart ? a : b;
    });
  }

  render() {
    const ffaLobby = this.getSoonestLobby(
      (l) =>
        l.publicLobbyCategory === "ffa" ||
        (!l.publicLobbyCategory && l.gameConfig?.gameMode === GameMode.FFA),
    );
    const teamsLobby = this.getSoonestLobby((l) => {
      if (l.publicLobbyCategory) return l.publicLobbyCategory === "teams";
      const config = l.gameConfig;
      return (
        config?.gameMode === GameMode.Team &&
        config.playerTeams !== HumansVsNations
      );
    });
    const specialLobby = this.getSoonestLobby(
      (l) => l.publicLobbyCategory === "special",
    );

    return html`
      <div class="grid grid-cols-2 gap-4 w-full">
        ${ffaLobby
          ? this.renderLobbyCard(ffaLobby, this.getLobbyTitle(ffaLobby))
          : ""}
        ${teamsLobby
          ? this.renderLobbyCard(teamsLobby, this.getLobbyTitle(teamsLobby))
          : ""}
        ${specialLobby ? this.renderSpecialLobbyCard(specialLobby) : ""}
        ${this.renderQuickActionsSection()}
      </div>
    `;
  }

  private renderSpecialLobbyCard(lobby: GameInfo) {
    const subtitle = this.getSpecialSubtitle(lobby);
    const titleContent = this.renderStackedTitle(
      translateText("mode_selector.special_title"),
      subtitle,
    );
    return this.renderLobbyCard(lobby, titleContent);
  }

  private renderStackedTitle(main: string, sub: string) {
    return html`
      <span class="block">${main}</span>
      <span class="block text-[0.55em] text-white/70">${sub}</span>
    `;
  }

  private getSpecialSubtitle(lobby: GameInfo): string {
    const config = lobby.gameConfig;
    if (!config) return "";

    if (
      config.gameMode === GameMode.Team &&
      config.playerTeams === HumansVsNations
    ) {
      const humanSlots = config.maxPlayers ?? lobby.numClients;
      return humanSlots
        ? translateText("public_lobby.teams_hvn_detailed", {
            num: String(humanSlots),
          })
        : translateText("public_lobby.teams_hvn");
    }

    if (config.gameMode === GameMode.FFA)
      return translateText("mode_selector.ffa_title");
    if (config.gameMode === GameMode.Team)
      return translateText("mode_selector.teams_title");
    return "";
  }

  private renderQuickActionsSection() {
    return html`
      <div class="grid grid-cols-2 gap-2 h-48 lg:h-56">
        ${this.renderSmallActionCard(
          translateText("main.solo"),
          this.openSinglePlayerModal,
        )}
        ${this.renderSmallActionCard(
          translateText("mode_selector.ranked_title"),
          this.openRankedMenu,
        )}
        ${this.renderSmallActionCard(
          translateText("main.create"),
          this.openHostLobby,
        )}
        ${this.renderSmallActionCard(
          translateText("main.join"),
          this.openJoinLobby,
        )}
      </div>
    `;
  }

  private openRankedMenu = () => {
    const modal = document.getElementById("page-ranked") as any;
    if (window.showPage) {
      window.showPage("page-ranked");
    } else if (modal) {
      document.getElementById("page-play")?.classList.add("hidden");
      modal.classList.remove("hidden");
      modal.classList.add("block");
    }
    modal?.open?.();
  };

  private openHostLobby = () => {
    (document.querySelector("host-lobby-modal") as any)?.open();
  };

  private openJoinLobby = () => {
    (document.querySelector("join-private-lobby-modal") as any)?.open();
  };

  private renderSmallActionCard(title: string, onClick: () => void) {
    return html`
      <button
        @click=${onClick}
        class="relative flex items-center justify-center w-full h-full rounded-xl overflow-hidden transition-transform hover:scale-[1.02] active:scale-[0.98]"
      >
        <div class="absolute inset-0 scale-110 bg-[#3f79a8]"></div>
        <div
          class="absolute inset-0 scale-110 bg-[linear-gradient(180deg,rgba(0,0,0,0.45),rgba(0,0,0,0.64))]"
        ></div>
        <h3
          class="relative z-10 text-sm lg:text-base font-bold text-white uppercase tracking-wider text-center"
        >
          ${title}
        </h3>
      </button>
    `;
  }

  private renderLobbyCard(
    lobby: GameInfo,
    titleContent: string | TemplateResult,
  ) {
    const mapImageSrc = this.mapImages.get(lobby.gameID);
    const start = this.lobbyIDToStart.get(lobby.gameID) ?? 0;
    const timeRemaining = Math.max(0, Math.floor((start - Date.now()) / 1000));
    const timeDisplay = renderDuration(timeRemaining);

    const mapName = translateText(
      `map.${lobby.gameConfig?.gameMap.toLowerCase().replace(/[\s.]+/g, "")}`,
    );

    const modifierLabels = this.getModifierLabels(
      lobby.gameConfig?.publicGameModifiers,
    );

    return html`
      <button
        @click=${() => this.validateAndJoin(lobby)}
        class="relative flex flex-col w-full h-48 lg:h-56 overflow-hidden rounded-2xl transition-transform hover:scale-[1.02] active:scale-[0.98]"
      >
        <div class="absolute inset-0 scale-110 bg-[#3f79a8]"></div>
        ${mapImageSrc
          ? html`<img
              src="${mapImageSrc}"
              alt="${mapName}"
              class="absolute inset-0 scale-110 w-full h-full object-cover"
            />`
          : ""}
        <div
          class="absolute inset-0 scale-110 bg-[linear-gradient(180deg,rgba(0,0,0,0.45),rgba(0,0,0,0.64))]"
        ></div>

        <div
          class="relative z-10 flex flex-col h-full p-4 items-center justify-center gap-2"
        >
          <h3
            class="text-lg lg:text-xl font-bold text-white uppercase tracking-widest text-center"
          >
            ${titleContent}
          </h3>

          <div class="flex flex-col gap-2 mt-auto w-full py-2">
            ${modifierLabels.length > 0
              ? html`
                  <div class="flex gap-1 flex-wrap justify-center">
                    ${modifierLabels.map(
                      (label) => html`
                        <span
                          class="px-2 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide bg-purple-600 text-white"
                        >
                          ${label}
                        </span>
                      `,
                    )}
                  </div>
                `
              : ""}
            ${mapName
              ? html`<p
                  class="text-xs font-bold text-white uppercase tracking-wider text-center"
                >
                  ${mapName}
                </p>`
              : ""}
            <div class="flex items-center justify-between w-full text-white">
              <span class="text-xs font-bold uppercase tracking-widest">
                ${lobby.numClients}/${lobby.gameConfig?.maxPlayers}
              </span>
              ${timeRemaining > 0
                ? html`<span
                    class="text-[10px] font-bold uppercase tracking-widest bg-blue-600 px-2 py-0.5 rounded"
                  >
                    ${timeDisplay}
                  </span>`
                : html`<span
                    class="text-[10px] font-bold uppercase tracking-widest bg-green-600 px-2 py-0.5 rounded animate-pulse"
                  >
                    ${translateText("public_lobby.starting_game")}
                  </span>`}
            </div>
          </div>
        </div>
      </button>
    `;
  }

  private validateAndJoin(lobby: GameInfo) {
    const usernameInput = document.querySelector("username-input") as any;
    if (usernameInput?.isValid?.() === false) {
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
      new CustomEvent("join-lobby", {
        detail: {
          gameID: lobby.gameID,
          clientID: getClientIDForGame(lobby.gameID),
          source: "public",
          publicLobbyInfo: lobby,
        } as JoinLobbyEvent,
        bubbles: true,
        composed: true,
      }),
    );
  }

  private openSinglePlayerModal = () => {
    (document.querySelector("single-player-modal") as any)?.open();
  };

  private getLobbyTitle(lobby: GameInfo): string {
    const config = lobby.gameConfig;
    if (!config) return "";
    return this.getBaseModeTitle(config, lobby);
  }

  private getModifierLabels(mods: PublicGameModifiers | undefined): string[] {
    if (!mods) return [];
    return [
      mods.isRandomSpawn && translateText("public_game_modifier.random_spawn"),
      mods.isCompact && translateText("public_game_modifier.compact_map"),
      mods.isCrowded && translateText("public_game_modifier.crowded"),
      mods.startingGold && translateText("public_game_modifier.starting_gold"),
    ].filter((x): x is string => !!x);
  }

  private getBaseModeTitle(
    config: GameInfo["gameConfig"],
    lobby: GameInfo,
  ): string {
    if (config?.gameMode === GameMode.FFA) {
      return translateText("mode_selector.ffa_title");
    }

    if (config?.gameMode === GameMode.Team) {
      const totalPlayers = config.maxPlayers ?? lobby.numClients ?? undefined;
      const formatTeamsOf = (
        teamCount: number | undefined,
        playersPerTeam: number | undefined,
        label?: string,
      ) => {
        if (!teamCount)
          return label ?? translateText("mode_selector.teams_title");
        if (playersPerTeam) {
          return `${teamCount} teams of ${playersPerTeam}${label ? ` (${label})` : ""}`;
        }
        return `${teamCount} teams${label ? ` (${label})` : ""}`;
      };

      switch (config.playerTeams) {
        case Duos:
          return formatTeamsOf(
            totalPlayers ? Math.floor(totalPlayers / 2) : undefined,
            2,
            "Duos",
          );
        case Trios:
          return formatTeamsOf(
            totalPlayers ? Math.floor(totalPlayers / 3) : undefined,
            3,
            "Trios",
          );
        case Quads:
          return formatTeamsOf(
            totalPlayers ? Math.floor(totalPlayers / 4) : undefined,
            4,
            "Quads",
          );
        case HumansVsNations: {
          const humanSlots = config.maxPlayers ?? lobby.numClients;
          return humanSlots
            ? translateText("public_lobby.teams_hvn_detailed", {
                num: String(humanSlots),
              })
            : translateText("public_lobby.teams_hvn");
        }
        default:
          if (typeof config.playerTeams === "number") {
            const teamCount = config.playerTeams;
            const playersPerTeam =
              totalPlayers && teamCount > 0
                ? Math.floor(totalPlayers / teamCount)
                : undefined;
            return formatTeamsOf(teamCount, playersPerTeam);
          }
      }
    }

    return "";
  }
}
