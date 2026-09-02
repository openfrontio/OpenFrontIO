import { html, LitElement, nothing, type TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { ClientEnv } from "src/client/ClientEnv";
import { UserMeResponse } from "../core/ApiSchemas";
import {
  Duos,
  GameMapType,
  GameMode,
  GameType,
  HumansVsNations,
  Quads,
  Trios,
} from "../core/game/Game";
import { PublicGameInfo, PublicGames } from "../core/Schemas";
import { getDesktopSessionState } from "./Auth";
import "./components/IOSAddToHomeScreenBanner";
import {
  canJoinTrustedLobby,
  lobbyCard,
  mapAspectRatios,
  trustRequiredDialog,
  viewerIsSignedIn,
  viewerIsTrusted,
} from "./components/LobbyCard";
import { crazyGamesSDK } from "./CrazyGamesSDK";
import {
  isDesktopShell,
  multiplayerAllowed,
  multiplayerAllowedForSession,
  type DesktopSessionState,
  type DesktopUpdateState,
} from "./DesktopShell";
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

const PRIMARY_ACTION =
  "bg-malibu-blue hover:bg-aquarius active:bg-malibu-blue/80 hover:scale-y-105 hover:scale-x-[1.01]";
const SECONDARY_ACTION =
  "bg-surface hover:brightness-[1.08] active:brightness-[0.95] hover:scale-105 hover:shadow-[var(--shadow-action-card-hover)]";
const DISABLED = "opacity-50 cursor-not-allowed pointer-events-none";

/**
 * Whether a multiplayer entry point should refuse to act. Exported for tests
 * and kept free of component state so the rule is checkable in isolation.
 * A null state means that bridge is absent (the web build), so it gates
 * nothing; either state alone is enough to block.
 */
export function shouldBlockMultiplayerAction(
  update: DesktopUpdateState | null,
  session: DesktopSessionState | null,
): boolean {
  if (update !== null && !multiplayerAllowed(update)) return true;
  if (session !== null && !multiplayerAllowedForSession(session)) return true;
  return false;
}

/**
 * Whether the desktop gate applies to a given join at all. Single-player runs
 * entirely in-client and a replay simulates from an archived record, so
 * neither needs a session or an up-to-date build. getTurnstileToken in
 * Main.ts exempts the same pair (alongside two conditions irrelevant here),
 * and calls this so the two cannot drift. Exported for tests and kept free of
 * component state, like shouldBlockMultiplayerAction above.
 */
export function joinIsGateable(lobby: JoinLobbyEvent): boolean {
  return (
    lobby.gameStartInfo?.config.gameType !== GameType.Singleplayer &&
    lobby.gameRecord === undefined
  );
}

/**
 * The whole gate decision for one join, as a pure function so it is testable
 * without mounting Main's client. Main adds only the shell check and the
 * status-bar wiggle around it.
 */
export function shouldBlockDesktopJoin(
  lobby: JoinLobbyEvent,
  update: DesktopUpdateState | null,
  session: DesktopSessionState | null,
): boolean {
  if (!joinIsGateable(lobby)) return false;
  return shouldBlockMultiplayerAction(update, session);
}

@customElement("game-mode-selector")
export class GameModeSelector extends LitElement {
  @state() private lobbies: PublicGames | null = null;
  @state() private inputValid: boolean = true;
  @state() private desktopUpdateState: DesktopUpdateState | null = null;
  @state() private viewerTrusted: boolean = false;
  @state() private viewerSignedIn: boolean = false;
  @state() private showTrustRequired: boolean = false;
  @state() private desktopSessionState: DesktopSessionState | null = null;
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
    document.addEventListener("userMeResponse", this.onUserMe);
    if (isDesktopShell()) {
      this.desktopSessionState = getDesktopSessionState();
    }
    document.addEventListener(
      "desktop-session-state",
      this.onDesktopSessionState,
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
    document.removeEventListener("userMeResponse", this.onUserMe);
    document.removeEventListener(
      "desktop-session-state",
      this.onDesktopSessionState,
    );
    super.disconnectedCallback();
  }

  private handleValidityChange = (e: Event) => {
    this.inputValid = (e as CustomEvent).detail?.isValid ?? true;
  };

  private onDesktopUpdateState = (e: Event) => {
    this.desktopUpdateState = (e as CustomEvent<DesktopUpdateState>).detail;
  };

  private onUserMe = (e: Event) => {
    const me = (e as CustomEvent<UserMeResponse | false>).detail;
    this.viewerSignedIn = viewerIsSignedIn(me);
    this.viewerTrusted = viewerIsTrusted(me);
    // A CrazyGames sign-in surfaces as a userMeResponse without a linked
    // identity, so re-read the SDK profile alongside it.
    if (crazyGamesSDK.isOnCrazyGames()) {
      void crazyGamesSDK.getUserProfile().then((user) => {
        if (user !== null) this.viewerSignedIn = true;
      });
    }
  };

  private onDesktopSessionState = (e: Event) => {
    this.desktopSessionState = (e as CustomEvent<DesktopSessionState>).detail;
  };

  public stop() {
    this.lobbySocket.stop();
  }

  /**
   * Re-open the public-lobby socket after stop().
   *
   * connectedCallback() used to be the only caller of lobbySocket.start(),
   * which was fine while every exit from a started game reloaded the page. It
   * is not fine for an exit that leaves in place (openInvite, OPE-255): this
   * element is never disconnected, so connectedCallback never runs again and
   * the lobby list stayed frozen on whatever it last received.
   *
   * Safe to call when already running -- PublicLobbySocket.start() closes any
   * existing socket before opening a new one -- but callers should still only
   * use it to undo a stop(), since a needless reconnect drops the cached
   * snapshot and re-primes the list from the server.
   */
  public start() {
    this.lobbySocket.start();
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
    // The hero slot holds the spinner, then the FFA card; loaded without one
    // it goes and the upcoming column takes the whole row.
    const heroSlot = this.lobbies === null || ffa !== undefined;
    // A lone secondary card takes both of the column's card rows.
    const cardRows =
      teams && special
        ? { special: "sm:row-start-2", teams: "sm:row-start-3" }
        : {
            special: "sm:row-start-2 sm:row-span-2",
            teams: "sm:row-start-2 sm:row-span-2",
          };

    // DOM is in phone order; sm+ places the same elements onto a grid and
    // reading-flow keeps focus order following the rows (Chromium only).
    return html`
      <div
        class="flex flex-col gap-4 w-full px-4 pb-4 mx-auto sm:px-0 sm:pb-0 sm:grid sm:grid-cols-[2fr_1fr] sm:grid-rows-[auto_min(24rem,40vh)_auto_auto] sm:[reading-flow:grid-rows]"
      >
        <ios-add-to-home-screen-banner
          class="no-crazygames [&:empty]:hidden sm:col-span-2 sm:row-start-1"
        ></ios-add-to-home-screen-banner>

        <div class="h-14 sm:col-span-2 sm:row-start-3">
          ${this.renderSmallActionCard(
            translateText("main.solo"),
            this.openSinglePlayerModal,
            PRIMARY_ACTION,
          )}
        </div>
        <div class="grid grid-cols-3 gap-4 h-14 sm:col-span-2 sm:row-start-4">
          ${this.renderSmallActionCard(
            translateText("main.create"),
            this.openHostLobby,
            SECONDARY_ACTION,
            undefined,
            true,
          )}
          ${this.renderSmallActionCard(
            translateText("mode_selector.ranked_title"),
            this.openRankedMenu,
            SECONDARY_ACTION,
            undefined,
            true,
          )}
          ${this.renderSmallActionCard(
            translateText("main.join"),
            this.openJoinLobby,
            SECONDARY_ACTION,
            this.hostedLobbyCount(),
            true,
          )}
        </div>

        ${heroSlot
          ? html`<div class="min-w-0 sm:col-start-1 sm:row-start-2">
              ${ffa
                ? this.renderLobbyCard(ffa, this.getLobbyTitle(ffa))
                : html`<div
                    class="flex items-center justify-center h-44 sm:h-full"
                  >
                    <span
                      class="size-24 rounded-full border-[6px] border-blue-500/30 border-t-blue-500 animate-spin"
                    ></span>
                  </div>`}
            </div>`
          : nothing}

        <!-- Always rendered: the heading is the only way into the lobby browser. -->
        <section
          class="flex flex-col gap-4 min-w-0 sm:grid sm:grid-rows-[auto_1fr_1fr] sm:row-start-2 sm:min-h-0 sm:[reading-flow:grid-rows] ${heroSlot
            ? "sm:col-start-2"
            : "sm:col-start-1 sm:col-span-2"}"
        >
          ${teams
            ? html`<div class="min-w-0 sm:min-h-0 ${cardRows.teams}">
                ${this.renderLobbyCard(teams, this.getLobbyTitle(teams))}
              </div>`
            : nothing}
          ${special
            ? html`<div class="min-w-0 sm:min-h-0 ${cardRows.special}">
                ${this.renderLobbyCard(special, this.getLobbyTitle(special))}
              </div>`
            : nothing}
          ${this.renderUpcomingHeading()}
        </section>

        ${this.showTrustRequired
          ? trustRequiredDialog(
              this.viewerSignedIn,
              () => (this.showTrustRequired = false),
            )
          : nothing}
      </div>
    `;
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
    if (
      !shouldBlockMultiplayerAction(
        this.desktopUpdateState,
        this.desktopSessionState,
      )
    )
      return false;
    // Optional-call the method rather than dispatching an event: the bar is a
    // sibling custom element that may not have upgraded yet, and `?.wiggle?.()`
    // degrades to a silent no-op in that case instead of firing an event with
    // no listener.
    (
      document.querySelector("desktop-status-bar") as
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
  /**
   * The heading over the upcoming column, and the way to the lobby browser now
   * that the Detailed View button is gone. Heading and link are one control:
   * side by side they were two runs of small uppercase text, and neither read
   * as clickable. A heading may hold a button, so the h2 survives.
   *
   * Dims and stops responding on an invalid username, as the button it
   * replaces did: openDetailedView's own check is a silent backstop that
   * assumes its control already looks disabled.
   */
  /** Heading over the upcoming column; also the link to the lobby browser. */
  private renderUpcomingHeading() {
    const count = this.advertisedLobbyCount();
    return html`
      <h2 class="min-w-0 sm:row-start-1">
        <button
          @click=${this.openDetailedView}
          ?disabled=${!this.inputValid}
          class="group/upcoming flex w-full items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/[0.04] py-1.5 pl-2.5 pr-1.5 transition-colors hover:border-malibu-blue/50 hover:bg-malibu-blue/15 ${this
            .inputValid
            ? ""
            : DISABLED}"
        >
          <span
            class="truncate text-sm font-bold uppercase tracking-widest text-white/70 group-hover/upcoming:text-white"
            >${translateText("public_lobby.upcoming")}</span
          >
          <span
            class="flex shrink-0 items-center gap-0.5 rounded bg-malibu-blue py-0.5 pl-2 pr-1 text-xs font-bold uppercase tracking-wider text-white group-hover/upcoming:bg-aquarius"
          >
            ${count > 0
              ? translateText("public_lobby.see_all", { count })
              : nothing}
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              class="size-4"
              aria-hidden="true"
            >
              <path
                fill-rule="evenodd"
                d="M8.22 5.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L11.94 10 8.22 6.28a.75.75 0 0 1 0-1.06Z"
                clip-rule="evenodd"
              />
            </svg>
          </span>
        </button>
      </h2>
    `;
  }

  /** Every lobby the browser lists, hosted included. */
  private advertisedLobbyCount(): number {
    return Object.values(this.lobbies?.games ?? {}).flat().length;
  }

  private hostedLobbyCount(): number {
    return this.lobbies?.games?.hosted?.length ?? 0;
  }

  private renderSmallActionCard(
    title: string,
    onClick: () => void,
    bgClass: string = SECONDARY_ACTION,
    badge?: number,
    // Only the three multiplayer action cards (create/ranked/join) pass this;
    // the solo card is never gated (see openSinglePlayerModal) and must never
    // show as disabled here.
    gated: boolean = false,
  ) {
    const blocked =
      gated &&
      shouldBlockMultiplayerAction(
        this.desktopUpdateState,
        this.desktopSessionState,
      );
    return html`
      <button
        @click=${onClick}
        ?disabled=${!this.inputValid}
        aria-disabled=${blocked}
        class="relative flex items-center justify-center w-full h-full rounded-lg ${bgClass} transition-all duration-200 text-sm lg:text-base font-medium text-white uppercase tracking-wider text-center ${!this
          .inputValid
          ? DISABLED
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
      blocked: shouldBlockMultiplayerAction(
        this.desktopUpdateState,
        this.desktopSessionState,
      ),
      viewerTrusted: this.viewerTrusted,
      onClick: () => this.validateAndJoin(lobby),
    });
  }

  private validateAndJoin(lobby: PublicGameInfo) {
    if (this.blockedByUpdate()) return;
    if (!this.validateUsername()) return;
    if (!canJoinTrustedLobby(lobby, this.viewerTrusted)) {
      this.showTrustRequired = true;
      return;
    }

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
