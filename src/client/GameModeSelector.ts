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
import "./components/IOSAddToHomeScreenBanner";
import { lobbyCard, mapAspectRatios } from "./components/LobbyCard";
import { multiplayerAllowed, type DesktopUpdateState } from "./DesktopShell";
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

const CARD_BG = "bg-surface";

/**
 * Whether a multiplayer entry point should refuse to act. Exported for tests
 * and kept free of component state so the rule is checkable in isolation.
 * A null state means no desktop shell (the web build), so nothing is gated.
 */
export function shouldBlockMultiplayerAction(
  state: DesktopUpdateState | null,
): boolean {
  if (state === null) return false;
  return !multiplayerAllowed(state);
}

@customElement("game-mode-selector")
export class GameModeSelector extends LitElement {
  @state() private lobbies: PublicGames | null = null;
  @state() private inputValid: boolean = true;
  @state() private desktopUpdateState: DesktopUpdateState | null = null;
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
    document.addEventListener(
      "desktop-update-state",
      this.onDesktopUpdateState,
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
    document.removeEventListener(
      "desktop-update-state",
      this.onDesktopUpdateState,
    );
    super.disconnectedCallback();
  }

  private handleValidityChange = (e: Event) => {
    this.inputValid = (e as CustomEvent).detail?.isValid ?? true;
  };

  private onDesktopUpdateState = (e: Event) => {
    this.desktopUpdateState = (e as CustomEvent<DesktopUpdateState>).detail;
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
        <!-- Solo + detailed view: mobile only, top. The lobby browser is one
             column wide, matching Join Lobby below it. -->
        <div class="sm:hidden grid grid-cols-3 gap-4 h-14">
          <div class="col-span-2">
            ${this.renderSmallActionCard(
              translateText("main.solo"),
              this.openSinglePlayerModal,
              "bg-malibu-blue hover:bg-aquarius active:bg-malibu-blue/80 hover:scale-y-105 hover:scale-x-[1.01]",
            )}
          </div>
          ${this.renderSmallActionCard(
            translateText("main.detailed_view"),
            this.openDetailedView,
            "bg-surface hover:brightness-[1.08] active:brightness-[0.95] hover:scale-105 hover:shadow-[var(--shadow-action-card-hover)]",
          )}
        </div>
        <!-- Create/ranked/join: mobile only, below solo -->
        <div class="sm:hidden grid grid-cols-3 gap-4 h-14">
          ${this.renderSmallActionCard(
            translateText("main.create"),
            this.openHostLobby,
            "bg-surface hover:brightness-[1.08] active:brightness-[0.95] hover:scale-105 hover:shadow-[var(--shadow-action-card-hover)]",
            undefined,
            true,
          )}
          ${this.renderSmallActionCard(
            translateText("mode_selector.ranked_title"),
            this.openRankedMenu,
            "bg-surface hover:brightness-[1.08] active:brightness-[0.95] hover:scale-105 hover:shadow-[var(--shadow-action-card-hover)]",
            undefined,
            true,
          )}
          ${this.renderSmallActionCard(
            translateText("main.join"),
            this.openJoinLobby,
            "bg-surface hover:brightness-[1.08] active:brightness-[0.95] hover:scale-105 hover:shadow-[var(--shadow-action-card-hover)]",
            this.hostedLobbyCount(),
            true,
          )}
        </div>
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
            </div>`}

        <!-- Solo + detailed view, desktop only. Solo spans two columns; the
             lobby browser is one, the same width as Join Lobby below it. -->
        <div class="hidden sm:grid grid-cols-3 gap-4 h-14">
          <div class="col-span-2">
            ${this.renderSmallActionCard(
              translateText("main.solo"),
              this.openSinglePlayerModal,
              "bg-malibu-blue hover:bg-aquarius active:bg-malibu-blue/80 hover:scale-y-105 hover:scale-x-[1.01]",
            )}
          </div>
          ${this.renderSmallActionCard(
            translateText("main.detailed_view"),
            this.openDetailedView,
            "bg-surface hover:brightness-[1.08] active:brightness-[0.95] hover:scale-105 hover:shadow-[var(--shadow-action-card-hover)]",
          )}
        </div>
        <!-- Bottom row: create + ranked + join (desktop only) -->
        <div class="hidden sm:grid grid-cols-3 gap-4 h-14">
          ${this.renderSmallActionCard(
            translateText("main.create"),
            this.openHostLobby,
            "bg-surface hover:brightness-[1.08] active:brightness-[0.95] hover:scale-105 hover:shadow-[var(--shadow-action-card-hover)]",
            undefined,
            true,
          )}
          ${this.renderSmallActionCard(
            translateText("mode_selector.ranked_title"),
            this.openRankedMenu,
            "bg-surface hover:brightness-[1.08] active:brightness-[0.95] hover:scale-105 hover:shadow-[var(--shadow-action-card-hover)]",
            undefined,
            true,
          )}
          ${this.renderSmallActionCard(
            translateText("main.join"),
            this.openJoinLobby,
            "bg-surface hover:brightness-[1.08] active:brightness-[0.95] hover:scale-105 hover:shadow-[var(--shadow-action-card-hover)]",
            this.hostedLobbyCount(),
            true,
          )}
        </div>
      </div>
    `;
  }

  private renderSpecialLobbyCard(lobby: PublicGameInfo) {
    return this.renderLobbyCard(lobby, this.getLobbyTitle(lobby));
  }

  /**
   * Refuses the action and draws attention to the update bar. Returns true when
   * the caller should stop.
   *
   * Deliberately NOT implemented with the `disabled` attribute the way
   * renderSmallActionCard handles invalid input: a disabled control (and
   * `pointer-events-none` alongside it) swallows the click, leaving nothing to
   * trigger the wiggle. The button stays clickable and merely stops being
   * actionable.
   */
  private blockedByUpdate(): boolean {
    if (!shouldBlockMultiplayerAction(this.desktopUpdateState)) return false;
    // Optional-call the method rather than dispatching an event: the bar is a
    // sibling custom element that may not have upgraded yet, and `?.wiggle?.()`
    // degrades to a silent no-op in that case instead of firing an event with
    // no listener.
    (
      document.querySelector("desktop-update-bar") as
        | (HTMLElement & { wiggle?: () => void })
        | null
    )?.wiggle?.();
    return true;
  }

  private openRankedMenu = () => {
    if (this.blockedByUpdate()) return;
    if (!this.validateUsername()) return;
    window.showPage?.("page-ranked");
  };

  private openDetailedView = () => {
    if (!this.validateUsername()) return;
    window.showPage?.("page-detailed-view");
  };

  private openSinglePlayerModal = () => {
    if (!this.validateUsername()) return;
    (
      document.querySelector("single-player-modal") as SinglePlayerModal
    )?.open();
  };

  private openHostLobby = () => {
    if (this.blockedByUpdate()) return;
    if (!this.validateUsername()) return;
    (document.querySelector("host-lobby-modal") as HostLobbyModal)?.open();
  };

  private openJoinLobby = () => {
    if (this.blockedByUpdate()) return;
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
    // Only the three multiplayer action cards (create/ranked/join) pass this;
    // the solo card is never gated (see openSinglePlayerModal) and must never
    // show as disabled here.
    gated: boolean = false,
  ) {
    const blocked =
      gated && shouldBlockMultiplayerAction(this.desktopUpdateState);
    return html`
      <button
        @click=${onClick}
        ?disabled=${!this.inputValid}
        aria-disabled=${blocked}
        class="relative flex items-center justify-center w-full h-full rounded-lg ${bgClass} transition-all duration-200 text-sm lg:text-base font-medium text-white uppercase tracking-wider text-center ${!this
          .inputValid
          ? "opacity-50 cursor-not-allowed pointer-events-none"
          : blocked
            ? "opacity-50 cursor-not-allowed"
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

    // Gated, not disabled: `disabled` (which the option below sets, together
    // with pointer-events-none) swallows the click, and the click is what
    // makes the update bar wiggle. `blocked` only dims and reports
    // aria-disabled; validateAndJoin does the refusing.
    return lobbyCard({
      lobby,
      subtitle: titleContent,
      timeDisplay,
      timeDisplayUppercase,
      disabled: !this.inputValid,
      blocked: shouldBlockMultiplayerAction(this.desktopUpdateState),
      onClick: () => this.validateAndJoin(lobby),
    });
  }

  private validateAndJoin(lobby: PublicGameInfo) {
    if (this.blockedByUpdate()) return;
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
