import { html, LitElement, nothing, type TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { ClientEnv } from "src/client/ClientEnv";
import {
  Duos,
  GameMapType,
  GameMode,
  HumansVsNations,
  Quads,
  Trios,
} from "../core/game/Game";
import { PublicGameInfo, PublicGames } from "../core/Schemas";
import type { BaseModal } from "./components/BaseModal";
import "./components/IOSAddToHomeScreenBanner";
import { lobbyCard, mapAspectRatios } from "./components/LobbyCard";
import { HostLobbyModal } from "./HostLobbyModal";
import { JoinLobbyModal } from "./JoinLobbyModal";
import { PublicLobbySocket } from "./LobbySocket";
import { JoinLobbyEvent } from "./Main";
import { SinglePlayerModal } from "./SinglePlayerModal";
import { UsernameInput } from "./UsernameInput";
import {
  calculateServerTimeOffset,
  getSecondsUntilServerTimestamp,
  renderDuration,
  translateText,
} from "./Utils";

/**
 * The scheduled lobby buckets the homepage shows one card each for. The keys
 * double as the lobby browser's tab keys, so a card can open its own tab.
 */
type LobbyBucket = "ffa" | "team" | "special";

const CARD_BG = "bg-surface";
const SECONDARY_CARD_BG =
  "bg-surface hover:brightness-[1.08] active:brightness-[0.95] hover:shadow-[var(--shadow-action-card-hover)]";

@customElement("game-mode-selector")
export class GameModeSelector extends LitElement {
  @state() private lobbies: PublicGames | null = null;
  @state() private inputValid: boolean = true;
  private serverTimeOffset: number = 0;
  private defaultLobbyTime: number = 0;

  private lobbySocket = new PublicLobbySocket((lobbies) =>
    this.handleLobbiesUpdate(lobbies),
  );

  createRenderRoot() {
    return this;
  }

  // Silent backstop; the buttons are already disabled while input is invalid.
  private validateUsername(): boolean {
    const usernameInput = document.querySelector(
      "username-input",
    ) as UsernameInput | null;
    return usernameInput ? usernameInput.canPlay() : true;
  }

  connectedCallback() {
    super.connectedCallback();
    this.lobbySocket.start();
    this.defaultLobbyTime = ClientEnv.gameCreationRate() / 1000;
    window.addEventListener(
      "username-validity-change",
      this.handleValidityChange,
    );
    // Pick up the current value in case username-input validated before us.
    const usernameInput = document.querySelector(
      "username-input",
    ) as UsernameInput | null;
    if (usernameInput) {
      this.inputValid = usernameInput.canPlay();
    }
  }

  disconnectedCallback() {
    this.stop();
    window.removeEventListener(
      "username-validity-change",
      this.handleValidityChange,
    );
    super.disconnectedCallback();
  }

  private handleValidityChange = (e: Event) => {
    this.inputValid = (e as CustomEvent).detail?.isValid ?? true;
  };

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
      mapAspectRatios.ensure(game.gameConfig?.gameMap as GameMapType, () =>
        this.requestUpdate(),
      );
    }
  }

  render() {
    const ffa = this.lobbies?.games?.["ffa"]?.[0];
    const teams = this.lobbies?.games?.["team"]?.[0];
    const special = this.lobbies?.games?.["special"]?.[0];

    return html`
      <div class="flex flex-col gap-4 w-full px-4 sm:px-0 mx-auto pb-4 sm:pb-0">
        <!-- iOS Add to Home Screen banner -->
        <ios-add-to-home-screen-banner
          class="no-crazygames"
        ></ios-add-to-home-screen-banner>

        <!-- Game cards grid -->
        ${this.lobbies === null
          ? html`<div
              class="flex items-center justify-center h-44 sm:h-[min(24rem,40vh)]"
            >
              <span
                class="w-24 h-24 border-[6px] border-blue-500/30 border-t-blue-500 rounded-full animate-spin"
              ></span>
            </div>`
          : html`<div
              class="grid grid-cols-1 sm:grid-cols-[2fr_1fr] gap-4 sm:h-[min(24rem,40vh)]"
            >
              <!-- Left col: main card (desktop only) -->
              ${ffa
                ? html`<div class="hidden sm:block">
                    ${this.renderLobbyCard(ffa, this.getLobbyTitle(ffa), "ffa")}
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
                      ${this.renderLobbyCard(
                        teams,
                        this.getLobbyTitle(teams),
                        "team",
                      )}
                    </div>`
                  : nothing}
              </div>

              <!-- Mobile: special, ffa, teams inline -->
              <div class="sm:hidden">
                ${special ? this.renderSpecialLobbyCard(special) : nothing}
              </div>
              <div class="sm:hidden">
                ${ffa
                  ? this.renderLobbyCard(ffa, this.getLobbyTitle(ffa), "ffa")
                  : nothing}
              </div>
              <div class="sm:hidden">
                ${teams
                  ? this.renderLobbyCard(
                      teams,
                      this.getLobbyTitle(teams),
                      "team",
                    )
                  : nothing}
              </div>
            </div>`}

        <!-- Solo takes a full row as the primary call to action, with Create,
             Ranked and Join below it. The block keeps its old placement: above
             the lobby grid on mobile, below it on desktop. -->
        <div class="flex flex-col gap-4 order-first sm:order-none">
          <div class="h-14">
            ${this.renderSmallActionCard(
              translateText("main.solo"),
              this.openSinglePlayerModal,
              "bg-malibu-blue hover:bg-aquarius active:bg-malibu-blue/80",
            )}
          </div>
          <div class="grid grid-cols-3 gap-4 h-14">
            ${this.renderSmallActionCard(
              translateText("main.create"),
              this.openHostLobby,
              SECONDARY_CARD_BG,
            )}
            ${this.renderSmallActionCard(
              translateText("mode_selector.ranked_title"),
              this.openRankedMenu,
              SECONDARY_CARD_BG,
            )}
            ${this.renderSmallActionCard(
              translateText("main.join"),
              this.openJoinLobby,
              SECONDARY_CARD_BG,
              this.hostedLobbyCount(),
            )}
          </div>
        </div>
      </div>
    `;
  }

  private renderSpecialLobbyCard(lobby: PublicGameInfo) {
    return this.renderLobbyCard(lobby, this.getLobbyTitle(lobby), "special");
  }

  private openRankedMenu = () => {
    if (!this.validateUsername()) return;
    window.showPage?.("page-ranked");
  };

  // Opens the lobby browser on the tab matching the card that was expanded, so
  // expanding the teams card lands on teams rather than the overview.
  private openDetailedView = (tab?: LobbyBucket) => {
    if (!this.validateUsername()) return;
    const modal = document.querySelector(
      "detailed-view-modal",
    ) as BaseModal | null;
    if (modal === null) {
      window.showPage?.("page-detailed-view");
      return;
    }
    modal.open(tab === undefined ? undefined : { tab });
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

  // Number of open hosted lobbies waiting in the browser; shown as a chip
  // on the Join button.
  private hostedLobbyCount(): number {
    return this.lobbies?.games?.hosted?.length ?? 0;
  }

  private renderSmallActionCard(
    title: string,
    onClick: () => void,
    bgClass: string = CARD_BG,
    badge?: number,
  ) {
    return html`
      <button
        @click=${onClick}
        ?disabled=${!this.inputValid}
        class="relative flex items-center justify-center w-full h-full rounded-lg ${bgClass} transition-all duration-200 text-sm lg:text-base font-medium text-white uppercase tracking-wider text-center ${!this
          .inputValid
          ? "opacity-50 cursor-not-allowed pointer-events-none"
          : ""}"
      >
        ${title}
        ${badge
          ? html`<span
              class="absolute -top-2 -right-2 min-w-[1.375rem] h-[1.375rem] px-1.5 flex items-center justify-center rounded-full bg-red-500 text-white text-xs font-bold tracking-normal"
              >${badge}</span
            >`
          : nothing}
      </button>
    `;
  }

  private renderLobbyCard(
    lobby: PublicGameInfo,
    titleContent: string | TemplateResult,
    bucket: LobbyBucket,
  ) {
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

    return lobbyCard({
      lobby,
      subtitle: titleContent,
      timeDisplay,
      timeDisplayUppercase,
      disabled: !this.inputValid,
      onClick: () => this.validateAndJoin(lobby),
      onExpand: () => this.openDetailedView(bucket),
      expandLabel: translateText("main.detailed_view"),
    });
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
