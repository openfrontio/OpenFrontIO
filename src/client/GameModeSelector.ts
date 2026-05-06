import { html, LitElement, nothing, type TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { getRuntimeClientServerConfig } from "src/core/configuration/ConfigLoader";
import {
  Duos,
  GameMapType,
  GameMode,
  HumansVsNations,
  Quads,
  Trios,
} from "../core/game/Game";
import { PublicGameInfo, PublicGames } from "../core/Schemas";
import "./components/IOSAddToHomeScreenBanner";
import { crazyGamesSDK } from "./CrazyGamesSDK";
import { HostLobbyModal } from "./HostLobbyModal";
import { JoinLobbyModal } from "./JoinLobbyModal";
import { PublicLobbySocket } from "./LobbySocket";
import { JoinLobbyEvent } from "./Main";
import { SinglePlayerModal } from "./SinglePlayerModal";
import { terrainMapFileLoader } from "./TerrainMapFileLoader";
import { UsernameInput } from "./UsernameInput";
import {
  calculateServerTimeOffset,
  getMapName,
  getModifierLabels,
  getSecondsUntilServerTimestamp,
  renderDuration,
  translateText,
} from "./Utils";

const CARD_BG = "bg-surface";

@customElement("game-mode-selector")
export class GameModeSelector extends LitElement {
  @state() private lobbies: PublicGames | null = null;
  @state() private mapAspectRatios: Map<GameMapType, number> = new Map();
  private serverTimeOffset: number = 0;
  private defaultLobbyTime: number = 0;

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
    const usernameInput = document.querySelector(
      "username-input",
    ) as UsernameInput | null;
    return usernameInput ? usernameInput.validateOrShowError() : true;
  }

  connectedCallback() {
    super.connectedCallback();
    this.lobbySocket.start();
    getRuntimeClientServerConfig().then((config) => {
      this.defaultLobbyTime = config.gameCreationRate() / 1000;
    });
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
    this.serverTimeOffset = calculateServerTimeOffset(lobbies.serverTime);
    document.dispatchEvent(
      new CustomEvent("public-lobbies-update", {
        detail: { payload: lobbies },
      }),
    );
    this.requestUpdate();

    const allGames = Object.values(lobbies.games ?? {}).flat();
    for (const game of allGames) {
      const mapType = game.gameConfig?.gameMap as GameMapType;
      if (mapType && !this.mapAspectRatios.has(mapType)) {
        // New Map reference triggers Lit reactivity; placeholder ratio 1 lets
        // has() guard against duplicate in-flight fetches.
        this.mapAspectRatios = new Map(this.mapAspectRatios).set(mapType, 1);
        terrainMapFileLoader
          .getMapData(mapType)
          .manifest()
          .then((m: any) => {
            if (m?.map?.width && m?.map?.height) {
              this.mapAspectRatios = new Map(this.mapAspectRatios).set(
                mapType,
                m.map.width / m.map.height,
              );
            }
          })
          .catch((e) =>
            console.error(`Failed to load manifest for ${mapType}`, e),
          );
      }
    }
  }

  render() {
    const ffa = this.lobbies?.games?.["ffa"]?.[0];
    const teams = this.lobbies?.games?.["team"]?.[0];
    const special = this.lobbies?.games?.["special"]?.[0];

    return html`
      <div class="flex flex-col gap-4 w-full px-4 sm:px-0 mx-auto pb-4 sm:pb-0">
        <!-- Solo: mobile only, top -->
        <div class="sm:hidden h-14">
          ${this.renderSmallActionCard(
            translateText("main.solo"),
            this.openSinglePlayerModal,
            "bg-malibu-blue hover:bg-aquarius active:bg-malibu-blue/80",
          )}
        </div>
        <!-- Create/ranked/join: mobile only, below solo -->
        <div class="sm:hidden grid grid-cols-3 gap-4 h-14">
          ${this.renderSmallActionCard(
            translateText("main.create"),
            this.openHostLobby,
            "bg-surface hover:brightness-[1.08] active:brightness-[0.95] hover:scale-105 hover:shadow-[var(--shadow-lobby-card-hover)]",
          )}
          ${!crazyGamesSDK.isOnCrazyGames()
            ? this.renderSmallActionCard(
                translateText("mode_selector.ranked_title"),
                this.openRankedMenu,
                "bg-surface hover:brightness-[1.08] active:brightness-[0.95] hover:scale-105 hover:shadow-[var(--shadow-lobby-card-hover)]",
              )
            : html`<div class="invisible"></div>`}
          ${this.renderSmallActionCard(
            translateText("main.join"),
            this.openJoinLobby,
            "bg-surface hover:brightness-[1.08] active:brightness-[0.95] hover:scale-105 hover:shadow-[var(--shadow-lobby-card-hover)]",
          )}
        </div>
        <!-- iOS Add to Home Screen banner -->
        <ios-add-to-home-screen-banner></ios-add-to-home-screen-banner>

        <!-- Game cards grid -->
        <div
          class="grid grid-cols-1 sm:grid-cols-[2fr_1fr] gap-4 sm:h-[min(24rem,40vh)]"
        >
          <!-- Left col: main card (desktop only) -->
          ${ffa
            ? html`<div class="hidden sm:block">
                ${this.renderLobbyCard(ffa, this.getLobbyTitle(ffa))}
              </div>`
            : nothing}

          <!-- Right col: special + teams (desktop only) -->
          <div class="hidden sm:flex sm:flex-col sm:gap-4">
            ${special
              ? html`<div class="flex-1 min-h-0">
                  ${this.renderSpecialLobbyCard(special)}
                </div>`
              : nothing}
            ${teams
              ? html`<div class="flex-1 min-h-0">
                  ${this.renderLobbyCard(teams, this.getLobbyTitle(teams))}
                </div>`
              : nothing}
          </div>

          <!-- Mobile: special, ffa, teams inline -->
          <div class="sm:hidden">
            ${special ? this.renderSpecialLobbyCard(special) : nothing}
          </div>
          <div class="sm:hidden">
            ${ffa
              ? this.renderLobbyCard(ffa, this.getLobbyTitle(ffa))
              : nothing}
          </div>
          <div class="sm:hidden">
            ${teams
              ? this.renderLobbyCard(teams, this.getLobbyTitle(teams))
              : nothing}
          </div>
        </div>

        <!-- Solo: full width, desktop only -->
        <div class="hidden sm:block h-14">
          ${this.renderSmallActionCard(
            translateText("main.solo"),
            this.openSinglePlayerModal,
            "bg-malibu-blue hover:bg-aquarius active:bg-malibu-blue/80",
          )}
        </div>
        <!-- Bottom row: create + ranked + join (desktop only) -->
        <div class="hidden sm:grid grid-cols-3 gap-4 h-14">
          ${this.renderSmallActionCard(
            translateText("main.create"),
            this.openHostLobby,
            "bg-surface hover:brightness-[1.08] active:brightness-[0.95] hover:scale-105 hover:shadow-[var(--shadow-lobby-card-hover)]",
          )}
          ${!crazyGamesSDK.isOnCrazyGames()
            ? this.renderSmallActionCard(
                translateText("mode_selector.ranked_title"),
                this.openRankedMenu,
                "bg-surface hover:brightness-[1.08] active:brightness-[0.95] hover:scale-105 hover:shadow-[var(--shadow-lobby-card-hover)]",
              )
            : html`<div class="invisible"></div>`}
          ${this.renderSmallActionCard(
            translateText("main.join"),
            this.openJoinLobby,
            "bg-surface hover:brightness-[1.08] active:brightness-[0.95] hover:scale-105 hover:shadow-[var(--shadow-lobby-card-hover)]",
          )}
        </div>
      </div>
    `;
  }

  private renderSpecialLobbyCard(lobby: PublicGameInfo) {
    return this.renderLobbyCard(lobby, this.getLobbyTitle(lobby));
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

  private renderSmallActionCard(
    title: string,
    onClick: () => void,
    bgClass: string = CARD_BG,
  ) {
    return html`
      <button
        @click=${onClick}
        class="flex items-center justify-center w-full h-full rounded-lg ${bgClass} transition-all duration-200 text-sm lg:text-base font-medium text-white uppercase tracking-wider text-center"
      >
        ${title}
      </button>
    `;
  }

  private renderLobbyCard(
    lobby: PublicGameInfo,
    titleContent: string | TemplateResult,
  ) {
    const mapType = lobby.gameConfig!.gameMap as GameMapType;
    const mapImageSrc = terrainMapFileLoader.getMapData(mapType).webpPath;
    const aspectRatio = this.mapAspectRatios.get(mapType);
    // Use object-contain for extreme aspect ratios (e.g. Amazon River ~20:1) so
    // the full map is visible instead of being cropped by object-cover.
    const useContain =
      aspectRatio !== undefined && (aspectRatio > 4 || aspectRatio < 0.25);
    const timeRemaining = lobby.startsAt
      ? getSecondsUntilServerTimestamp(lobby.startsAt, this.serverTimeOffset)
      : undefined;

    let timeDisplay: string;
    let timeDisplayUppercase = false;
    if (timeRemaining === undefined) {
      timeDisplay = renderDuration(this.defaultLobbyTime);
    } else if (timeRemaining > 0) {
      timeDisplay = renderDuration(timeRemaining);
    } else {
      timeDisplay = translateText("public_lobby.starting_game");
      timeDisplayUppercase = true;
    }

    const mapName = getMapName(lobby.gameConfig?.gameMap);

    const modifierLabels = getModifierLabels(
      lobby.gameConfig?.publicGameModifiers,
    );
    // Sort by length for visual consistency (shorter labels first)
    if (modifierLabels.length > 1) {
      modifierLabels.sort((a, b) => a.length - b.length);
    }

    return html`
      <button
        @click=${() => this.validateAndJoin(lobby)}
        class="group relative w-full h-44 sm:h-full text-white uppercase rounded-2xl transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] bg-surface hover:shadow-[var(--shadow-lobby-card-hover)]"
      >
        <!-- Image clipped separately so overflow-hidden doesn't block absolute children -->
        <div
          class="absolute inset-0 rounded-2xl overflow-hidden pointer-events-none"
        >
          ${mapImageSrc
            ? html`<img
                src="${mapImageSrc}"
                alt="${mapName ?? lobby.gameConfig?.gameMap ?? "map"}"
                draggable="false"
                class="absolute inset-0 w-full h-full ${useContain
                  ? "object-contain"
                  : "object-cover object-center scale-[1.05]"} [image-rendering:auto]"
              />`
            : null}
        </div>
        <!-- Top row: modifiers + timer -->
        <div
          class="absolute inset-x-2 top-2 flex items-start justify-between gap-2"
        >
          ${modifierLabels.length > 0
            ? html`<div class="flex flex-col items-start gap-1 mt-[2px]">
                ${modifierLabels.map(
                  (label) =>
                    html`<span
                      class="px-2 py-1 rounded text-xs font-bold uppercase tracking-widest bg-malibu-blue text-white shadow-[var(--shadow-malibu-blue-pill)]"
                      >${label}</span
                    >`,
                )}
              </div>`
            : html`<div></div>`}
          <div class="shrink-0">
            <span
              class="text-xs font-bold tracking-widest ${timeDisplayUppercase
                ? "uppercase"
                : "normal-case"} bg-malibu-blue text-white px-2 py-1 rounded"
              >${timeDisplay}</span
            >
          </div>
        </div>
        <!-- Bottom bar: map name + mode, with player count floating above -->
        <div
          class="absolute bottom-0 left-0 right-0 flex flex-col px-3 py-2 bg-black/55 backdrop-blur-sm rounded-b-2xl"
          style="overflow: visible;"
        >
          <span
            class="absolute bottom-full right-2 mb-1 flex items-center gap-1 text-xs font-bold tracking-widest bg-black/70 backdrop-blur-sm px-2 py-0.5 rounded"
          >
            ${lobby.numClients}/${lobby.gameConfig?.maxPlayers}
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="h-4 w-4 inline-block"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path
                d="M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v3h8v-3zM6 8a2 2 0 11-4 0 2 2 0 014 0zM16 18v-3a5.972 5.972 0 00-.75-2.906A3.005 3.005 0 0119 15v3h-3zM4.75 12.094A5.973 5.973 0 004 15v3H1v-3a3 3 0 013.75-2.906z"
              ></path>
            </svg>
          </span>
          ${mapName
            ? html`<p
                class="text-sm sm:text-base font-bold uppercase tracking-wider text-left leading-tight"
              >
                ${mapName}
              </p>`
            : ""}
          <h3 class="text-xs text-white/70 uppercase tracking-wider text-left">
            ${titleContent}
          </h3>
        </div>
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
          return formatTeamsOf(teamCount, 2);
        }
        case Trios: {
          const teamCount = totalPlayers
            ? Math.floor(totalPlayers / 3)
            : undefined;
          return formatTeamsOf(teamCount, 3);
        }
        case Quads: {
          const teamCount = totalPlayers
            ? Math.floor(totalPlayers / 4)
            : undefined;
          return formatTeamsOf(teamCount, 4);
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
