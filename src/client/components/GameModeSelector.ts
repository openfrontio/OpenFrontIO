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

interface ModeCategory {
  id: string;
  title: string;
  subtitle: string;
  filterFn: (lobby: GameInfo) => boolean;
  fallbackAction: () => void;
  skipLobbyInfo?: boolean;
  backgroundImage?: string;
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

  private getModeCategories(): ModeCategory[] {
    return [
      {
        id: "ffa",
        title: translateText("mode_selector.ffa_title"),
        subtitle: translateText("mode_selector.ffa_subtitle"),
        filterFn: (lobby) =>
          lobby.publicLobbyCategory
            ? lobby.publicLobbyCategory === "ffa"
            : lobby.gameConfig?.gameMode === GameMode.FFA,
        fallbackAction: () =>
          this.openSinglePlayerModal({ gameMode: GameMode.FFA }),
      },
      {
        id: "teams",
        title: translateText("mode_selector.teams_title"),
        subtitle: translateText("mode_selector.teams_subtitle"),
        filterFn: (lobby) => {
          if (lobby.publicLobbyCategory) {
            return lobby.publicLobbyCategory === "teams";
          }
          const config = lobby.gameConfig;
          return (
            config?.gameMode === GameMode.Team &&
            config.playerTeams !== HumansVsNations
          );
        },
        fallbackAction: () =>
          this.openSinglePlayerModal({ gameMode: GameMode.Team }),
      },
      {
        id: "special",
        title: translateText("mode_selector.special_title"),
        subtitle: "",
        filterFn: (lobby) => lobby.publicLobbyCategory === "special",
        fallbackAction: () =>
          this.openSinglePlayerModal({ gameMode: GameMode.Team }),
      },
    ];
  }

  render() {
    const categories = this.getModeCategories();

    // Find lobbies for each category
    const ffaCategory = categories.find((c) => c.id === "ffa")!;
    const teamsCategory = categories.find((c) => c.id === "teams")!;
    const specialCategory = categories.find((c) => c.id === "special")!;

    const ffaLobbies = this.lobbies.filter(ffaCategory.filterFn);
    const teamsLobbies = this.lobbies.filter(teamsCategory.filterFn);
    const specialLobbies = this.lobbies.filter(specialCategory.filterFn);

    const getSoonestLobby = (lobbies: GameInfo[]) =>
      lobbies.length > 0
        ? lobbies.reduce((a, b) => {
            const aStart = this.lobbyIDToStart.get(a.gameID) ?? Infinity;
            const bStart = this.lobbyIDToStart.get(b.gameID) ?? Infinity;
            return aStart < bStart ? a : b;
          })
        : null;

    const ffaLobby = getSoonestLobby(ffaLobbies);
    const teamsLobby = getSoonestLobby(teamsLobbies);
    const specialLobby = getSoonestLobby(specialLobbies);

    return html`
      <div class="w-full space-y-6">
        <div class="grid grid-cols-2 gap-4">
          <!-- FFA -->
          ${ffaLobby
            ? this.renderLobbyCard(
                ffaLobby,
                this.getLobbyTitle(ffaLobby, ffaCategory.title),
              )
            : ""}
          <!-- Teams -->
          ${teamsLobby
            ? this.renderLobbyCard(
                teamsLobby,
                this.getLobbyTitle(teamsLobby, teamsCategory.title),
              )
            : ""}
          <!-- Special 24/7 -->
          ${specialLobby ? this.renderSpecialLobbyCard(specialLobby) : ""}
          <!-- Quick Actions section -->
          ${this.renderQuickActionsSection()}
        </div>
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
      <span class="block text-[0.55em] lg:text-[0.55em] text-white/70">
        ${sub}
      </span>
    `;
  }

  private getSpecialSubtitle(lobby: GameInfo): string {
    const config = lobby.gameConfig;
    if (!config) return "";

    // Check if it's HvN
    if (
      config.gameMode === GameMode.Team &&
      config.playerTeams === HumansVsNations
    ) {
      const humanSlots = config.maxPlayers ?? lobby.numClients;
      if (humanSlots) {
        return translateText("public_lobby.teams_hvn_detailed", {
          num: String(humanSlots),
        });
      }
      return translateText("public_lobby.teams_hvn");
    }

    // For other special modes, show the game mode
    if (config.gameMode === GameMode.FFA) {
      return translateText("mode_selector.ffa_title");
    }
    if (config.gameMode === GameMode.Team) {
      return translateText("mode_selector.teams_title");
    }

    return "";
  }

  private renderQuickActionsSection() {
    return html`
      <div class="grid grid-cols-2 gap-2 h-48 lg:h-56">
        ${this.renderSmallActionCard(
          translateText("main.solo"),
          "",
          () => this.openSinglePlayerModal(),
          false,
          "/images/GameplayScreenshot.png",
        )}
        ${this.renderSmallActionCard(
          translateText("mode_selector.ranked_title"),
          "",
          () => this.openRankedMenu(),
          false,
          "/maps/falklandislands/thumbnail.webp",
        )}
        ${this.renderSmallActionCard(
          translateText("main.create"),
          "",
          () => this.openHostLobby(),
          false,
          undefined,
          false,
        )}
        ${this.renderSmallActionCard(
          translateText("main.join"),
          "",
          () => this.openJoinLobby(),
          false,
          undefined,
          false,
        )}
      </div>
    `;
  }

  private openRankedMenu() {
    const id = "page-ranked";
    const modal = document.getElementById(id) as any;

    if (window.showPage) {
      window.showPage(id);
    } else if (modal) {
      document.getElementById("page-play")?.classList.add("hidden");
      modal.classList.remove("hidden");
      modal.classList.add("block");
    }

    modal?.open?.();
  }

  private openHostLobby() {
    const modal = document.querySelector("host-lobby-modal") as any;
    modal?.open();
  }

  private openJoinLobby() {
    const modal = document.querySelector("join-private-lobby-modal") as any;
    modal?.open();
  }

  private renderSmallActionCard(
    title: string,
    subtitle: string,
    onClick: () => void,
    disabled: boolean = false,
    backgroundImage?: string,
    showTextBackground: boolean = true,
  ) {
    return html`
      <button
        @click=${onClick}
        ?disabled=${disabled}
        class="group relative flex flex-col w-full h-full overflow-hidden rounded-xl transition-all duration-200 ${disabled
          ? "bg-[#376f9a]/40 cursor-not-allowed"
          : "bg-[#376f9a] hover:scale-[1.02] active:scale-[0.98]"} p-3 items-center justify-center gap-1"
      >
        ${backgroundImage
          ? html`
              <img
                src="${backgroundImage}"
                alt="${title}"
                class="absolute inset-0 w-full h-full object-cover object-center rounded-xl"
              />
            `
          : ""}
        <div class="relative z-10">
          <h3
            class="inline-block text-sm lg:text-base font-bold ${disabled
              ? "text-white/40"
              : "text-white"} uppercase tracking-wider leading-tight text-center px-3 py-2 rounded ${showTextBackground
              ? "bg-black/80"
              : ""}"
          >
            ${title}
          </h3>
          ${subtitle
            ? html`
                <p
                  class="text-[10px] ${disabled
                    ? "text-white/30"
                    : "text-white/60"} uppercase tracking-wider text-center"
                >
                  ${subtitle}
                </p>
              `
            : ""}
        </div>
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

    // Get modifier labels
    const modifierLabels = this.getModifierLabels(
      lobby.gameConfig?.publicGameModifiers,
    );

    return html`
      <button
        @click=${() => this.validateAndJoin(lobby)}
        class="group relative isolate flex flex-col w-full h-48 lg:h-56 overflow-hidden rounded-2xl transition-all duration-200 ${mapImageSrc
          ? "bg-[#376f9a]"
          : "bg-[#376f9a]"} hover:scale-[1.02] active:scale-[0.98]"
      >
        ${mapImageSrc
          ? html`
              <img
                src="${mapImageSrc}"
                alt="${mapName}"
                class="absolute inset-0 w-full h-full object-cover object-center rounded-2xl"
              />
            `
          : ""}

        <div
          class="relative z-10 flex flex-col h-full p-4 items-center justify-center gap-2"
        >
          <!-- Title -->
          <div class="flex flex-col items-center gap-1 text-center">
            <h3
              class="inline-block text-lg lg:text-xl font-bold text-white uppercase tracking-widest leading-tight px-3 py-2 rounded bg-black/80"
            >
              ${titleContent}
            </h3>
          </div>

          <!-- Lobby Info -->
          <div class="flex flex-col gap-2 mt-auto w-full px-3 py-2">
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
                    class="text-xs font-bold text-white uppercase tracking-wider text-center px-2 py-0.5 rounded bg-black/80 mx-auto"
                  >
                    ${mapName}
                  </p>
                `
              : ""}
            <div
              class="flex items-center justify-between w-full text-white -mx-2 -mb-1"
            >
              <!-- Player Count (bottom left) -->
              <div class="flex items-center gap-1">
                <span
                  class="text-xs font-bold uppercase tracking-widest px-2 py-0.5 rounded bg-black/80"
                >
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
              return translateText("public_lobby.teams_hvn_detailed", {
                num: String(humanSlots),
              });
            }
          }
          return translateText("public_lobby.teams_hvn");
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
