import { html, LitElement, TemplateResult } from "lit";
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

interface ModeCategory {
  id: string;
  title: string;
  subtitle: string;
  filterFn: (lobby: GameInfo) => boolean;
  fallbackAction: () => void;
  skipLobbyInfo?: boolean;
}

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

  private getModeCategories(): ModeCategory[] {
    return [
      {
        id: "ffa",
        title: translateText("mode_selector.ffa_title"),
        subtitle: translateText("mode_selector.ffa_subtitle"),
        filterFn: (lobby) =>
          lobby.gameConfig?.gameMode === GameMode.FFA &&
          !this.isSpecialLobby(lobby),
        fallbackAction: () =>
          this.openSinglePlayerModal({ gameMode: GameMode.FFA }),
      },
      {
        id: "teams",
        title: translateText("mode_selector.teams_title"),
        subtitle: translateText("mode_selector.teams_subtitle"),
        filterFn: (lobby) => {
          const config = lobby.gameConfig;
          return (
            config?.gameMode === GameMode.Team &&
            config.playerTeams !== HumansVsNations &&
            !this.isSpecialLobby(lobby)
          );
        },
        fallbackAction: () =>
          this.openSinglePlayerModal({ gameMode: GameMode.Team }),
      },
      {
        id: "solo",
        title: translateText("main.solo"),
        subtitle: translateText("mode_selector.solo_subtitle"),
        filterFn: () => false,
        fallbackAction: () => this.openSinglePlayerModal(),
        skipLobbyInfo: true,
      },
      {
        id: "other-more",
        title: translateText("mode_selector.other_title"),
        subtitle: translateText("mode_selector.other_subtitle"),
        filterFn: () => false,
        fallbackAction: () => this.openOtherMenu(),
        skipLobbyInfo: true,
      },
    ];
  }

  render() {
    const categories = this.getModeCategories();
    const cards: TemplateResult[] = [];

    // Generate one card per category
    for (const category of categories) {
      const matchingLobbies = this.lobbies.filter(category.filterFn);

      if (matchingLobbies.length > 0) {
        // Pick the lobby starting soonest
        const soonestLobby = matchingLobbies.reduce((a, b) => {
          const aStart = this.lobbyIDToStart.get(a.gameID) ?? Infinity;
          const bStart = this.lobbyIDToStart.get(b.gameID) ?? Infinity;
          return aStart < bStart ? a : b;
        });
        const dynamicTitle = this.getLobbyTitle(soonestLobby, category.title);
        cards.push(this.renderLobbyCard(soonestLobby, dynamicTitle));
      } else {
        // Add fallback card for this category
        cards.push(
          this.renderFallbackCard(
            category.title,
            category.subtitle,
            category.fallbackAction,
          ),
        );
      }
    }

    return html`
      <div class="w-full space-y-6">
        <!-- Dynamic Game Mode Grid: 2x2 -->
        <div class="grid grid-cols-2 gap-4">${cards}</div>
      </div>
    `;
  }

  private renderLobbyCard(lobby: GameInfo, modeTitle: string) {
    const mapImageSrc = this.mapImages.get(lobby.gameID);
    const start = this.lobbyIDToStart.get(lobby.gameID) ?? 0;
    const timeRemaining = Math.max(0, Math.floor((start - Date.now()) / 1000));
    const timeDisplay = renderDuration(timeRemaining);

    const mapName = translateText(
      `map.${lobby.gameConfig?.gameMap.toLowerCase().replace(/[\s.]+/g, "")}`,
    );

    // Get modifier labels
    const modifierLabels = this.getModifierLabels(
      lobby.gameConfig?.publicGameModifiers,
    );

    return html`
      <button
        @click=${() => this.validateAndJoin(lobby)}
        class="group relative isolate flex flex-col w-full h-48 lg:h-56 overflow-hidden rounded-2xl transition-all duration-200 ${mapImageSrc
          ? "bg-transparent"
          : `bg-slate-900/80 backdrop-blur-md`} hover:scale-[1.02] active:scale-[0.98]"
      >
        ${mapImageSrc
          ? html`
              <!-- Map Image Background -->
              <img
                src="${mapImageSrc}"
                alt="${mapName}"
                class="absolute inset-0 w-full h-full object-cover object-center"
              />
              <!-- Dark overlay for readability -->
              <div
                class="absolute inset-0 bg-gradient-to-b from-black/60 to-black/90"
              ></div>
            `
          : ""}

        <div
          class="relative z-10 flex flex-col h-full p-4 items-center justify-center gap-2"
        >
          <!-- Title -->
          <div class="flex flex-col items-center gap-1 text-center">
            <h3
              class="text-lg lg:text-xl font-bold text-white uppercase tracking-widest leading-tight"
            >
              ${modeTitle}
            </h3>
          </div>

          <!-- Lobby Info -->
          <div class="flex flex-col gap-2 mt-auto w-full">
            <!-- Modifier Badges -->
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
              ? html`
                  <p
                    class="text-xs font-bold text-white/80 uppercase tracking-wider text-center"
                  >
                    ${mapName}
                  </p>
                `
              : ""}
            <div class="flex items-center justify-between w-full text-white">
              <!-- Player Count (bottom left) -->
              <div class="flex items-center gap-1">
                <span class="text-xs font-bold uppercase tracking-widest">
                  ${lobby.numClients}/${lobby.gameConfig?.maxPlayers}
                </span>
              </div>
              <!-- Timer (bottom right) -->
              ${timeRemaining > 0
                ? html`
                    <span
                      class="text-[10px] font-bold uppercase tracking-widest bg-blue-600 text-white px-2 py-0.5 rounded"
                    >
                      ${timeDisplay}
                    </span>
                  `
                : html`
                    <span
                      class="text-[10px] font-bold uppercase tracking-widest bg-green-600 text-white px-2 py-0.5 rounded animate-pulse"
                    >
                      ${translateText("public_lobby.starting_game")}
                    </span>
                  `}
            </div>
          </div>
        </div>
      </button>
    `;
  }

  private renderFallbackCard(
    title: string,
    subtitle: string,
    onClick: () => void,
  ) {
    return html`
      <button
        @click=${onClick}
        class="group relative isolate flex flex-col w-full h-48 lg:h-56 overflow-hidden rounded-2xl transition-all duration-200 bg-slate-900/80 backdrop-blur-md hover:scale-[1.02] active:scale-[0.98] p-6 items-center justify-center gap-3"
      >
        <div class="flex flex-col items-center gap-1 text-center">
          <h3
            class="text-xl lg:text-2xl font-bold text-white uppercase tracking-widest leading-tight"
          >
            ${title}
          </h3>
          <p class="text-xs lg:text-sm text-white/60 uppercase tracking-wider">
            ${subtitle}
          </p>
        </div>
      </button>
    `;
  }

  private validateAndJoin(lobby: GameInfo) {
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

  private openSinglePlayerModal(config?: any) {
    const modal = document.querySelector("single-player-modal") as any;
    if (modal) {
      if (config) {
        modal.setInitialConfig(config);
      }
      modal.open();
    }
  }

  private openOtherMenu() {
    const id = "page-ranked-more";
    const submenu = document.getElementById(id) as any;

    if (window.showPage) {
      window.showPage(id);
    } else if (submenu) {
      document.getElementById("page-play")?.classList.add("hidden");
      submenu.classList.remove("hidden");
      submenu.classList.add("block");
    }

    submenu?.open?.();
  }

  private getLobbyTitle(lobby: GameInfo, fallback: string): string {
    const config = lobby.gameConfig;
    if (!config) return fallback;
    return this.getBaseModeTitle(config, lobby, fallback);
  }

  private getModifierLabels(
    publicGameModifiers: PublicGameModifiers | undefined,
  ): string[] {
    if (!publicGameModifiers) {
      return [];
    }
    const labels: string[] = [];
    if (publicGameModifiers.isRandomSpawn) {
      labels.push(translateText("public_game_modifier.random_spawn"));
    }
    if (publicGameModifiers.isCompact) {
      labels.push(translateText("public_game_modifier.compact_map"));
    }
    if (publicGameModifiers.isCrowded) {
      labels.push(translateText("public_game_modifier.crowded"));
    }
    if (publicGameModifiers.startingGold) {
      labels.push(translateText("public_game_modifier.starting_gold"));
    }
    return labels;
  }

  private getBaseModeTitle(
    config: GameInfo["gameConfig"],
    lobby: GameInfo,
    fallback: string,
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
        if (!teamCount) return label ?? fallback;
        if (playersPerTeam) {
          return `${teamCount} teams of ${playersPerTeam}${
            label ? ` (${label})` : ""
          }`;
        }
        return `${teamCount} teams${label ? ` (${label})` : ""}`;
      };

      switch (config.playerTeams) {
        case Duos: {
          const teamCount = totalPlayers
            ? Math.max(1, Math.floor(totalPlayers / 2))
            : undefined;
          return formatTeamsOf(teamCount, 2, "Duos");
        }
        case Trios: {
          const teamCount = totalPlayers
            ? Math.max(1, Math.floor(totalPlayers / 3))
            : undefined;
          return formatTeamsOf(teamCount, 3, "Trios");
        }
        case Quads: {
          const teamCount = totalPlayers
            ? Math.max(1, Math.floor(totalPlayers / 4))
            : undefined;
          return formatTeamsOf(teamCount, 4, "Quads");
        }
        case HumansVsNations:
          // maxPlayers in HvN represents human slots; nations fill the same amount
          {
            const humanSlots = config.maxPlayers ?? lobby.numClients;
            if (humanSlots) {
              return `${humanSlots} Humans vs ${humanSlots} Nations`;
            }
          }
          return "Humans vs Nations";
        default:
          if (typeof config.playerTeams === "number") {
            const teamCount = config.playerTeams;
            const playersPerTeam =
              totalPlayers && teamCount > 0
                ? Math.max(1, Math.floor(totalPlayers / teamCount))
                : undefined;
            return formatTeamsOf(teamCount, playersPerTeam);
          }
      }
    }

    return fallback;
  }

  private isSpecialLobby(lobby: GameInfo): boolean {
    const mods = lobby.gameConfig?.publicGameModifiers;
    if (!mods) return false;
    return !!(
      mods.isCompact ||
      mods.isRandomSpawn ||
      mods.isCrowded ||
      (mods.startingGold && mods.startingGold > 0)
    );
  }
}
