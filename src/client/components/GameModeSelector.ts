import { html, LitElement, nothing, type TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { until } from "lit/directives/until.js";
import {
  Duos,
  GameMapType,
  GameMode,
  HumansVsNations,
  PublicGameModifiers,
  Quads,
  Trios,
} from "../../core/game/Game";
import { PublicGameInfo, PublicGames } from "../../core/Schemas";
import { PublicLobbySocket } from "../LobbySocket";
import { JoinLobbyEvent } from "../Main";
import { terrainMapFileLoader } from "../TerrainMapFileLoader";
import { renderDuration, translateText } from "../Utils";

const CARD_BG = "bg-[color-mix(in_oklab,var(--frenchBlue)_70%,black)]";

@customElement("game-mode-selector")
export class GameModeSelector extends LitElement {
  @state() private lobbies: PublicGames | null = null;
  private timeOffset: number = 0;

  private lobbySocket = new PublicLobbySocket((lobbies) =>
    this.handleLobbiesUpdate(lobbies),
  );
  private updateIntervalId: number | null = null;

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
    // Update time remaining every second
    this.updateIntervalId = window.setInterval(
      () => this.requestUpdate(),
      1000,
    );
  }

  disconnectedCallback() {
    this.stop();
    super.disconnectedCallback();
  }

  public stop() {
    this.lobbySocket.stop();
    if (this.updateIntervalId !== null) {
      clearInterval(this.updateIntervalId);
      this.updateIntervalId = null;
    }
  }

  private handleLobbiesUpdate(lobbies: PublicGames) {
    this.lobbies = lobbies;
    // TODO: plus or minus?
    this.timeOffset = Date.now() - lobbies.serverTime;

    document.dispatchEvent(
      new CustomEvent("public-lobbies-update", {
        detail: { payload: lobbies },
      }),
    );
    this.requestUpdate();
  }

  render() {
    const ffa = this.lobbies?.games?.["ffa"]?.[0];
    const teams = this.lobbies?.games?.["team"]?.[0];
    const special = this.lobbies?.games?.["special"]?.[0];
    return html`
      <div
        class="grid grid-cols-1 lg:grid-cols-2 gap-4 w-[70%] lg:w-full mx-auto"
      >
        ${ffa
          ? until(this.renderLobbyCard(ffa, this.getLobbyTitle(ffa)), nothing)
          : nothing}
        ${teams
          ? until(
              this.renderLobbyCard(teams, this.getLobbyTitle(teams)),
              nothing,
            )
          : nothing}
        ${special
          ? until(this.renderSpecialLobbyCard(special), nothing)
          : nothing}
        ${this.renderQuickActionsSection()}
      </div>
    `;
  }

  private renderSpecialLobbyCard(lobby: PublicGameInfo) {
    const subtitle = this.getLobbyTitle(lobby);
    const mainTitle = translateText("mode_selector.special_title");
    const titleContent = subtitle
      ? html`
          <span class="block">${mainTitle}</span>
          <span class="block text-[10px] leading-tight text-white/70">
            ${subtitle}
          </span>
        `
      : mainTitle;
    return this.renderLobbyCard(lobby, titleContent);
  }

  private renderQuickActionsSection() {
    return html`
      <div class="grid grid-cols-2 gap-2 h-40 lg:h-56">
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
    if (!this.validateUsername()) return;

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

  private openSinglePlayerModal = () => {
    if (!this.validateUsername()) return;
    (document.querySelector("single-player-modal") as any)?.open();
  };

  private openHostLobby = () => {
    if (!this.validateUsername()) return;
    (document.querySelector("host-lobby-modal") as any)?.open();
  };

  private openJoinLobby = () => {
    if (!this.validateUsername()) return;
    (document.querySelector("join-lobby-modal") as any)?.open();
  };

  private renderSmallActionCard(title: string, onClick: () => void) {
    return html`
      <button
        @click=${onClick}
        class="flex items-center justify-center w-full h-full rounded-xl ${CARD_BG} border-0 transition-transform hover:scale-[1.02] active:scale-[0.98] text-sm lg:text-base font-bold text-white uppercase tracking-wider text-center"
      >
        ${title}
      </button>
    `;
  }

  private async renderLobbyCard(
    lobby: PublicGameInfo,
    titleContent: string | TemplateResult,
  ) {
    const mapType = lobby.gameConfig!.gameMap as GameMapType;
    const data = terrainMapFileLoader.getMapData(mapType);
    const mapImageSrc = await data.webpPath();
    // TODO: plus or minus
    const start = lobby.startsAt - this.timeOffset;
    const timeRemaining = Math.max(0, Math.floor((start - Date.now()) / 1000));
    const timeDisplay = renderDuration(timeRemaining);
    const gameMap = lobby.gameConfig?.gameMap;
    const mapName = gameMap
      ? translateText(`map.${gameMap.toLowerCase().replace(/[\s.]+/g, "")}`)
      : null;

    const modifierLabels = this.getModifierLabels(
      lobby.gameConfig?.publicGameModifiers,
    );
    // Sort by length for visual consistency (shorter labels first)
    if (modifierLabels.length > 1) {
      modifierLabels.sort((a, b) => a.length - b.length);
    }

    return html`
      <button
        @click=${() => this.validateAndJoin(lobby)}
        class="group flex flex-col w-full h-40 lg:h-56 text-white uppercase rounded-2xl overflow-hidden transition-transform duration-200 hover:scale-[1.02] active:scale-[0.98] ${CARD_BG}"
      >
        <div class="relative flex-1 overflow-hidden ${CARD_BG}">
          ${mapImageSrc
            ? html`<img
                src="${mapImageSrc}"
                alt="${mapName ?? gameMap ?? "map"}"
                draggable="false"
                class="absolute inset-0 w-full h-full object-contain object-center scale-[1.05] pointer-events-none"
              />`
            : null}
          <div
            class="absolute inset-x-2 bottom-2 flex items-end justify-between gap-2"
          >
            ${modifierLabels.length > 0
              ? html`<div class="flex flex-col items-start gap-1">
                  ${modifierLabels.map(
                    (label) =>
                      html`<span
                        class="px-2 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide bg-teal-600 text-white shadow-[0_0_6px_rgba(13,148,136,0.35)]"
                        >${label}</span
                      >`,
                  )}
                </div>`
              : html`<div></div>`}
            <div class="shrink-0">
              ${timeRemaining > 0
                ? html`<span
                    class="text-[10px] font-bold uppercase tracking-widest bg-blue-600 px-2 py-0.5 rounded"
                    >${timeDisplay}</span
                  >`
                : html`<span
                    class="text-[10px] font-bold uppercase tracking-widest bg-green-600 px-2 py-0.5 rounded"
                    >${translateText("public_lobby.starting_game")}</span
                  >`}
            </div>
          </div>
        </div>
        <div class="flex items-center justify-between px-3 py-2">
          <div class="flex flex-col gap-0.5 min-w-0">
            <h3
              class="text-sm lg:text-base font-bold uppercase tracking-wider text-left leading-tight"
            >
              ${titleContent}
            </h3>
            ${mapName
              ? html`<p
                  class="text-[10px] text-white/70 uppercase tracking-wider text-left"
                >
                  ${mapName}
                </p>`
              : ""}
          </div>
          <span
            class="text-xs font-bold uppercase tracking-widest shrink-0 ml-2"
          >
            ${lobby.numClients}/${lobby.gameConfig?.maxPlayers}
          </span>
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
    return this.getBaseModeTitle(lobby);
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

  private getBaseModeTitle(lobby: PublicGameInfo): string {
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
