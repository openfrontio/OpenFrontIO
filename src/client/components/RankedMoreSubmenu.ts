import { html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { GameID, GameInfo } from "../../core/Schemas";
import {
  Duos,
  GameMapType,
  GameMode,
  HumansVsNations,
  Quads,
  Trios,
} from "../../core/game/Game";
import { getClientIDForGame, userAuth } from "../Auth";
import { JoinLobbyEvent } from "../Main";
import { terrainMapFileLoader } from "../TerrainMapFileLoader";
import { renderDuration, translateText } from "../Utils";
import { BaseModal } from "./BaseModal";
import { modalHeader } from "./ui/ModalHeader";

@customElement("ranked-more-submenu")
export class RankedMoreSubmenu extends BaseModal {
  @state() private lobbies: GameInfo[] = [];
  @state() private mapImages: Map<GameID, string> = new Map();

  private lobbyIDToStart = new Map<GameID, number>();
  private handleLobbiesUpdate = (e: Event) => {
    const lobbies = (e as CustomEvent).detail.lobbies as GameInfo[];
    this.lobbies = lobbies;
    this.lobbies.forEach((lobby) => {
      if (lobby.gameConfig && !this.mapImages.has(lobby.gameID)) {
        this.loadMapImage(lobby.gameID, lobby.gameConfig.gameMap);
      }
      if (lobby.msUntilStart !== undefined) {
        this.lobbyIDToStart.set(
          lobby.gameID,
          (lobby.msUntilStart ?? 0) + Date.now(),
        );
      }
    });
    this.requestUpdate();
  };

  constructor() {
    super();
    this.id = "page-ranked-more";
  }

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener(
      "public-lobbies-update",
      this.handleLobbiesUpdate,
    );
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener(
      "public-lobbies-update",
      this.handleLobbiesUpdate,
    );
  }

  render() {
    const hvnLobby = this.getHvnLobby();
    const specialLobby = this.getSpecialLobby();
    const content = html`
      <div
        class="h-full flex flex-col bg-black/40 backdrop-blur-md rounded-2xl border border-white/10 overflow-hidden select-none"
      >
        ${modalHeader({
          title: translateText("mode_selector.other_title"),
          onBack: this.close,
          ariaLabel: translateText("common.back"),
        })}
        <div class="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-6">
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            ${hvnLobby
              ? this.renderLobbyCard(
                  hvnLobby,
                  this.getLobbyTitle(
                    hvnLobby,
                    translateText("mode_selector.hvn_title"),
                  ),
                )
              : ""}
            ${specialLobby
              ? this.renderLobbyCard(
                  specialLobby,
                  this.getLobbyTitle(
                    specialLobby,
                    translateText("mode_selector.special_title"),
                  ),
                )
              : ""}
            ${this.renderCard(
              translateText("mode_selector.ranked_title"),
              translateText("mode_selector.ranked_subtitle"),
              () => this.handleRanked(),
            )}
            ${this.renderDisabledCard(
              translateText("mode_selector.ranked_2v2_title"),
              translateText("mode_selector.coming_soon"),
            )}
            ${this.renderCard(
              translateText("main.create"),
              translateText("mode_selector.create_subtitle"),
              () => this.openHostLobby(),
            )}
            ${this.renderCard(
              translateText("main.join"),
              translateText("mode_selector.join_subtitle"),
              () => this.openJoinLobby(),
            )}
          </div>
        </div>
      </div>
    `;

    if (this.inline) {
      return content;
    }

    return html`
      <o-modal ?hideHeader=${true} ?hideCloseButton=${true}>
        ${content}
      </o-modal>
    `;
  }

  private renderCard(title: string, subtitle: string, onClick: () => void) {
    return html`
      <button
        @click=${onClick}
        class="group relative isolate flex flex-col w-full h-28 sm:h-32 overflow-hidden rounded-2xl bg-slate-900/80 backdrop-blur-md border-0 shadow-none transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] p-6 items-center justify-center gap-3"
      >
        <div class="flex flex-col items-center gap-1 text-center">
          <h3
            class="text-lg sm:text-xl font-bold text-white uppercase tracking-widest leading-tight"
          >
            ${title}
          </h3>
          <p
            class="text-xs text-white/60 uppercase tracking-wider whitespace-pre-line leading-tight"
          >
            ${subtitle}
          </p>
        </div>
      </button>
    `;
  }

  private renderDisabledCard(title: string, subtitle: string) {
    return html`
      <div
        class="group relative isolate flex flex-col w-full h-28 sm:h-32 overflow-hidden rounded-2xl bg-slate-900/40 backdrop-blur-md border-0 shadow-none p-6 items-center justify-center gap-3 opacity-50 cursor-not-allowed"
      >
        <div class="flex flex-col items-center gap-1 text-center">
          <h3
            class="text-lg sm:text-xl font-bold text-white/60 uppercase tracking-widest leading-tight"
          >
            ${title}
          </h3>
          <p
            class="text-xs text-white/40 uppercase tracking-wider whitespace-pre-line leading-tight"
          >
            ${subtitle}
          </p>
        </div>
      </div>
    `;
  }

  private renderLobbyCard(lobby: GameInfo, modeTitle: string) {
    const titleContent = this.isSpecialLobby(lobby)
      ? this.renderStackedTitle(
          translateText("mode_selector.special_title"),
          modeTitle,
        )
      : modeTitle;
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
        class="group relative isolate flex flex-col w-full h-48 lg:h-56 overflow-hidden rounded-2xl transition-all duration-200 ${mapImageSrc
          ? "bg-transparent"
          : "bg-slate-900/80 backdrop-blur-md"} hover:scale-[1.02] active:scale-[0.98]"
      >
        ${mapImageSrc
          ? html`
              <img
                src="${mapImageSrc}"
                alt="${mapName}"
                class="absolute inset-0 w-full h-full object-cover object-center"
              />
              <div
                class="absolute inset-0 bg-gradient-to-b from-black/60 to-black/90"
              ></div>
            `
          : ""}

        <div
          class="relative z-10 flex flex-col h-full p-4 items-center justify-center gap-2"
        >
          <div class="flex flex-col items-center gap-1 text-center">
            <h3
              class="text-lg lg:text-xl font-bold text-white uppercase tracking-widest leading-tight"
            >
              ${titleContent}
            </h3>
          </div>

          <div class="flex flex-col gap-2 mt-auto w-full">
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
              <div class="flex items-center gap-1">
                <span class="text-xs font-bold uppercase tracking-widest">
                  ${lobby.numClients}/${lobby.gameConfig?.maxPlayers}
                </span>
              </div>
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

  private async handleRanked() {
    if ((await userAuth()) === false) {
      window.showPage?.("page-account");
      return;
    }

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

    window.showPage?.("page-matchmaking");
  }

  private openSinglePlayer(config?: any) {
    this.close();
    const modal = document.querySelector("single-player-modal") as any;
    if (modal) {
      if (config) {
        modal.setInitialConfig(config);
      }
      modal.open();
    }
  }

  private openHostLobby() {
    this.close();
    const modal = document.querySelector("host-lobby-modal") as any;
    modal?.open();
  }

  private openJoinLobby() {
    this.close();
    const modal = document.querySelector("join-private-lobby-modal") as any;
    modal?.open();
  }

  private getHvnLobby() {
    return this.lobbies.find((candidate) => {
      const config = candidate.gameConfig;
      return (
        config?.gameMode === GameMode.Team &&
        config.playerTeams === HumansVsNations
      );
    });
  }

  private getSpecialLobby() {
    return this.lobbies.find((candidate) => this.isSpecialLobby(candidate));
  }

  private getLobbyTitle(lobby: GameInfo, fallback: string): string {
    const config = lobby.gameConfig;
    if (!config) return fallback;

    return this.getBaseModeTitle(config, lobby, fallback);
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
        case HumansVsNations: {
          const humanSlots = config.maxPlayers ?? lobby.numClients;
          if (humanSlots) {
            return `${humanSlots} Humans vs ${humanSlots} Nations`;
          }
          return "Humans vs Nations";
        }
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

  private renderStackedTitle(main: string, sub: string) {
    return html`
      <span class="block">${main}</span>
      <span class="block text-[0.55em] lg:text-[0.55em] text-white/70">
        ${sub}
      </span>
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

  private isSpecialLobby(lobby: GameInfo): boolean {
    const mods = lobby.gameConfig?.publicGameModifiers;
    const hasCompact = mods?.isCompact ?? false;
    const hasStartingGold = (mods?.startingGold ?? 0) > 0;
    const hasRandomSpawn = mods?.isRandomSpawn ?? false;
    const hasCrowded = mods?.isCrowded ?? false;
    return [hasCompact, hasStartingGold, hasRandomSpawn, hasCrowded].some(
      Boolean,
    );
  }

  private getModifierLabels(publicGameModifiers: any | undefined): string[] {
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
}
