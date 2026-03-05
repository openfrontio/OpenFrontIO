import { html, LitElement, nothing, type TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { GameMapType, GameMode, HumansVsNations } from "../core/game/Game";
import { PublicGameInfo, PublicGames } from "../core/Schemas";
import { HostLobbyModal } from "./HostLobbyModal";
import { JoinLobbyModal } from "./JoinLobbyModal";
import { PublicLobbySocket } from "./LobbySocket";
import { JoinLobbyEvent } from "./Main";
import { SinglePlayerModal } from "./SinglePlayerModal";
import { terrainMapFileLoader } from "./TerrainMapFileLoader";
import {
  getMapName,
  getModifierLabels,
  renderDuration,
  translateText,
} from "./Utils";

const CARD_BG = "bg-[color-mix(in_oklab,var(--frenchBlue)_70%,black)]";

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

  render() {
    const ffa = this.lobbies?.games?.["ffa"]?.[0];
    const teams = this.lobbies?.games?.["team"]?.[0];
    const special = this.lobbies?.games?.["special"]?.[0];

    return html`
      <div class="flex flex-col gap-4 w-[84%] lg:w-full mx-auto pb-4 lg:pb-0">
        <div class="order-first lg:order-none h-14 lg:hidden">
          ${this.renderSoloButton()}
        </div>
        <div
          class="grid grid-cols-1 lg:grid-cols-[3fr_2fr] lg:grid-rows-2 gap-4 lg:h-[28rem]"
        >
          ${ffa
            ? html`<div class="lg:row-span-2">
                ${this.renderLobbyCard(ffa, this.getLobbyTitle(ffa))}
              </div>`
            : nothing}
          ${teams
            ? this.renderLobbyCard(teams, this.getLobbyTitle(teams))
            : nothing}
          ${special ? this.renderSpecialLobbyCard(special) : nothing}
        </div>
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

  private renderSoloButton() {
    const title = translateText("main.solo");
    return html`
      <button
        @click=${this.openSinglePlayerModal}
        class="flex items-center justify-center w-full h-full rounded-xl bg-blue-600 border-0 transition-transform hover:scale-[1.02] active:scale-[0.98] text-sm lg:text-base font-bold text-white uppercase tracking-wider text-center"
      >
        ${title}
      </button>
    `;
  }

  private renderQuickActionsSection() {
    return html`
      <div class="flex flex-col gap-2">
        <div class="h-14 hidden lg:block">${this.renderSoloButton()}</div>
        <div class="grid grid-cols-3 gap-2 h-14">
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

  private renderLobbyCard(
    lobby: PublicGameInfo,
    titleContent: string | TemplateResult,
  ) {
    const mapType = lobby.gameConfig!.gameMap as GameMapType;
    const mapImageSrc = terrainMapFileLoader.getMapData(mapType).webpPath;
    const timeRemaining = lobby.startsAt
      ? Math.max(
          0,
          Math.floor(
            (lobby.startsAt - this.serverTimeOffset - Date.now()) / 1000,
          ),
        )
      : undefined;

    let timeDisplay: string = "";
    if (timeRemaining === undefined) {
      timeDisplay = "-s";
    } else if (timeRemaining > 0) {
      timeDisplay = renderDuration(timeRemaining);
    } else {
      timeDisplay = translateText("public_lobby.starting_game");
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
        class="group flex flex-col w-full h-44 lg:h-full text-white uppercase rounded-2xl overflow-hidden transition-transform duration-200 hover:scale-[1.02] active:scale-[0.98] ${CARD_BG}"
      >
        <div class="relative flex-1 overflow-hidden ${CARD_BG}">
          ${mapImageSrc
            ? html`<img
                src="${mapImageSrc}"
                alt="${mapName ?? lobby.gameConfig?.gameMap ?? "map"}"
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
              <span
                class="text-[10px] font-bold uppercase tracking-widest bg-blue-600 px-2 py-0.5 rounded"
                >${timeDisplay}</span
              >
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
    const config = lobby.gameConfig!;
    if (config.gameMode === GameMode.FFA) {
      return translateText("game_mode.ffa");
    }

    if (config?.gameMode === GameMode.Team) {
      if (config.playerTeams === HumansVsNations) {
        const humanSlots = config.maxPlayers ?? lobby.numClients;
        return humanSlots
          ? translateText("public_lobby.teams_hvn_detailed", {
              num: String(humanSlots),
            })
          : translateText("public_lobby.teams_hvn");
      }

      if (typeof config.playerTeams === "number") {
        const totalPlayers = config.maxPlayers ?? lobby.numClients ?? undefined;
        // Negative = players per team, resolve to team count
        const teamCount =
          config.playerTeams < 0 && totalPlayers
            ? Math.max(
                2,
                Math.floor(totalPlayers / Math.abs(config.playerTeams)),
              )
            : config.playerTeams;
        const playersPerTeam =
          totalPlayers && teamCount > 0
            ? Math.floor(totalPlayers / teamCount)
            : undefined;
        if (!teamCount) return translateText("mode_selector.teams_title");
        return playersPerTeam
          ? translateText("mode_selector.teams_of", {
              teamCount: String(teamCount),
              playersPerTeam: String(playersPerTeam),
            })
          : translateText("mode_selector.teams_count", {
              teamCount: String(teamCount),
            });
      }
    }

    return "";
  }
}
