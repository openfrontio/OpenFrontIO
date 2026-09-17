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
  getDesktopUpdateState,
  isDesktopShell,
  multiplayerAllowed,
  multiplayerAllowedForSession,
  type DesktopSessionState,
  type DesktopUpdateState,
} from "./DesktopShell";
import { HostLobbyModal } from "./HostLobbyModal";
import { showInGameAlert } from "./InGameModal";
import { JoinLobbyModal } from "./JoinLobbyModal";
import { PublicLobbySocket } from "./LobbySocket";
import { JoinLobbyEvent } from "./Main";
import {
  backendUnreachableConfirmed,
  isPinnedToAVersion,
  manualRetryAvailable,
  retryServerList,
  type BackendReachabilityDetail,
} from "./ServerList";
import { SinglePlayerModal } from "./SinglePlayerModal";
import { UsernameInput } from "./UsernameInput";
import {
  calculateServerTimeOffset,
  getGamesPlayed,
  getSecondsUntilServerTimestamp,
  reloadForUpdate,
  renderDuration,
  showToast,
  translateText,
} from "./Utils";
import { isReplayShellHost } from "./VersionedReplay";

const PRIMARY_ACTION =
  "bg-malibu-blue hover:bg-aquarius active:bg-malibu-blue/80 hover:scale-y-105 hover:scale-x-[1.01]";
const SECONDARY_ACTION =
  "bg-surface hover:brightness-[1.08] active:brightness-[0.95] hover:scale-105 hover:shadow-[var(--shadow-action-card-hover)]";
const DISABLED = "opacity-50 cursor-not-allowed pointer-events-none";
/** Tutorial card: the panel's gold, dark text for contrast. */
const TUTORIAL_ACTION =
  "bg-cyber-yellow hover:bg-yellow-300 active:bg-cyber-yellow/80 !text-gray-900 hover:scale-y-105 hover:scale-x-[1.01]";

/** The Tutorial card shows beside Solo until the player has played this many games. */
const TUTORIAL_CARD_MAX_GAMES = 5;

/**
 * THE REACHABILITY RULE (OPE-439). Stated once, here; every other call site
 * in this feature points back at this comment rather than restating it.
 *
 * The backend-reachability signal is the health of ONE thing: the server-list
 * API (`/cluster.json`), as observed by ServerList's heartbeat. It is not a
 * general "is the internet up" light, and in particular it says nothing about
 * whether any given GAME server is up.
 *
 * So it may gate exactly one category of action: the ones that cannot even
 * begin without that API answering first, because nothing has yet told the
 * client which server to talk to.
 *
 *   GATED (API-dependent): creating/hosting a lobby, entering matchmaking,
 *   opening the join-by-code modal. Each has to resolve a server for
 *   something the client has heard nothing about, so a dead list API really
 *   does mean the click cannot work. These dim, and refuse with
 *   reportMultiplayerRefusal.
 *
 *   NOT GATED (socket-sourced): anything whose target arrived over a live
 *   game-server socket -- every card in the public lobby feed, in both the
 *   homepage selector and the detailed browser -- and every join that reaches
 *   Main's funnel (shouldBlockJoin). The card's very existence is proof that
 *   the game server behind it is up and talking to us, which is the only
 *   liveness that join needs. Refusing there could only ever reject a join
 *   that is already under way, over the health of an unrelated API. These
 *   neither dim nor refuse on reachability: they call
 *   shouldBlockSocketSourcedAction, which is the same predicate with the
 *   reachability input nailed shut.
 *
 * The other two inputs (desktop update state, desktop session state) apply to
 * both categories, which is why the two predicates differ only in this one
 * argument.
 *
 * ---
 *
 * Whether multiplayer should be available given what we know about the
 * backend.
 *
 * The parameter is ServerList.backendUnreachableConfirmed(), NOT the raw
 * backendReachable(), and the difference is load-bearing. That accessor is
 * already false for the two states this must never gate:
 *
 *   - before the first attempt settles. A page is in that state for its first
 *     few hundred milliseconds, and gating there would lock every player out
 *     of multiplayer on every load over a suspicion we have not tested yet.
 *   - after a single missed heartbeat. The cached list is still serving and
 *     the next request would very likely have worked; taking the game away
 *     for a retry interval over one blip is worse than the blip.
 *
 * It is also false when the API answered at all -- a 404 for a site with no
 * list is a reachable backend.
 */
export function multiplayerAllowedForBackend(backendOutage: boolean): boolean {
  return !backendOutage;
}

/**
 * Whether a multiplayer entry point should refuse to act. Exported for tests
 * and kept free of component state so the rule is checkable in isolation.
 * A null update/session means that bridge is absent (the web build), so it
 * gates nothing; any one of the three alone is enough to block.
 *
 * `backendOutage` is the only one of the three that also applies on the web,
 * which is why it is a required parameter rather than an optional one: an
 * entry point that forgets to pass it would silently stay ungated, and a
 * compile error is the cheapest way to notice. Pass
 * backendUnreachableConfirmed() only from an API-dependent entry point; a
 * socket-sourced one calls shouldBlockSocketSourcedAction instead, so that
 * "reachability does not apply here" is a named decision rather than a
 * `false` literal someone has to interpret.
 */
export function shouldBlockMultiplayerAction(
  update: DesktopUpdateState | null,
  session: DesktopSessionState | null,
  backendOutage: boolean,
): boolean {
  if (update !== null && !multiplayerAllowed(update)) return true;
  if (session !== null && !multiplayerAllowedForSession(session)) return true;
  if (!multiplayerAllowedForBackend(backendOutage)) return true;
  return false;
}

/**
 * Whether the public-lobby feed should be closed rather than kept open.
 *
 * A gated desktop session refuses every join the feed could offer, so keeping
 * the socket open only spends a connection on cards nobody can use and shows
 * a spinner that never resolves into anything playable. Close it and say
 * "offline" instead; it reopens when the session comes back.
 *
 * Reachability is deliberately NOT an input, by the rule at the top of this
 * file: the feed is socket-sourced, and the list API's health says nothing
 * about the game server behind it. The update state is not either -- a
 * pending update is not "offline".
 */
export function lobbyFeedSuspended(
  session: DesktopSessionState | null,
): boolean {
  return session !== null && !multiplayerAllowedForSession(session);
}

/**
 * The same gate for an action whose target arrived over a live game-server
 * socket: a public or hosted lobby card, in either browser, and every join
 * that reaches Main's funnel (shouldBlockJoin below wraps this).
 *
 * Reachability is not an input, by the rule at the top of this file: the card
 * is in front of the player because a game server sent it over a socket that
 * is still open, so the server-list API's health cannot make joining it
 * wrong. The desktop update and session states still apply -- they are
 * statements about this client, not about any server.
 *
 * A function rather than `shouldBlockMultiplayerAction(u, s, false)` at four
 * call sites so the dimming and the click-through of a given control cannot
 * drift apart, and so grep finds every place the rule is exercised.
 */
export function shouldBlockSocketSourcedAction(
  update: DesktopUpdateState | null,
  session: DesktopSessionState | null,
): boolean {
  return shouldBlockMultiplayerAction(update, session, false);
}

/**
 * Tells the player why a multiplayer action was refused -- and, on the web,
 * acts as the retry it tells them to make.
 *
 * On desktop the status bar is already showing the reason and its remedy, so
 * the click lands there as a wiggle rather than as a message that would say
 * the same thing twice. The web has no status bar, so an unreachable backend
 * would refuse in complete silence -- which reads as a broken button -- and
 * gets a transient message instead.
 *
 * Only reachability needs the web half: every other reason to refuse here is
 * desktop-only, and on desktop the bar always carries it.
 *
 * The refused click also PROBES on the web, and that is the point rather than
 * a nicety. Desktop has a Retry button; the web has nothing, so without this
 * the only way out of the gated state is the heartbeat's own next beat --
 * which backs off to as much as RETRY_MAX_MS once an outage has run a while.
 * A message reading "try again" over a button where trying again provably did
 * nothing is worse than no message. So the click the player makes IS the
 * retry, and the message is true.
 *
 * Throttled by ServerList.manualRetryAvailable(), the same policy (and the
 * same clock) as the desktop button's disabled state: nothing while an
 * attempt is already out, nothing for MANUAL_RETRY_COOLDOWN_MS after the last
 * one. A player clicking at an outage gets the message every time and a
 * request at most every few seconds. Nothing is rendered from the result: a
 * successful probe flips the reachability signal, which is what un-dims the
 * buttons -- the feedback is the gate going away.
 */
export function reportMultiplayerRefusal(backendOutage: boolean): void {
  // Optional-call the method rather than dispatching an event: the bar is a
  // sibling custom element that may not have upgraded yet, and `?.wiggle?.()`
  // degrades to a silent no-op in that case instead of firing an event with
  // no listener.
  (
    document.querySelector("desktop-status-bar") as
      | (HTMLElement & { wiggle?: () => void })
      | null
  )?.wiggle?.();
  // Keyed on the shell, not on the element: <desktop-status-bar> is in
  // index.html on every build and simply renders nothing on the web, so its
  // presence proves nothing about whether the player can see a reason.
  if (!isDesktopShell() && backendOutage) {
    if (manualRetryAvailable()) {
      retryServerList().catch((err: unknown) => {
        // retryServerList never rejects; belt and braces, so a change there
        // cannot surface as an unhandled rejection from a click handler.
        console.error("server list retry from a refused click failed", err);
      });
    }
    showToast(translateText("common.backend_unreachable"), "red");
  }
}

/**
 * Whether the multiplayer gate applies to a given join at all. Single-player
 * runs entirely in-client and a replay simulates from an archived record, so
 * neither needs a session, an up-to-date build, or a backend that is up.
 * getTurnstileToken in Main.ts exempts the same pair (alongside two
 * conditions irrelevant here), and calls this so the two cannot drift.
 * Exported for tests and kept free of component state, like
 * shouldBlockMultiplayerAction above.
 */
export function joinIsGateable(lobby: JoinLobbyEvent): boolean {
  return (
    lobby.gameStartInfo?.config.gameType !== GameType.Singleplayer &&
    lobby.gameRecord === undefined
  );
}

/**
 * The whole gate decision for one join, as a pure function so it is testable
 * without mounting Main's client. Main adds only the shell check (which
 * decides whether the two desktop states are even read) and the refusal
 * feedback around it. Both halves it does weigh -- the update state and the
 * session state -- are desktop-only.
 *
 * Backend reachability is deliberately NOT an input here -- the rule at the
 * top of this file, which is why this defers to
 * shouldBlockSocketSourcedAction. Every source that dispatches a join has
 * already reached a server to produce it: "private" only after
 * checkActiveLobby read `exists` from the game's own server, "host" only
 * after createLobby minted the id, "public" from a lobby list arriving over a
 * live server socket, and "matchmaking" only after the queue matched and
 * checkGame confirmed the game exists. The outage signal tracks the separate
 * server-list API, whose health says nothing about those servers, so refusing
 * here could only reject a join that is already under way. Worst case it
 * ejects a player mid-game: a reload during a list-API blip proves the game
 * is live, then the refusal closes the join modal, which leaves the lobby and
 * resets the URL.
 *
 * The controls one step earlier in the funnel -- the lobby cards in this
 * component and in DetailedGameViewModal, which are where a "public" join
 * comes from -- hold to the same rule for the same reason, so a card is
 * neither dimmed nor refused over a list-API outage.
 */
export function shouldBlockJoin(
  lobby: JoinLobbyEvent,
  update: DesktopUpdateState | null,
  session: DesktopSessionState | null,
): boolean {
  if (!joinIsGateable(lobby)) return false;
  return shouldBlockSocketSourcedAction(update, session);
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
  // The DEBOUNCED outage signal, not the raw per-attempt one: see
  // multiplayerAllowedForBackend for why one missed heartbeat must not dim
  // these buttons.
  @state() private backendOutage = false;
  private serverTimeOffset: number = 0;
  private defaultLobbyTime: number = 0;

  // True from join-lobby until leave-lobby: the player is waiting in (or
  // loading into) a lobby. This socket is NOT scoped to the homepage — Main.ts
  // only stops it when a game actually starts (prestart/join), so it is still
  // listening during the whole lobby wait.
  private inLobby = false;
  // Whether Main wants the feed open at all (false from game start until the
  // player is back at the menu). Kept apart from the socket's own state so a
  // session change can close and reopen the feed without forgetting that.
  private feedWanted = false;
  // The socket stopped reconnecting; cleared by the next start() or snapshot.
  @state() private feedGaveUp = false;
  // An update/drain signal arrived during a lobby wait; prompt on leave-lobby.
  private updateDeferred = false;

  private lobbySocket = new PublicLobbySocket(
    (lobbies) => this.handleLobbiesUpdate(lobbies),
    {
      onUpdateAvailable: () => this.handleUpdateAvailable(),
      onGaveUp: () => {
        // Nothing is loading any more, and cards from a feed that has died
        // are lobbies the player cannot join.
        this.feedGaveUp = true;
        this.lobbies = null;
      },
    },
  );

  private handleUpdateAvailable() {
    // The desktop shell runs the bundle from a local overlay and updates it
    // itself (download, stage, then its own reload button, see
    // DesktopUpdateBar). Reloading here would only re-run the old overlay,
    // reconnect, and trigger this again until the download finishes.
    if (isDesktopShell()) return;
    // A versioned replay shell is pinned to the archived game's build on
    // purpose (VersionedReplay.ts), but its baked-in serverHost points at a
    // live deployment running a newer build — so the lobby socket's commit
    // compare (or a drain signal) fires on every load. "Update" is
    // meaningless here, and reloading re-serves the same immutable shell,
    // which would loop the prompt forever.
    if (isReplayShellHost(window.location.hostname)) return;
    // A page pinned under /v/<commit>/ is on that build because the game it
    // opened runs there (redirectToGameVersion), and its build's servers are
    // draining by definition -- so the lobby feed's drain signal fires on
    // every load. Reloading would strip the pin, land on latest, and be
    // re-pinned straight back: the same loop as the replay shell, closed the
    // same way. Leaving to the menu goes to the version-free root anyway.
    if (isPinnedToAVersion()) return;
    // A blocking reload prompt during a lobby wait would eject the player
    // from a lobby the draining deployment deliberately lets finish — and a
    // private lobby's members are all pinned to the same deployment, so they
    // would all be prompted out at once. Defer until they leave the lobby;
    // if the game starts instead, Main.ts stops this socket, and every exit
    // from a started game is a full navigation that picks up the new shell
    // anyway.
    if (this.inLobby) {
      this.updateDeferred = true;
      return;
    }
    showInGameAlert(translateText("update_available.message")).then(() => {
      reloadForUpdate();
    });
  }

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
      // Seed BOTH from their current values. This element is rendered by
      // <play-page> on a Lit microtask, so it cannot exist yet when the status
      // bar dispatches the update bridge's synchronous replay -- without the
      // seed the update half of the gate stays null and silently never
      // applies (OPE-396).
      this.desktopUpdateState = getDesktopUpdateState();
      this.desktopSessionState = getDesktopSessionState();
    }
    // After the session seed above: a shell that already knows it has no
    // session must not open a feed it will close on the next tick.
    this.start();
    document.addEventListener(
      "desktop-session-state",
      this.onDesktopSessionState,
    );
    // Seeded unconditionally, unlike the two above: the backend is just as
    // unreachable on the web, and the heartbeat's first attempts often settle
    // before this element exists (it is started in Main's initialize, we are
    // rendered by <play-page> later), so the event alone would miss them.
    this.backendOutage = backendUnreachableConfirmed();
    document.addEventListener(
      "backend-reachability",
      this.onBackendReachability,
    );
    document.addEventListener("join-lobby", this.onJoinLobby);
    document.addEventListener("leave-lobby", this.onLeaveLobby);
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
    document.removeEventListener(
      "backend-reachability",
      this.onBackendReachability,
    );
    document.removeEventListener("join-lobby", this.onJoinLobby);
    document.removeEventListener("leave-lobby", this.onLeaveLobby);
    super.disconnectedCallback();
  }

  private onJoinLobby = () => {
    this.inLobby = true;
  };

  private onLeaveLobby = () => {
    this.inLobby = false;
    if (this.updateDeferred) {
      this.updateDeferred = false;
      this.handleUpdateAvailable();
    }
  };

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
    const next = (e as CustomEvent<DesktopSessionState>).detail;
    const wasSuspended = lobbyFeedSuspended(this.desktopSessionState);
    this.desktopSessionState = next;
    const suspended = lobbyFeedSuspended(next);
    if (suspended === wasSuspended || !this.feedWanted) return;
    if (suspended) {
      this.closeLobbyFeed();
    } else {
      this.feedGaveUp = false;
      this.lobbySocket.start();
    }
  };

  private onBackendReachability = (e: Event) => {
    this.backendOutage = (
      e as CustomEvent<BackendReachabilityDetail>
    ).detail.confirmed;
  };

  public stop() {
    this.feedWanted = false;
    this.lobbySocket.stop();
  }

  // Also drops the snapshot: a card from a feed we have closed is a lobby the
  // player cannot join, and the hero slot reads `null` as "show why".
  private closeLobbyFeed() {
    this.lobbySocket.stop();
    this.lobbies = null;
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
    this.feedWanted = true;
    this.feedGaveUp = false;
    if (lobbyFeedSuspended(this.desktopSessionState)) {
      // The session may have dropped while Main had the feed stopped, in
      // which case the snapshot from before the game is still here and its
      // cards would render as joinable.
      this.lobbies = null;
      return;
    }
    this.lobbySocket.start();
  }

  /**
   * Whether an empty hero slot should say "offline" instead of spinning. The
   * feed is closed on a gated session, so nothing is loading; on a confirmed
   * outage it may still be connecting, but a spinner that the status bar
   * contradicts reads as broken, and the feed reconnects on its own if the
   * server answers.
   */
  private offlineForLobbies(): boolean {
    return (
      lobbyFeedSuspended(this.desktopSessionState) ||
      this.backendOutage ||
      this.feedGaveUp
    );
  }

  private handleLobbiesUpdate(lobbies: PublicGames) {
    this.lobbies = lobbies;
    this.feedGaveUp = false;
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
        class="flex flex-col gap-4 w-full px-4 pb-4 mx-auto sm:px-0 sm:pb-0 sm:grid sm:grid-cols-[2fr_1fr] sm:grid-rows-[auto_min(24rem,40vh)_auto_auto] desktop:sm:grid-rows-[auto_40vh_auto_auto] sm:[reading-flow:grid-rows]"
      >
        <ios-add-to-home-screen-banner
          class="no-crazygames [&:empty]:hidden sm:col-span-2 sm:row-start-1"
        ></ios-add-to-home-screen-banner>

        <div class="flex gap-4 h-14 sm:col-span-2 sm:row-start-3">
          <div class="flex-[2]">
            ${this.renderSmallActionCard(
              translateText("main.solo"),
              this.openSinglePlayerModal,
              PRIMARY_ACTION,
            )}
          </div>
          ${getGamesPlayed() < TUTORIAL_CARD_MAX_GAMES
            ? html`<div class="flex-1">
                ${this.renderSmallActionCard(
                  translateText("main.tutorial"),
                  this.startTutorial,
                  TUTORIAL_ACTION,
                )}
              </div>`
            : nothing}
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
                : this.offlineForLobbies()
                  ? html`<div
                      class="flex items-center justify-center h-44 sm:h-full rounded-xl bg-surface/60 px-6 text-center text-sm font-medium text-white/60"
                    >
                      ${translateText("mode_selector.offline_lobbies")}
                    </div>`
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
   * Refuses an API-DEPENDENT action (Create, Ranked, Join by code) and tells
   * the player why. Returns true when the caller should stop.
   *
   * The reachability half applies here -- see the rule at the top of this
   * file: none of these three can resolve a server without the list API. A
   * lobby card goes through blockedFromLobbyJoin below instead.
   *
   * Deliberately NOT implemented with the `disabled` attribute the way
   * renderSmallActionCard handles invalid input: a disabled control (and
   * `pointer-events-none` alongside it) swallows the click, leaving nothing to
   * trigger the wiggle -- and, on the web, nothing to trigger the retry that
   * reportMultiplayerRefusal makes of it. The button stays clickable and
   * merely stops being actionable.
   */
  private blockedFromApiAction(): boolean {
    if (
      !shouldBlockMultiplayerAction(
        this.desktopUpdateState,
        this.desktopSessionState,
        this.backendOutage,
      )
    )
      return false;
    reportMultiplayerRefusal(this.backendOutage);
    return true;
  }

  /**
   * The same, for the public-lobby card: the desktop states still refuse, a
   * list-API outage never does. Its lobby came over a live game-server socket
   * (the rule at the top of this file), so there is no reachability reason to
   * refuse and nothing to retry -- hence `false` to the refusal report, which
   * leaves the desktop wiggle as the only feedback.
   */
  private blockedFromLobbyJoin(): boolean {
    if (
      !shouldBlockSocketSourcedAction(
        this.desktopUpdateState,
        this.desktopSessionState,
      )
    )
      return false;
    reportMultiplayerRefusal(false);
    return true;
  }

  private openRankedMenu = () => {
    if (this.blockedFromApiAction()) return;
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

  // Handled in Main, which also serves the help page's tutorial button.
  private startTutorial = () => {
    if (!this.validateUsername()) return;
    document.dispatchEvent(new CustomEvent("start-tutorial"));
  };

  private openHostLobby = () => {
    if (this.blockedFromApiAction()) return;
    if (!this.validateUsername()) return;
    (document.querySelector("host-lobby-modal") as HostLobbyModal)?.open();
  };

  private openJoinLobby = () => {
    if (this.blockedFromApiAction()) return;
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
        this.backendOutage,
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
    //
    // Socket-sourced, so a list-API outage neither dims this nor refuses it:
    // the same predicate validateAndJoin uses, for the reason in the rule at
    // the top of this file.
    return lobbyCard({
      lobby,
      subtitle: titleContent,
      timeDisplay,
      timeDisplayUppercase,
      disabled: !this.inputValid,
      blocked: shouldBlockSocketSourcedAction(
        this.desktopUpdateState,
        this.desktopSessionState,
      ),
      viewerTrusted: this.viewerTrusted,
      onClick: () => this.validateAndJoin(lobby),
    });
  }

  private validateAndJoin(lobby: PublicGameInfo) {
    if (this.blockedFromLobbyJoin()) return;
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
