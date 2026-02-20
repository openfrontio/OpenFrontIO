import { html, LitElement, nothing, type TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import {
  Duos,
  GameMapType,
  GameMode,
  HumansVsNations,
  PublicGameModifiers,
  Quads,
  Trios,
} from "../core/game/Game";
import { PublicGameInfo, PublicGames } from "../core/Schemas";
import { HostLobbyModal } from "./HostLobbyModal";
import { JoinLobbyModal } from "./JoinLobbyModal";
import { PublicLobbySocket } from "./LobbySocket";
import { JoinLobbyEvent } from "./Main";
import { SinglePlayerModal } from "./SinglePlayerModal";
import { terrainMapFileLoader } from "./TerrainMapFileLoader";
import { getMapName, renderDuration, translateText } from "./Utils";

const CARD_BG = "bg-sky-950";

@customElement("game-mode-selector")
export class GameModeSelector extends LitElement {
  @state() private lobbies: PublicGames | null = null;
  private serverTimeOffset: number = 0;

  private lobbySocket = new PublicLobbySocket((lobbies) =>
    this.handleLobbiesUpdate(lobbies),
  );

  createRenderRoot() {
    return this;
  }

  /**
   * Validates username input and shows error message if invalid.
   * Returns true if valid, false otherwise.
   */
  private validateUsername(): boolean {
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
      return false;
    }
    return true;
  }

  connectedCallback() {
    super.connectedCallback();
    this.lobbySocket.start();
  }

  disconnectedCallback() {
    this.stop();
    super.disconnectedCallback();
  }

  public stop() {
    this.lobbySocket.stop();
  }

  private handleLobbiesUpdate(lobbies: PublicGames) {
    this.lobbies = lobbies;
    this.serverTimeOffset = lobbies.serverTime - Date.now();
    document.dispatchEvent(
      new CustomEvent("public-lobbies-update", {
        detail: { payload: lobbies },
      }),
    );
    this.requestUpdate();
  }

  private getSortedLobbies(): PublicGameInfo[] {
    const ffa = this.lobbies?.games?.["ffa"]?.[0];
    const teams = this.lobbies?.games?.["team"]?.[0];
    const special = this.lobbies?.games?.["special"]?.[0];
    return [ffa, teams, special]
      .filter((g): g is PublicGameInfo => !!g)
      .sort((a, b) => a.startsAt - b.startsAt);
  }

  private getLobbyTitleContent(lobby: PublicGameInfo): string | TemplateResult {
    if (lobby === this.lobbies?.games?.["special"]?.[0]) {
      const subtitle = this.getLobbyTitle(lobby);
      const mainTitle = translateText("mode_selector.special_title");
      return subtitle
        ? html`
            <span class="block">${mainTitle}</span>
            <span class="block text-[10px] leading-tight text-white/70">
              ${subtitle}
            </span>
          `
        : mainTitle;
    }
    return this.getLobbyTitle(lobby);
  }

  render() {
    const sorted = this.getSortedLobbies();
    const featured = sorted[0];
    const upcoming = sorted.slice(1);

    return html`
      <div class="flex flex-col w-[90%] lg:max-w-xl mx-auto">
        <!-- Multiplayer Games -->
        ${featured
          ? html`<div
              class="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-2"
            >
              ${this.renderFeaturedLobbyCard(
                featured,
                this.getLobbyTitleContent(featured),
              )}
              <div class="flex flex-col gap-2">
                ${upcoming.map((lobby) =>
                  this.renderUpcomingLobbyCard(
                    lobby,
                    this.getLobbyTitleContent(lobby),
                  ),
                )}
              </div>
            </div>`
          : nothing}

        <!-- Solo - Primary CTA -->
        <div class="mt-4">${this.renderSingleplayerButton()}</div>

        <!-- Advanced Options -->
        <div class="mt-2">${this.renderSecondaryActions()}</div>
      </div>
    `;
  }

  private renderSingleplayerButton() {
    return html`
      <button
        @click=${this.openSinglePlayerModal}
        class="flex items-center justify-center w-full h-14 lg:h-16 rounded-lg bg-sky-600 hover:bg-sky-500 active:bg-sky-700 transition-colors text-lg lg:text-xl font-bold text-white uppercase tracking-widest"
      >
        ${translateText("main.solo")}
      </button>
    `;
  }

  private renderSecondaryActions() {
    return html`
      <div class="grid grid-cols-3 gap-2 h-10 lg:h-12">
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
    if (!this.validateUsername()) return;
    window.showPage?.("page-ranked");
  };

  private openSinglePlayerModal = () => {
    if (!this.validateUsername()) return;
    (
      document.querySelector("single-player-modal") as SinglePlayerModal
    )?.open();
  };

  private openHostLobby = () => {
    if (!this.validateUsername()) return;
    (document.querySelector("host-lobby-modal") as HostLobbyModal)?.open();
  };

  private openJoinLobby = () => {
    if (!this.validateUsername()) return;
    (document.querySelector("join-lobby-modal") as JoinLobbyModal)?.open();
  };

  private renderFeaturedLobbyCard(
    lobby: PublicGameInfo,
    titleContent: string | TemplateResult,
  ) {
    const mapType = lobby.gameConfig!.gameMap as GameMapType;
    const mapImageSrc = terrainMapFileLoader.getMapData(mapType).webpPath;
    const timeRemaining = Math.max(
      0,
      Math.floor((lobby.startsAt - this.serverTimeOffset - Date.now()) / 1000),
    );
    const timeDisplay = renderDuration(timeRemaining);
    const mapName = getMapName(lobby.gameConfig?.gameMap);
    const modifierLabels = this.getModifierLabels(
      lobby.gameConfig?.publicGameModifiers,
    );
    if (modifierLabels.length > 1) {
      modifierLabels.sort((a, b) => a.length - b.length);
    }

    return html`
      <button
        @click=${() => this.validateAndJoin(lobby)}
        class="group relative w-full aspect-square text-white uppercase rounded-2xl overflow-hidden transition-transform duration-200 hover:scale-[1.01] active:scale-[0.99] ring-1 ring-sky-400/30 shadow-[0_0_25px_-2px_rgba(56,189,248,0.2)] ${CARD_BG}"
      >
        ${mapImageSrc
          ? html`<img
              src="${mapImageSrc}"
              alt="${mapName ?? lobby.gameConfig?.gameMap ?? "map"}"
              draggable="false"
              class="absolute inset-0 w-full h-full object-contain object-center scale-[1.05] pointer-events-none"
            />`
          : null}
        <div
          class="absolute inset-x-2 top-2 flex items-start justify-between gap-2"
        >
          ${modifierLabels.length > 0
            ? html`<div class="flex flex-col items-start gap-1">
                ${modifierLabels.map(
                  (label) =>
                    html`<span
                      class="px-2.5 py-1 rounded text-xs font-bold uppercase tracking-widest bg-teal-600 text-white shadow-md"
                      >${label}</span
                    >`,
                )}
              </div>`
            : html`<div></div>`}
          <div class="shrink-0">
            ${timeRemaining > 0
              ? html`<span
                  class="text-xs font-bold uppercase tracking-widest bg-blue-600 px-2.5 py-1 rounded shadow-md"
                  >${timeDisplay}</span
                >`
              : html`<span
                  class="text-xs font-bold uppercase tracking-widest bg-green-600 px-2.5 py-1 rounded shadow-md"
                  >${translateText("public_lobby.starting_game")}</span
                >`}
          </div>
        </div>
        <div
          class="absolute inset-x-0 bottom-0 flex items-center justify-between px-4 py-4 bg-black/60 backdrop-blur-sm"
        >
          <div class="flex flex-col gap-1 min-w-0">
            <h3
              class="text-lg lg:text-2xl font-extrabold uppercase tracking-wider text-left leading-tight"
            >
              ${titleContent}
            </h3>
            ${mapName
              ? html`<p
                  class="text-sm text-white/90 uppercase tracking-wider text-left font-medium"
                >
                  ${mapName}
                </p>`
              : ""}
          </div>
          <span
            class="text-sm font-bold uppercase tracking-widest shrink-0 ml-2"
          >
            ${lobby.numClients}/${lobby.gameConfig?.maxPlayers}
          </span>
        </div>
      </button>
    `;
  }

  private renderUpcomingLobbyCard(
    lobby: PublicGameInfo,
    titleContent: string | TemplateResult,
  ) {
    const mapType = lobby.gameConfig!.gameMap as GameMapType;
    const mapImageSrc = terrainMapFileLoader.getMapData(mapType).webpPath;
    const timeRemaining = Math.max(
      0,
      Math.floor((lobby.startsAt - this.serverTimeOffset - Date.now()) / 1000),
    );
    const timeDisplay = renderDuration(timeRemaining);
    const mapName = getMapName(lobby.gameConfig?.gameMap);

    return html`
      <button
        @click=${() => this.validateAndJoin(lobby)}
        class="group relative w-full flex-1 text-white uppercase rounded-xl overflow-hidden transition-transform duration-200 hover:scale-[1.01] active:scale-[0.99] ${CARD_BG}"
      >
        ${mapImageSrc
          ? html`<img
              src="${mapImageSrc}"
              alt="${mapName ?? lobby.gameConfig?.gameMap ?? "map"}"
              draggable="false"
              class="absolute inset-0 w-full h-full object-contain object-center scale-[1.05] pointer-events-none saturate-[.25] brightness-[.8] group-hover:saturate-100 group-hover:brightness-100 transition-[filter] duration-300"
            />`
          : null}
        <div class="absolute top-1 right-1">
          ${timeRemaining > 0
            ? html`<span
                class="text-xs font-bold uppercase tracking-widest bg-blue-600 px-2 py-0.5 rounded shadow-md"
                >${timeDisplay}</span
              >`
            : html`<span
                class="text-xs font-bold uppercase tracking-widest bg-green-600 px-2 py-0.5 rounded shadow-md"
                >${translateText("public_lobby.starting_game")}</span
              >`}
        </div>
        <div
          class="absolute inset-x-0 bottom-0 flex items-center justify-between px-2.5 py-2.5 bg-black/60 backdrop-blur-sm"
        >
          <h3
            class="text-sm font-bold uppercase tracking-wider text-left leading-tight truncate"
          >
            ${titleContent}
          </h3>
          <span
            class="text-xs font-bold uppercase tracking-widest shrink-0 ml-1"
          >
            ${lobby.numClients}/${lobby.gameConfig?.maxPlayers}
          </span>
        </div>
      </button>
    `;
  }

  private renderSmallActionCard(title: string, onClick: () => void) {
    return html`
      <button
        @click=${onClick}
        class="flex items-center justify-center w-full h-full rounded-lg bg-slate-700 hover:bg-slate-600 active:bg-slate-800 transition-colors text-sm lg:text-base font-medium text-white uppercase tracking-wider text-center"
      >
        ${title}
      </button>
    `;
  }

  private validateAndJoin(lobby: PublicGameInfo) {
    if (!this.validateUsername()) return;

    this.dispatchEvent(
      new CustomEvent("join-lobby", {
        detail: {
          gameID: lobby.gameID,
          source: "public",
          publicLobbyInfo: lobby,
        } as JoinLobbyEvent,
        bubbles: true,
        composed: true,
      }),
    );
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

  private getLobbyTitle(lobby: PublicGameInfo): string {
    const config = lobby.gameConfig!;
    if (config.gameMode === GameMode.FFA) {
      return translateText("game_mode.ffa");
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
        const baseTitle = playersPerTeam
          ? translateText("mode_selector.teams_of", {
              teamCount: String(teamCount),
              playersPerTeam: String(playersPerTeam),
            })
          : translateText("mode_selector.teams_count", {
              teamCount: String(teamCount),
            });
        return `${baseTitle}${label ? ` (${label})` : ""}`;
      };

      switch (config.playerTeams) {
        case Duos: {
          const teamCount = totalPlayers
            ? Math.floor(totalPlayers / 2)
            : undefined;
          return teamCount
            ? translateText("public_lobby.teams_Duos", {
                team_count: String(teamCount),
              })
            : formatTeamsOf(undefined, 2);
        }
        case Trios: {
          const teamCount = totalPlayers
            ? Math.floor(totalPlayers / 3)
            : undefined;
          return teamCount
            ? translateText("public_lobby.teams_Trios", {
                team_count: String(teamCount),
              })
            : formatTeamsOf(undefined, 3);
        }
        case Quads: {
          const teamCount = totalPlayers
            ? Math.floor(totalPlayers / 4)
            : undefined;
          return teamCount
            ? translateText("public_lobby.teams_Quads", {
                team_count: String(teamCount),
              })
            : formatTeamsOf(undefined, 4);
        }
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
