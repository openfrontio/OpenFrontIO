import version from "resources/version.txt?raw";
import { ClientEnv } from "src/client/ClientEnv";
import { isTemporaryUsername, UserMeResponse } from "../core/ApiSchemas";
import { assetUrl } from "../core/AssetUrls";
import { EventBus } from "../core/EventBus";
import {
  GAME_ID_REGEX,
  GameInfo,
  GameRecord,
  GameStartInfo,
  LobbyInfoEvent,
  PublicGameInfo,
} from "../core/Schemas";
import { toWireGameStartInfo } from "../core/Util";
import { GameEnv } from "../core/configuration/Config";
import { UserSettings } from "../core/game/UserSettings";
import "./AccountModal";
import "./AccountSettingsModal";
import { adGatekeeper } from "./AdGatekeeper";
import { loadAdmiral, onAdmiralMeasured } from "./Admiral";
import { getUserMe, invalidateUserMe } from "./Api";
import {
  getDesktopSessionState,
  reauthAfterCrazyGamesChange,
  retrySteamSignIn,
  userAuth,
} from "./Auth";
import "./ChangeUsernameModal";
import "./ClanModal";
import { joinLobby, type JoinLobbyResult } from "./ClientGameRunner";
import {
  completeCosmeticPurchaseReturn,
  getPlayerCosmeticsRefs,
} from "./Cosmetics";
import { updateCrazyGamesNavButton } from "./CrazyGamesAccountButton";
import { crazyGamesSDK } from "./CrazyGamesSDK";
import { desktopPresence, type PresencePayload } from "./DesktopPresence";
import {
  desktopUpdate,
  isDesktopShell,
  type DesktopUpdateState,
} from "./DesktopShell";
import "./FeaturedStream";
import "./GameModeSelector";
import {
  GameModeSelector,
  joinIsGateable,
  shouldBlockDesktopJoin,
} from "./GameModeSelector";
import { GameStartingModal } from "./GameStartingModal";
import "./GameStatsModal";
import { HelpModal } from "./HelpModal";
import "./HomepagePromos";
import { HostLobbyModal as HostPrivateLobbyModal } from "./HostLobbyModal";
import { showInGameAlert, showInGameConfirm } from "./InGameModal";
import "./InventoryModal";
import { JoinLobbyModal } from "./JoinLobbyModal";
import "./LangSelector";
import { LangSelector } from "./LangSelector";
import { initLayout } from "./Layout";
import "./LeaderboardModal";
import "./Matchmaking";
import { MatchmakingModal } from "./Matchmaking";
import {
  hideMenuChrome,
  menuChromeIsTornDown,
  restoreMenuChrome,
} from "./MenuChrome";
import { modalRouter } from "./ModalRouter";
import { updateAccountNavButton } from "./NavAccountButton";
import { initNavigation } from "./Navigation";
import "./NewsModal";
import { fallbackPlayerName } from "./PlayerName";
import "./PlayerProfileModal";
import { RewardsModal } from "./RewardsModal";
import "./SinglePlayerModal";
import {
  isSteamLinkHash,
  parseSteamLinkToken,
  resumePendingSteamLink,
} from "./SteamLink";
import "./SteamLinkModal";
import { SteamLinkModal } from "./SteamLinkModal";
import { StoreModal } from "./Store";
import "./SubscriptionModal";
import { TokenLoginModal } from "./TokenLoginModal";
import {
  SendKickPlayerIntentEvent,
  SendToggleGameStartTimer,
  SendUpdateGameConfigIntentEvent,
} from "./Transport";
import { UserSettingModal } from "./UserSettingModal";
import "./UsernameInput";
import { UsernameInput } from "./UsernameInput";
import { incrementGamesPlayed, presenceMapKey, translateText } from "./Utils";
import { isReplayShellHost } from "./VersionedReplay";
import "./components/BannedModal";
import "./components/DesktopStatusBar";
import "./components/MarketingConsentToast";
import "./components/PurchaseNudgeModal";
import {
  installCtrlWheelZoomBlocker,
  installDoubleTapZoomBlocker,
  installSafariPinchZoomBlocker,
} from "./utilities/DisableSafariPinchZoom";

import "./components/DesktopNavBar";
import "./components/DetailedGameViewModal";
import "./components/Footer";
import "./components/MainLayout";
import "./components/MobileNavBar";
import "./components/PlayPage";
import "./components/RankedModal";
import "./components/baseComponents/Button";
import "./components/baseComponents/Modal";
import "./styles.css";
import "./styles/core/typography.css";
import "./styles/core/variables.css";
import "./styles/layout/container.css";
import "./styles/layout/header.css";
import "./styles/modal/chat.css";

declare global {
  interface Window {
    turnstile: any;
    adsEnabled: boolean;
    gtag?: (...args: any[]) => void;
    PageOS: {
      session: {
        newPageView: () => void;
      };
    };
    ramp: {
      que: Array<() => void>;
      passiveMode: boolean;
      spaAddAds: (ads: Array<{ type: string; selectorId?: string }>) => void;
      destroyUnits: (adType: string | string[]) => Promise<void>;
      settings?: {
        slots?: any;
      };
      spaNewPage: (url?: string) => void;
      spaAds: (config?: {
        ads?: Array<{ type: string; selectorId?: string }>;
        countPageview?: boolean;
        path?: string;
      }) => void;
      // Video ad methods
      onPlayerReady: (() => void) | null;
      addUnits: (units: Array<{ type: string }>) => Promise<void>;
      displayUnits: () => void;
    };
    Bolt: {
      on: (unitType: string, event: string, callback: () => void) => void;
      BOLT_AD_REQUEST_START: string;
      BOLT_AD_IMPRESSION: string;
      BOLT_AD_STARTED: string;
      BOLT_FIRST_QUARTILE: string;
      BOLT_MIDPOINT: string;
      BOLT_THIRD_QUARTILE: string;
      BOLT_AD_COMPLETE: string;
      BOLT_AD_ERROR: string;
      BOLT_AD_PAUSED: string;
      BOLT_AD_CLICKED: string;
      SHOW_HIDDEN_CONTAINER: string;
    };
    currentPageId?: string;
    showPage?: (pageId: string) => void;
  }

  // Extend the global interfaces to include your custom events
  interface DocumentEventMap {
    "join-lobby": CustomEvent<JoinLobbyEvent>;
    "kick-player": CustomEvent;
    toggle_game_start_timer: CustomEvent;
    "join-changed": CustomEvent;
    "open-matchmaking": CustomEvent<{ mode?: "1v1" | "2v2" } | undefined>;
    "matchmaking-requeue": CustomEvent<{ mode?: "1v1" | "2v2" } | undefined>;
    userMeResponse: CustomEvent<UserMeResponse | false>;
    "session-cleared": CustomEvent;
    "leave-lobby": CustomEvent;
    "game-starting": CustomEvent;
    "update-game-config": CustomEvent;
  }
}

export interface JoinLobbyEvent {
  // Multiplayer games only have gameID, gameConfig is not known until game starts.
  gameID: string;
  // GameConfig only exists when playing a singleplayer game.
  gameStartInfo?: GameStartInfo;
  // GameRecord exists when replaying an archived game.
  gameRecord?: GameRecord;
  source?: "public" | "private" | "host" | "matchmaking" | "singleplayer";
  publicLobbyInfo?: GameInfo | PublicGameInfo;
  // Watch without playing.
  spectator?: boolean;
}

/**
 * The single point where "a match is running" is published.
 *
 * Two consumers, and they must never disagree:
 *   - the `.in-game` body class, which the client's own markup keys off to hide
 *     the footer, the nav bars and the desktop update snackbar;
 *   - the Electron shell's updater, which pauses asset downloads and version
 *     polling in-game so a cache-bust cannot saturate a player's connection
 *     mid-match.
 *
 * Every add/remove of that class goes through here. Setting the class without
 * telling the shell leaves the updater's pause dead; telling the shell without
 * setting the class leaves downloads paused at a menu forever.
 *
 * `setInGame` is optional by the shell contract (the web build has no bridge at
 * all, and a Steam shell older than the updater has no such method), and the
 * IPC round trip is fire-and-forget: a rejection must never surface as an
 * unhandled rejection in the client.
 */
function setInGameSignal(inGame: boolean): void {
  document.body.classList.toggle("in-game", inGame);
  void desktopUpdate()
    ?.setInGame?.(inGame)
    ?.catch(() => {});
}

class Client {
  private lobbyHandle: JoinLobbyResult | null = null;
  private eventBus: EventBus = new EventBus();

  private currentUrl: string | null = null;

  private usernameInput: UsernameInput | null = null;

  private hostModal: HostPrivateLobbyModal;
  private joinModal: JoinLobbyModal;
  private gameModeSelector: GameModeSelector;
  private userSettings: UserSettings = new UserSettings();
  private storeModal: StoreModal;
  private tokenLoginModal: TokenLoginModal;
  private matchmakingModal: MatchmakingModal;
  private rewardsModal: RewardsModal;
  private steamLinkModal: SteamLinkModal;
  private mostRecentJoinEvent: number;

  // Presence inputs. A private, hosted or matchmade JoinLobbyEvent carries
  // nothing but the game id, so the server's lobby_info is the only place the
  // client ever learns the map, size and roster -- keep the latest view here
  // and reuse it once the game starts, when no lobby_info arrives any more.
  private presenceDetail: Omit<PresencePayload, "state"> = {};
  private presenceSpectating = false;
  private presenceInGame = false;

  private turnstileTokenPromise: Promise<{
    token: string;
    createdAt: number;
  }> | null = null;

  async initialize(): Promise<void> {
    crazyGamesSDK.maybeInit();

    // Every exit from a game (win screen, in-game quit, popstate) navigates to
    // "/" and re-runs this, so announcing the menu here also covers "returned
    // to the menu" without hooking each of those paths.
    desktopPresence.set({ state: "menu" });

    // Register modals with the URL router. Lobby modals (join/host) and
    // matchmaking are intentionally omitted — they own their own URL state
    // (path-based) or none at all.
    modalRouter.register("store", {
      tag: "store-modal",
      pageId: "page-item-store",
    });
    modalRouter.register("settings", {
      tag: "user-setting",
      pageId: "page-settings",
    });
    modalRouter.register("leaderboard", {
      tag: "leaderboard-modal",
      pageId: "page-leaderboard",
    });
    modalRouter.register("clan", { tag: "clan-modal", pageId: "page-clan" });
    modalRouter.register("account", {
      tag: "account-modal",
      pageId: "page-account",
    });
    // Profile-menu modals: popup style, so no pageId.
    modalRouter.register("account-settings", { tag: "account-settings-modal" });
    modalRouter.register("change-username", { tag: "change-username-modal" });
    modalRouter.register("subscription", { tag: "subscription-modal" });
    modalRouter.register("stats", {
      tag: "game-stats-modal",
      pageId: "page-stats",
    });
    modalRouter.register("profile", {
      tag: "player-profile-modal",
      pageId: "page-profile",
    });
    modalRouter.register("help", { tag: "help-modal", pageId: "page-help" });
    modalRouter.register("news", { tag: "news-modal", pageId: "page-news" });
    modalRouter.register("language", {
      tag: "language-modal",
      pageId: "page-language",
    });
    modalRouter.register("single-player", {
      tag: "single-player-modal",
      pageId: "page-single-player",
    });
    modalRouter.register("ranked", {
      tag: "ranked-modal",
      pageId: "page-ranked",
    });
    modalRouter.register("detailed-view", {
      tag: "detailed-view-modal",
      pageId: "page-detailed-view",
    });
    modalRouter.register("troubleshooting", {
      tag: "troubleshooting-modal",
      pageId: "page-troubleshooting",
    });
    modalRouter.register("inventory", {
      tag: "inventory-modal",
      pageId: "page-inventory",
    });
    // Prefetch turnstile token so it is available when the user joins a lobby.
    // Desktop (Steam) has no Turnstile script and is server-side exempt, so
    // skip it — otherwise getTurnstileToken() throws "Failed to load Turnstile
    // script" after its load wait. Also skip on the versioned replay shells:
    // the replay host may not be on the Turnstile site key's domain allowlist,
    // so rendering the widget there alerts and rejects — and replays never
    // send a token anyway (see getTurnstileToken below).
    this.turnstileTokenPromise =
      ClientEnv.instanceId() === "desktop" ||
      isReplayShellHost(window.location.hostname)
        ? null
        : getTurnstileToken();

    // Wait for components to render before setting version
    await customElements.whenDefined("mobile-nav-bar");
    await customElements.whenDefined("desktop-nav-bar");

    const openFrontFont = new FontFace(
      "OpenFront",
      `url(${assetUrl("fonts/OpenFront.ttf")})`,
    );
    document.fonts.add(openFrontFont);
    openFrontFont.load().catch(() => {});

    const versionElements = document.querySelectorAll(
      "#game-version, .game-version-display",
    );
    if (versionElements.length === 0) {
      console.warn("Game version element not found");
    } else {
      // Game version only, so a player's version reads the same across web and
      // Steam. The full string, shell version included, is in page-footer.
      const trimmed = version.trim();
      const displayVersion = trimmed.startsWith("v") ? trimmed : `v${trimmed}`;
      versionElements.forEach((el) => {
        (el as HTMLElement).style.fontFamily = '"OpenFront", Inter, sans-serif';
        el.textContent = displayVersion;
      });
    }

    const langSelector = document.querySelector(
      "lang-selector",
    ) as LangSelector;
    if (!langSelector) {
      console.warn("Lang selector element not found");
    }

    this.usernameInput = document.querySelector(
      "username-input",
    ) as UsernameInput;
    if (!this.usernameInput) {
      console.warn("Username input element not found");
    }

    this.gameModeSelector = document.querySelector(
      "game-mode-selector",
    ) as GameModeSelector;

    window.addEventListener("beforeunload", async () => {
      console.log("Browser is closing");
      if (this.lobbyHandle !== null) {
        // Leaving a game by navigating away (the popstate path's
        // `window.location.href = "/"`, or a desktop renderer reload) tears the
        // page down without ever running handleLeaveLobby, so nothing else
        // clears the in-game signal. The body class dies with the document, but
        // the shell's updater lives in the main process and would stay paused
        // forever -- no downloads, no polling -- for the rest of the session.
        setInGameSignal(false);
        this.lobbyHandle.stop(true);
        await crazyGamesSDK.gameplayStop();
      }
    });

    // The server's lobby view is the only source for a lobby's real map, size
    // and roster, and the only place the client learns that a play/spectate
    // switch was accepted (the server can refuse it). Both feed presence.
    this.eventBus.on(LobbyInfoEvent, (event) => {
      const config = event.lobby.gameConfig;
      this.presenceDetail = {
        gameType: config?.gameType,
        gameMode: config?.gameMode,
        map: presenceMapKey(config?.gameMap),
        // Seats, not connections: spectators are in the roster but hold none
        // (mirrors LobbyPlayerView and the join modal's own count).
        playerCount: event.lobby.clients?.filter((c) => !c.spectator).length,
        maxPlayers: config?.maxPlayers,
        lobbyId: event.lobby.gameID,
      };
      this.presenceSpectating =
        event.lobby.clients?.find((c) => c.clientID === event.myClientID)
          ?.spectator === true;
      this.emitPresence();
    });

    document.addEventListener("join-lobby", (event) => {
      // A rejected handshake (Turnstile alerts then rejects) never assigns
      // lobbyHandle, so nothing downstream clears the "lobby" presence
      // emitted at the top of the join -- friends would keep being offered a
      // Join into a lobby the player never entered. Re-throw so the failure
      // still surfaces exactly as it does today.
      void this.handleJoinLobby(event).catch((error) => {
        this.resetPresenceToMenu();
        throw error;
      });
    });
    document.addEventListener("leave-lobby", this.handleLeaveLobby.bind(this));
    document.addEventListener("kick-player", this.handleKickPlayer.bind(this));
    document.addEventListener(
      "toggle_game_start_timer",
      this.handleToggleGameStartTimer.bind(this),
    );
    document.addEventListener(
      "update-game-config",
      this.handleUpdateGameConfig.bind(this),
    );
    document.addEventListener(
      "open-matchmaking",
      this.handleOpenMatchmaking.bind(this),
    );
    document.addEventListener(
      "matchmaking-requeue",
      this.handleMatchmakingRequeue.bind(this),
    );

    const hlpModal = document.querySelector("help-modal") as HelpModal;
    if (!hlpModal || !(hlpModal instanceof HelpModal)) {
      console.warn("Help modal element not found");
    }
    const helpButton = document.getElementById("help-button");
    if (helpButton) {
      helpButton.addEventListener("click", () => {
        if (hlpModal && hlpModal instanceof HelpModal) {
          hlpModal.open();
        }
      });
    }

    this.storeModal = document.getElementById("page-item-store") as StoreModal;
    if (!this.storeModal || !(this.storeModal instanceof StoreModal)) {
      console.warn("Store modal element not found");
    }

    this.storeModal.refresh();

    window.addEventListener("showPage", (e: any) => {
      if (typeof e?.detail === "string" && e.detail === "page-play") {
        setTimeout(() => {
          this.storeModal.refresh();
        }, 50);
      }
    });

    this.tokenLoginModal = document.querySelector(
      "token-login",
    ) as TokenLoginModal;
    if (
      !this.tokenLoginModal ||
      !(this.tokenLoginModal instanceof TokenLoginModal)
    ) {
      console.warn("Token login modal element not found");
    }

    this.matchmakingModal = document.querySelector(
      "matchmaking-modal",
    ) as MatchmakingModal;
    if (
      !this.matchmakingModal ||
      !(this.matchmakingModal instanceof MatchmakingModal)
    ) {
      console.warn("Matchmaking modal element not found");
    }

    this.rewardsModal = document.querySelector("rewards-modal") as RewardsModal;
    if (!this.rewardsModal || !(this.rewardsModal instanceof RewardsModal)) {
      console.warn("Rewards modal element not found");
    }

    this.steamLinkModal = document.querySelector(
      "steam-link-modal",
    ) as SteamLinkModal;
    if (
      !this.steamLinkModal ||
      !(this.steamLinkModal instanceof SteamLinkModal)
    ) {
      console.warn("Steam link modal element not found");
    }

    const onUserMe = async (userMeResponse: UserMeResponse | false) => {
      if (crazyGamesSDK.isOnCrazyGames()) {
        void updateCrazyGamesNavButton();
      } else {
        updateAccountNavButton(userMeResponse);
      }
      const isAdFree =
        userMeResponse !== false && userMeResponse.player?.adfree === true;
      window.adsEnabled =
        !isAdFree && !crazyGamesSDK.isOnCrazyGames() && !isDesktopShell();
      // Ad-eligible users only: paid/adfree users must never load Admiral (its
      // adblock popup fires autonomously once the payload runs). Start watching
      // adblock state; once a blocker is ever detected the in-game ad is
      // suppressed forever (persisted) — those users are highly ad-sensitive.
      if (window.adsEnabled) {
        loadAdmiral();
        // Admiral's read is more reliable than our DOM bait, so use it as a
        // fast initial signal. A blocker that whitelists this site still shows
        // ads, so "blocked" means adblocking AND not whitelisted.
        onAdmiralMeasured((res) => {
          adGatekeeper.seed(
            res.adblocking === true && res.whitelisted !== true,
          );
        });
        adGatekeeper.start();
      }
      document.dispatchEvent(
        new CustomEvent("userMeResponse", {
          detail: userMeResponse,
          bubbles: true,
          cancelable: true,
        }),
      );

      if (userMeResponse !== false) {
        // Authorized
        console.log(
          `Your player ID is ${userMeResponse.player.publicId}\n` +
            "Sharing this ID will allow others to view your game history and stats.",
        );

        // Resume a Steam-link flow that was interrupted by a login redirect
        // (Discord/Google OAuth, magic link): the modal stashed either a
        // token or a bare code-entry intent and sent the player to log in
        // via #modal=account, so a login redirect commonly lands back there
        // rather than on a clean "/" — this must NOT be gated on
        // cleanHomepage below. Only resume once login is confirmed:
        // resumePendingSteamLink() consumes the stash on read, so a
        // speculative call while logged out would burn an entry that a
        // *later* successful login should still get to resume.
        if (resumePendingSteamLink(this.steamLinkModal)) {
          return;
        }

        // Popups below only on a clean homepage load, never over a deep link
        // (join URL, #modal=..., #purchase-completed, ...).
        const cleanHomepage =
          window.location.pathname === "/" && window.location.hash === "";

        // The server renamed this subscriber to TEMPORARY#### because their
        // bare name was exclusively taken while they were unentitled; the
        // rename is free (cooldown cleared). Prompt for a real name; takes
        // priority over the rewards popup, which waits for the next load
        // rather than stacking a second overlay on the rename form.
        const { usernameStatus, usernameBase } = userMeResponse.player;
        if (
          cleanHomepage &&
          (usernameStatus === "premium" || usernameStatus === "indefinite") &&
          isTemporaryUsername(usernameBase)
        ) {
          const goRename = await showInGameConfirm(
            translateText("account_modal.username_temporary_prompt"),
            {
              heading: translateText("account_modal.username_title"),
              variant: "warning",
              confirmText: translateText(
                "account_modal.username_temporary_prompt_confirm",
              ),
            },
          );
          if (goRename) {
            window.location.hash = "modal=change-username";
          }
          return;
        }

        // Unclaimed-rewards popup.
        const rewards = userMeResponse.player.rewards ?? [];
        if (rewards.length > 0 && cleanHomepage) {
          this.rewardsModal?.openWithRewards(rewards);
        }
      }
    };

    // A profile request issued before a logout can still be in flight when the
    // session goes, and its 200 was fetched with a JWT that was valid at the
    // time. Applying it afterwards would put the expired account back in the
    // nav and re-disable ads, so a response is only applied while the session
    // it was fetched under is still current.
    let authGeneration = 0;
    const applyUserMe =
      (generation: number) => (userMeResponse: UserMeResponse | false) => {
        if (generation !== authGeneration) return;
        void onUserMe(userMeResponse);
      };

    // A session dropped in the background — an expired refresh token, a 401 on
    // any endpoint — clears itself deep inside Auth, where none of the above
    // is reachable. Routing it through onUserMe means the nav button, its
    // cached profile and window.adsEnabled all follow, rather than only the
    // components listening for userMeResponse.
    document.addEventListener("session-cleared", () => {
      authGeneration++;
      void onUserMe(false);
    });

    if ((await userAuth()) === false) {
      // Not logged in
      onUserMe(false);
    } else {
      // JWT appears to be valid
      // TODO: Add caching
      getUserMe().then(applyUserMe(authGeneration));
    }

    // Re-run auth when the player signs into CrazyGames mid-session. Logout
    // reloads the page, so only login needs handling here.
    crazyGamesSDK.addAuthListener(() => {
      invalidateUserMe();
      const generation = authGeneration;
      reauthAfterCrazyGamesChange().then((result) =>
        result === false
          ? applyUserMe(generation)(false)
          : getUserMe().then(applyUserMe(generation)),
      );
    });

    // The desktop status bar's Retry. Orchestrated here rather than in the
    // bar because a successful sign-in also has to refresh userMe, the nav
    // account button and the cached profile -- the same reason the
    // CrazyGames listener above lives here. The authGeneration guard means a
    // response that arrives after another auth change cannot be applied.
    // Subscribe to the bridge directly rather than to the status bar's
    // re-broadcast. The bar subscribes when its element upgrades and the
    // bridge replays the current state immediately, so that event fires long
    // before this code runs (it sits after `await userAuth()`), and a listener
    // added here would miss it. That matters most for a `staged` update, which
    // is persisted across restarts and then never re-emitted -- the gate would
    // sit on a null update state forever. subscribe() replays on subscribe and
    // the updater supports multiple subscribers, so this is safe alongside the
    // bar's own subscription.
    desktopUpdate()?.subscribe((state) => {
      this.desktopUpdateState = state;
    });

    document.addEventListener("desktop-session-retry", () => {
      invalidateUserMe();
      const generation = authGeneration;
      retrySteamSignIn().then((result) =>
        result === false
          ? applyUserMe(generation)(false)
          : getUserMe().then(applyUserMe(generation)),
      );
    });

    const settingsModal = document.querySelector(
      "user-setting",
    ) as UserSettingModal;
    if (!settingsModal || !(settingsModal instanceof UserSettingModal)) {
      console.warn("User settings modal element not found");
    }
    document
      .getElementById("settings-button")
      ?.addEventListener("click", () => {
        if (settingsModal && settingsModal instanceof UserSettingModal) {
          settingsModal.open();
        }
      });

    this.hostModal = document.querySelector(
      "host-lobby-modal",
    ) as HostPrivateLobbyModal;
    if (!this.hostModal || !(this.hostModal instanceof HostPrivateLobbyModal)) {
      console.warn("Host private lobby modal element not found");
    } else {
      this.hostModal.eventBus = this.eventBus;
    }

    this.joinModal = document.querySelector(
      "join-lobby-modal",
    ) as JoinLobbyModal;
    if (!this.joinModal || !(this.joinModal instanceof JoinLobbyModal)) {
      console.warn("Join lobby modal element not found");
    } else {
      this.joinModal.eventBus = this.eventBus;
    }

    // Attempt to join lobby
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => this.handleUrl());
    } else {
      this.handleUrl();
    }

    // An invite accepted from outside the app is parked by the shell, because
    // it arrives before this renderer exists. Pull it now that we are alive.
    void desktopPresence
      .consumePendingInvite()
      .then((gameId) => (gameId === null ? undefined : this.openInvite(gameId)))
      .catch(() => undefined);

    // Invites arriving while we are already running. The pushed id is
    // deliberately ignored: the shell parks every invite as well as pushing
    // it, so the push is only a nudge and the parked copy is the single
    // source of truth. Pulling here is what clears it -- otherwise leaving a
    // game (a full page load) would re-run the pull above and force the join
    // modal open on a match that has already finished.
    desktopPresence.subscribeInvites(() => {
      void desktopPresence
        .consumePendingInvite()
        .then((gameId) =>
          gameId === null ? undefined : this.openInvite(gameId),
        )
        .catch(() => undefined);
    });

    const onHashUpdate = () => {
      // Router-managed hash changes (#modal=...) are handled by the router
      // syncing in/out; we don't need to tear down the lobby state for them.
      if (modalRouter.isHashRouted()) {
        modalRouter.routeFromHash();
        return;
      }

      // Reset the UI to its initial state
      this.joinModal?.close();

      onJoinChanged();
    };

    const leaveGame = () => {
      crazyGamesSDK.gameplayStop().then(() => {
        // redirect to the home page
        window.location.href = "/";
      });
    };

    const onPopState = () => {
      if (this.currentUrl !== null && this.lobbyHandle !== null) {
        console.info("Game is active");

        if (!this.lobbyHandle.stop()) {
          console.info("Player is active, ask before leaving game");

          // We can't block navigation on an async confirmation, so restore the
          // history entry immediately and only leave once the player confirms.
          history.pushState(null, "", this.currentUrl);
          showInGameConfirm(translateText("help_modal.exit_confirmation")).then(
            (isConfirmed) => {
              if (isConfirmed) leaveGame();
            },
          );
          return;
        }

        console.info("Player is not active, leave the game immediately");

        leaveGame();
      } else {
        console.info("Game not active, handle hash update");

        onHashUpdate();
      }
    };

    const onJoinChanged = () => {
      if (this.lobbyHandle !== null) {
        this.handleLeaveLobby();
      }

      // Attempt to join lobby
      this.handleUrl();
    };

    // Handle browser navigation & manual hash edits
    window.addEventListener("popstate", onPopState);
    window.addEventListener("hashchange", onHashUpdate);
    window.addEventListener("join-changed", onJoinChanged);

    function updateSliderProgress(slider: HTMLInputElement) {
      const percent =
        ((Number(slider.value) - Number(slider.min)) /
          (Number(slider.max) - Number(slider.min))) *
        100;
      slider.style.setProperty("--progress", `${percent}%`);
    }

    document
      .querySelectorAll<HTMLInputElement>(
        "#bots-count, #private-lobby-bots-count",
      )
      .forEach((slider) => {
        updateSliderProgress(slider);
        slider.addEventListener("input", () => updateSliderProgress(slider));
      });
  }

  private async handleUrl() {
    // Wait for modal custom elements to be defined
    await Promise.all([
      customElements.whenDefined("join-lobby-modal"),
      customElements.whenDefined("host-lobby-modal"),
    ]);

    // Check if CrazyGames SDK is enabled first (no hash needed in CrazyGames)
    if (crazyGamesSDK.isOnCrazyGames()) {
      const lobbyId = await crazyGamesSDK.getInviteGameId();
      console.log("got game id", lobbyId);
      if (lobbyId && GAME_ID_REGEX.test(lobbyId)) {
        console.log("game parsed successfully");
        // Wait 2 seconds to ensure all elements are actually loaded,
        // On low end-chromebooks the join modal was not registered in time.
        await new Promise((resolve) => setTimeout(resolve, 2000));
        window.showPage?.("page-join-lobby");
        this.joinModal?.open({ lobbyId });
        console.log(`CrazyGames: joining lobby ${lobbyId} from invite param`);
        return;
      }
    }
    crazyGamesSDK.isInstantMultiplayer().then((isInstant) => {
      if (isInstant) {
        console.log(
          `CrazyGames: joining instant multiplayer lobby from CrazyGames`,
        );
        this.hostModal.open();
      }
    });

    const strip = () =>
      history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search,
      );

    const alertAndStrip = (message: string) => {
      void showInGameAlert(message);
      strip();
    };

    const hash = window.location.hash;

    // Decode the hash first to handle encoded characters
    const decodedHash = decodeURIComponent(hash);
    const params = new URLSearchParams(decodedHash.split("?")[1] || "");

    // Handle different hash sections
    if (decodedHash.startsWith("#purchase-completed")) {
      // Parse params after the ?
      const status = params.get("status");

      if (status !== "true") {
        alertAndStrip(translateText("store.purchase_failed"));
        return;
      }

      const type = params.get("type");
      if (type === "currency_pack") {
        alertAndStrip(translateText("store.currency_pack_purchase_success"));
        return;
      }

      if (type === "custom_currency") {
        // Plutonium is credited asynchronously by the Stripe webhook; the
        // balance refreshes from /users/@me on the next load.
        alertAndStrip(translateText("store.custom_currency_purchase_success"));
        return;
      }

      if (type === "subscription_tier") {
        strip();
        invalidateUserMe();
        // Reload only once the dialog is dismissed, like the blocking alert
        // this replaced.
        void showInGameAlert(
          translateText("store.subscription_purchase_success"),
        ).then(() => window.location.reload());
        return;
      }

      const cosmeticName = params.get("cosmetic");
      if (!cosmeticName) {
        void showInGameAlert(translateText("common.error_generic"));
        console.error("purchase-completed but no pattern name");
        return;
      }

      completeCosmeticPurchaseReturn(cosmeticName, params.get("login-token"), {
        strip,
        alertAndStrip,
        openTokenLogin: (token) => this.tokenLoginModal.openWithToken(token),
        refreshStore: () => this.storeModal.refresh(),
      });
      return;
    }

    if (decodedHash.startsWith("#token-login")) {
      const token = params.get("token-login");

      if (!token) {
        alertAndStrip(translateText("error_modal.login_failed"));
        return;
      }

      strip();
      this.tokenLoginModal.openWithToken(token);
      return;
    }

    // The desktop Electron shell's account-linking gate opens the browser
    // here (see SteamLink.ts for the full handoff). Checked against the raw
    // hash, not decodedHash — parseSteamLinkToken's prefix match is exact
    // and the token itself is opaque, so no decoding is needed or expected.
    const steamLinkToken = parseSteamLinkToken(hash);
    if (steamLinkToken) {
      strip();
      void this.steamLinkModal?.openWithToken(steamLinkToken);
      return;
    }

    // Fallback: the gate's browser handoff itself can fail (wrong default
    // browser, an odd Linux setup, Steam's overlay browser), in which case it
    // shows an 8-character code instead and tells the player to enter it on
    // the website. There's no token in that case, so parseSteamLinkToken
    // above returns null — this is the bare `#steam-link` hash the code path
    // lands on instead (see SteamLink.ts's isSteamLinkHash).
    if (isSteamLinkHash(hash)) {
      strip();
      void this.steamLinkModal?.openForCodeEntry();
      return;
    }

    // On a versioned replay shell the pathname IS the game id: the worker
    // serves the record's matching build at replay.<domain>/<gameId> (see
    // VersionedReplay.ts).
    if (isReplayShellHost(window.location.hostname)) {
      const replayGameId = window.location.pathname.slice(1);
      if (GAME_ID_REGEX.test(replayGameId)) {
        window.showPage?.("page-join-lobby");
        this.joinModal.open({ lobbyId: replayGameId });
        console.log(`joining replay ${replayGameId}`);
        return;
      }
    }

    const pathMatch = window.location.pathname.match(
      /^\/(?:w\d+\/)?game\/([^/]+)/,
    );
    const lobbyId =
      pathMatch && GAME_ID_REGEX.test(pathMatch[1]) ? pathMatch[1] : null;
    if (lobbyId) {
      // ?host means the lobby creator is returning to a successor lobby they
      // reused from the win screen: reopen the host view bound to the existing
      // lobby instead of the join flow. Non-creators who hit this URL still get
      // treated as normal joiners by the server.
      const returningAsHost = new URLSearchParams(window.location.search).has(
        "host",
      );
      if (returningAsHost) {
        // open() reveals the inline page itself (it calls showPage internally).
        // Calling showPage first would open the modal once with no args and
        // spuriously create a lobby before this attach call runs.
        this.hostModal.open({ existingLobbyId: lobbyId });
        console.log(`reopening host lobby ${lobbyId}`);
        return;
      }
      // ?spectate is the watch-only form of the same lobby link, so a cast or
      // an archive can hand out a URL that never takes a player slot.
      const spectate = new URLSearchParams(window.location.search).has(
        "spectate",
      );
      window.showPage?.("page-join-lobby");
      this.joinModal.open({ lobbyId, spectate });
      console.log(`${spectate ? "spectating" : "joining"} lobby ${lobbyId}`);
      return;
    }
    if (modalRouter.routeFromHash()) {
      return;
    }
    if (decodedHash.startsWith("#affiliate=")) {
      const affiliateCode = decodedHash.replace("#affiliate=", "");
      strip();
      if (affiliateCode) {
        this.storeModal?.open({ affiliateCode });
      }
    }
    if (decodedHash.startsWith("#refresh")) {
      window.location.href = "/";
    }

    const requeueMode = this.consumeRequeueUrl();
    if (requeueMode !== null) {
      document.dispatchEvent(
        new CustomEvent("open-matchmaking", {
          detail: { mode: requeueMode },
        }),
      );
    }
  }

  // Returns the requeue mode ("/?requeue" = 1v1, "/?requeue=2v2" = 2v2), or
  // null when the URL has no requeue param.
  private consumeRequeueUrl(): "1v1" | "2v2" | null {
    const searchParams = new URLSearchParams(window.location.search);
    if (!searchParams.has("requeue")) {
      return null;
    }
    const mode = searchParams.get("requeue") === "2v2" ? "2v2" : "1v1";

    searchParams.delete("requeue");
    const newUrl =
      window.location.pathname +
      (searchParams.toString() ? `?${searchParams.toString()}` : "") +
      window.location.hash;
    history.replaceState(null, "", newUrl);
    return mode;
  }

  private desktopUpdateState: DesktopUpdateState | null = null;

  /**
   * The real multiplayer gate. The entry-point components dim their own
   * buttons, but EVERY join -- theirs, matchmaking's, a deep link, the
   * host/join modals -- funnels through handleJoinLobby, and most of those
   * never pass a button. Matchmaking is the sharpest case: it dispatches
   * join-lobby itself when a match is found, with no click to intercept, so
   * without this a signed-out player queues, matches, and is closed by the
   * server with the Turnstile error this whole feature exists to replace.
   *
   * The decision itself lives in shouldBlockDesktopJoin, which is pure and
   * unit-tested; this adds the shell check, the modal cleanup and the wiggle.
   *
   * Draws attention to the status bar rather than failing silently, matching
   * what the dimmed buttons do.
   */
  private blockedDesktopJoin(lobby: JoinLobbyEvent): boolean {
    if (!isDesktopShell()) return false;
    if (
      !shouldBlockDesktopJoin(
        lobby,
        this.desktopUpdateState,
        getDesktopSessionState(),
      )
    ) {
      return false;
    }
    // The dispatcher may already have told the player they are in a lobby:
    // JoinLobbyModal dispatches only after it has joined and rendered
    // "joined, waiting", and HostLobbyModal after the server lobby exists.
    // Refusing without closing those would leave the UI claiming a lobby the
    // client never entered, with the game starting without them.
    this.joinModal?.close();
    this.hostModal?.close();
    (
      document.querySelector("desktop-status-bar") as
        | (HTMLElement & { wiggle?: () => void })
        | null
    )?.wiggle?.();
    return true;
  }

  private async handleJoinLobby(event: CustomEvent<JoinLobbyEvent>) {
    const lobby = event.detail;
    if (this.usernameInput && !this.usernameInput.canPlay()) {
      return;
    }
    if (this.blockedDesktopJoin(lobby)) {
      return;
    }
    // Only once the join is actually going ahead: a refused dispatch that
    // bumped this would supersede a legitimate join still awaiting userAuth
    // and cosmetics, stopping it as stale and leaving the player nowhere.
    this.mostRecentJoinEvent = event.timeStamp;

    console.log(`joining lobby ${lobby.gameID}`);
    // Entering a lobby. Singleplayer, public lobbies and replays know their
    // config up front; everything else is filled in by the lobby_info
    // subscription in initialize() a moment later.
    const joinConfig =
      lobby.gameStartInfo?.config ??
      lobby.publicLobbyInfo?.gameConfig ??
      lobby.gameRecord?.info.config;
    const joinInfo = lobby.publicLobbyInfo;
    this.presenceInGame = false;
    this.presenceSpectating = lobby.spectator === true;
    this.presenceDetail = {
      gameType: joinConfig?.gameType,
      gameMode: joinConfig?.gameMode,
      map: presenceMapKey(joinConfig?.gameMap),
      playerCount:
        joinInfo === undefined
          ? undefined
          : "numClients" in joinInfo
            ? joinInfo.numClients
            : joinInfo.clients?.filter((c) => !c.spectator).length,
      maxPlayers: joinConfig?.maxPlayers,
      // Omitted for singleplayer and replays: no server hosts those ids, so
      // advertising one has the shell offer friends a Join that cannot work.
      // The optional field already means "not joinable".
      lobbyId:
        lobby.source === "singleplayer" || lobby.gameRecord !== undefined
          ? undefined
          : lobby.gameID,
    };
    this.emitPresence();

    if (this.lobbyHandle !== null) {
      console.log("joining lobby, stopping existing game");
      this.lobbyHandle.stop(true);
      setInGameSignal(false);
    }
    if (lobby.source === "public") {
      this.joinModal?.open({
        lobbyId: lobby.gameID,
        lobbyInfo: lobby.publicLobbyInfo,
      });
    }
    // Only update URL immediately for private lobbies, not public ones
    if (lobby.source !== "public") {
      this.updateJoinUrlForShare(lobby.gameID);
    }
    const auth = await userAuth();
    const playerRole = auth !== false ? (auth.claims.role ?? null) : null;
    // Ensure the one-shot Steam name-seed has settled before reading
    // getUsername(), mirroring how getClanCheck() runs in parallel with the
    // handshake. whenSeeded() always resolves (falling back to the generated
    // anon name on failure/timeout), so this can only delay, never block.
    await this.usernameInput?.whenSeeded();
    // One resolution for the whole join: the name and the verified badge have
    // to describe the same decision, so they are read together rather than
    // asked for separately.
    const resolvedName =
      this.usernameInput?.resolvedName() ?? fallbackPlayerName();
    const newLobbyHandle = joinLobby(this.eventBus, {
      gameID: lobby.gameID,
      cosmetics: await getPlayerCosmeticsRefs({
        verified: resolvedName.verified,
      }),
      turnstileToken: await this.getTurnstileToken(lobby),
      playerName: resolvedName.name,
      playerClanTag: this.usernameInput?.getClanTag() ?? null,
      clanTagCheck: this.usernameInput?.getClanCheck(),
      playerRole,
      gameStartInfo:
        lobby.gameStartInfo ??
        // Replays simulate from the archived record; re-apply the server's
        // wire blanking or team games desync (see toWireGameStartInfo).
        (lobby.gameRecord
          ? toWireGameStartInfo(lobby.gameRecord.info)
          : undefined),
      gameRecord: lobby.gameRecord,
      spectator: lobby.spectator,
    });

    if (this.mostRecentJoinEvent !== event.timeStamp) {
      newLobbyHandle.stop(true);
      console.warn("Join requested, but was superseded");
      return;
    }

    this.lobbyHandle = newLobbyHandle;

    this.lobbyHandle.prestart.then(() => {
      // The game is actually starting now (lobby wait is over). Let listeners that stay up
      // through the wait (e.g. the featured-stream panel) hide at this point instead of on join.
      document.dispatchEvent(new CustomEvent("game-starting"));
      // Earliest point the lobby is provably closed: the server has stopped
      // broadcasting lobby_info and refuses new seats, so the shell must stop
      // advertising this as joinable even though terrain is still loading.
      this.presenceInGame = true;
      this.emitPresence();
      console.log("Closing modals");
      document.getElementById("settings-button")?.classList.add("hidden");
      if (this.usernameInput) {
        // fix edge case where username-validation-error is re-rendered and hidden tag removed
        this.usernameInput.validationError = "";
      }
      document
        .getElementById("username-validation-error")
        ?.classList.add("hidden");
      // Disarm BOTH lobby modals before closing either: closing any
      // page-modal navigates via showPage, which force-closes the currently
      // visible page — the other lobby modal. If that one is still armed,
      // its onClose leaves the lobby and disconnects the player mid
      // game-start (host or joiner, depending on close order).
      this.hostModal?.disarmLeaveOnClose();
      this.joinModal?.disarmLeaveOnClose();
      this.hostModal?.closeWithoutLeaving();
      this.joinModal?.closeWithoutLeaving();
      [
        "single-player-modal",
        "game-starting-modal",
        "game-top-bar",
        "help-modal",
        "user-setting",
        "troubleshooting-modal",
        "inventory-modal",
        "store-modal",
        "language-modal",
        "news-modal",
        "account-button",
        "leaderboard-button",
        "token-login",
        "steam-link-modal",
        "matchmaking-modal",
        "clan-modal",
        "account-settings-modal",
        "change-username-modal",
        "subscription-modal",
        "lang-selector",
        "homepage-promos",
      ].forEach((tag) => {
        const modal = document.querySelector(tag) as HTMLElement & {
          close?: () => void;
          isModalOpen?: boolean;
        };
        if (modal?.close) {
          modal.close();
        } else if (modal && "isModalOpen" in modal) {
          modal.isModalOpen = false;
        }
      });
      this.gameModeSelector.stop();
      hideMenuChrome();

      crazyGamesSDK.loadingStart();

      // show when the game loads
      const startingModal = document.querySelector(
        "game-starting-modal",
      ) as GameStartingModal;
      if (startingModal && startingModal instanceof GameStartingModal) {
        startingModal.show();
      }
    });

    this.lobbyHandle.join.then(() => {
      this.joinModal?.closeWithoutLeaving();
      this.gameModeSelector.stop();
      incrementGamesPlayed();

      hideMenuChrome();

      if (window.PageOS?.session?.newPageView) {
        window.PageOS.session.newPageView();
      }
      crazyGamesSDK.loadingStop();
      crazyGamesSDK.gameplayStart();
      setInGameSignal(true);

      const lobbyIdHidden = !this.userSettings.lobbyIdVisibility();
      if (isReplayShellHost(window.location.hostname)) {
        // Keep the canonical replay URL (replay.<domain>/<gameId>): the
        // /game/<id> shape and the #refresh trampoline only exist on the
        // game-server origin, so rewriting here would leave a URL that 404s
        // when reloaded or shared (see VersionedReplay.ts).
        history.pushState(null, "", window.location.pathname);
      } else {
        // Ensure there's a homepage entry in history before adding the lobby entry
        if (window.location.hash === "" || window.location.hash === "#") {
          history.replaceState(null, "", window.location.origin + "#refresh");
        }
        history.pushState(
          null,
          "",
          lobbyIdHidden
            ? "/streamer-mode"
            : `/${ClientEnv.workerPath(lobby.gameID)}/game/${lobby.gameID}?live`,
        );
      }

      // Store current URL for popstate confirmation
      this.currentUrl = window.location.href;
    });
  }

  // State is derived rather than passed in so every caller agrees on what
  // "spectating" outranks. Emitting is idempotent -- the shell diffs -- so
  // callers never have to know whether anything actually changed.
  private emitPresence() {
    desktopPresence.set({
      state: this.presenceSpectating
        ? "spectating"
        : this.presenceInGame
          ? "game"
          : "lobby",
      ...this.presenceDetail,
    });
  }

  // Back to the menu, forgetting the lobby we were describing so a later one
  // cannot inherit its map or roster.
  private resetPresenceToMenu() {
    this.presenceDetail = {};
    this.presenceSpectating = false;
    this.presenceInGame = false;
    desktopPresence.set({ state: "menu" });
  }

  // An invite lands the player exactly where a /game/<id> link would. The
  // shell validated the id already; re-checking keeps the invariant next to
  // the modal that trusts it.
  private async openInvite(gameId: string): Promise<void> {
    if (!GAME_ID_REGEX.test(gameId)) return;
    // An invite can arrive mid-match, unlike the CrazyGames invite this path
    // was modelled on, which only ever runs at cold start. Force-opening the
    // join UI would leave it overlaying a game whose socket and render loop
    // keep running underneath. Same rule the back-button exit uses: stop
    // silently when the player is not active, ask first when they are, and
    // drop the invite entirely if they decline.
    if (this.lobbyHandle !== null) {
      // stop() without force is the codebase's "is the player actually in
      // this?" test: it tears the game down and returns true when they are
      // not, and refuses (returning false) when they are.
      if (!this.lobbyHandle.stop()) {
        const confirmed = await showInGameConfirm(
          translateText("help_modal.exit_confirmation"),
        );
        if (!confirmed) return;
      }
      // Navigate rather than leaving in place. handleLeaveLobby() was only
      // ever called during the pre-start lobby wait; every exit from a
      // STARTED game goes through a full location.href navigation, and it is
      // that reload -- not handleLeaveLobby -- which restores the started-game
      // teardown. Two pieces of it have no in-place restore path:
      // gameModeSelector.stop() (line ~1139/1157) kills the public lobby
      // socket, whose start() is only ever called from connectedCallback();
      // and the same block hides every .ad element, which nothing ever
      // un-hides. Leaving in place therefore stranded the player on a
      // homepage with a frozen lobby list and no ad rails whenever the join
      // did not complete -- modal closed, or lobby full/already started.
      //
      // Navigating to the lobby's own /game/<id> URL rather than "/" means
      // the invite survives the reload without needing to be stashed: the
      // path parser in handleUrl() opens the join modal on the way back up,
      // which is the same route a shared lobby link takes.
      // The /w<n>/game/<id> shape only exists on the game-server origin, so
      // this root-relative navigation must not run on the replay shell host --
      // it would resolve against replay.<domain>, 404, and lose the invite,
      // which consumePendingInvite() has already taken. Same guard, for the
      // same reason, as handleJoinLobby and updateJoinUrlForShare above.
      //
      // Not reachable from the desktop shell today: it classifies every
      // https:// URL as open-externally, so redirectToVersionedShell() hands
      // the replay host to the OS browser and this window stays on
      // app://openfront/. That is a policy in a different repo though, and
      // nothing here would notice if it changed -- so guard rather than depend
      // on it. On the replay host, fall back to the in-place leave.
      if (!isReplayShellHost(window.location.hostname)) {
        this.resetPresenceToMenu();
        window.location.href = `/${ClientEnv.workerPath(gameId)}/game/${gameId}`;
        return;
      }
      await this.handleLeaveLobby();
    }
    // A cold-start invite can beat the modal's own upgrade, which would make
    // open() a silent no-op (the CrazyGames invite path waits for the same
    // reason).
    await customElements.whenDefined("join-lobby-modal");
    window.showPage?.("page-join-lobby");
    this.joinModal?.open({ lobbyId: gameId });
    console.log(`joining lobby ${gameId} from desktop invite`);
  }

  private updateJoinUrlForShare(lobbyId: string) {
    const lobbyIdHidden = !this.userSettings.lobbyIdVisibility();
    let targetUrl: string;
    if (isReplayShellHost(window.location.hostname)) {
      // Keep the canonical replay URL (replay.<domain>/<gameId>): the
      // /game/<id> shape only exists on the game-server origin, so rewriting
      // here would leave a URL that 404s when reloaded or shared (see
      // VersionedReplay.ts).
      targetUrl = window.location.pathname;
    } else if (lobbyIdHidden) {
      targetUrl = "/streamer-mode";
    } else {
      targetUrl = `/${ClientEnv.workerPath(lobbyId)}/game/${lobbyId}`;
    }
    const currentUrl = window.location.pathname;

    if (currentUrl !== targetUrl) {
      history.replaceState(null, "", targetUrl);
    }
  }

  private async handleLeaveLobby(event?: CustomEvent) {
    // Above the lobbyHandle guard on purpose. Presence goes to "lobby" when
    // the join starts, but lobbyHandle is only assigned once the handshake
    // finishes; a modal closed during that window dispatches leave-lobby and
    // takes the early return below, stranding the shell on a lobby the player
    // is not in. Leaving in place also means no navigation follows to reset it.
    this.resetPresenceToMenu();

    if (this.lobbyHandle === null) {
      return;
    }
    console.log("leaving lobby, cancelling game");
    this.lobbyHandle.stop(true);
    this.lobbyHandle = null;
    this.currentUrl = null;

    try {
      history.replaceState(null, "", "/");
    } catch (e) {
      console.warn("Failed to restore URL on leave:", e);
    }

    setInGameSignal(false);

    // The inverse of the game-start teardown. Every other exit from a started
    // game navigates, and the reload did this implicitly; this path leaves in
    // place, so it has to do it explicitly (OPE-255). It lives here rather
    // than in openInvite() because handleLeaveLobby is reached from several
    // places and any of them could be the next to hit it after a teardown.
    //
    // The gate asks whether the chrome is torn down, NOT whether we were
    // in-game: the teardown happens at prestart while the in-game signal is
    // only set at join, so gating on the signal missed a leave landing in the
    // window between them. Because the gate no longer reads that signal, it
    // does not matter that setInGameSignal(false) has already run above.
    if (menuChromeIsTornDown()) {
      this.gameModeSelector?.start();
      restoreMenuChrome();
    }

    if (this.joinModal.isOpen()) {
      this.joinModal.close();
      if (event?.detail.cause === "full-lobby") {
        window.dispatchEvent(
          new CustomEvent("show-message", {
            detail: {
              message: translateText("public_lobby.join_timeout"),
              color: "red",
              duration: 3500,
            },
          }),
        );
      }
    }

    crazyGamesSDK.gameplayStop();
  }

  // Puts the player back into the ranked queue. From a pre-start match
  // cancellation the matchmaking modal is still open and rejoins in place,
  // keeping its mode. From a finished game (WinModal passes the mode) the
  // page needs the reload teardown, so navigate home with the requeue
  // param and let consumeRequeueUrl() reopen the queue. A modeless
  // dispatch with no open modal (the player closed it mid-wait) stays a
  // no-op — don't force them back into a queue they left.
  private handleMatchmakingRequeue(
    event: CustomEvent<{ mode?: "1v1" | "2v2" } | undefined>,
  ) {
    if (this.matchmakingModal?.requeue()) {
      return;
    }
    if (event.detail?.mode !== undefined) {
      window.location.href =
        event.detail.mode === "2v2" ? "/?requeue=2v2" : "/?requeue";
    }
  }

  private handleOpenMatchmaking(
    event: CustomEvent<{ mode?: "1v1" | "2v2" } | undefined>,
  ) {
    if (!this.matchmakingModal) return;
    // Always set the mode: dispatchers without a detail (homepage button,
    // requeue URL) mean 1v1 and must reset a lingering 2v2 selection.
    this.matchmakingModal.mode = event.detail?.mode === "2v2" ? "2v2" : "1v1";
    this.matchmakingModal.open();
  }

  private handleKickPlayer(event: CustomEvent) {
    const { target } = event.detail;

    // Forward to eventBus if available
    if (this.eventBus) {
      this.eventBus.emit(new SendKickPlayerIntentEvent(target));
    }
  }

  private handleToggleGameStartTimer() {
    if (this.eventBus) {
      this.eventBus.emit(new SendToggleGameStartTimer());
    }
  }

  private handleUpdateGameConfig(event: CustomEvent) {
    const { config } = event.detail;

    // Forward to eventBus if available
    if (this.eventBus) {
      this.eventBus.emit(new SendUpdateGameConfigIntentEvent(config));
    }
  }

  private async getTurnstileToken(
    lobby: JoinLobbyEvent,
  ): Promise<string | null> {
    if (
      ClientEnv.env() === GameEnv.Dev ||
      ClientEnv.instanceId() === "desktop" ||
      // Single-player and replays: no server to verify a token against (and
      // on the CDN replay shells Turnstile cannot load at all). Shared with
      // the desktop gate so the exemption has one definition.
      !joinIsGateable(lobby)
    ) {
      return null;
    }

    // Always request a new token on crazygames.
    if (this.turnstileTokenPromise === null || crazyGamesSDK.isOnCrazyGames()) {
      console.log("No prefetched turnstile token, getting new token");
      return (await getTurnstileToken())?.token ?? null;
    }

    const token = await this.turnstileTokenPromise;
    // Clear promise so a new token is fetched next time
    this.turnstileTokenPromise = null;
    if (!token) {
      console.log("No turnstile token");
      return null;
    }

    const tokenTTL = 3 * 60 * 1000;
    if (Date.now() < token.createdAt + tokenTTL) {
      console.log("Prefetched turnstile token is valid");

      return token.token;
    } else {
      console.log("Turnstile token expired, getting new token");
      return (await getTurnstileToken())?.token ?? null;
    }
  }
}

// Hide elements with no-crazygames class if on CrazyGames
const hideCrazyGamesElements = () => {
  if (crazyGamesSDK.isOnCrazyGames()) {
    document.querySelectorAll(".no-crazygames").forEach((el) => {
      (el as HTMLElement).style.display = "none";
    });
  }
};

// Initialize the client when the DOM is loaded
const bootstrap = () => {
  // Prevent Safari's page-level pinch-zoom, which ignores `user-scalable=no`
  // on iOS and can softlock the HUD. See issue #2330.
  installSafariPinchZoomBlocker();

  // Same for double-tap "smart zoom", which `touch-action: manipulation`
  // alone does not reliably stop on iOS. See issue #4609.
  installDoubleTapZoomBlocker();

  // Chrome and Firefox report a trackpad pinch as ctrl+wheel, which only the
  // map canvas cancels — so pinching over a HUD panel zoomed the page instead
  // of the map. See issue #5098.
  installCtrlWheelZoomBlocker();

  initLayout();
  new Client().initialize();
  initNavigation();

  // Hide elements immediately
  hideCrazyGamesElements();

  // Also hide elements after a short delay to catch late-rendered components
  setTimeout(hideCrazyGamesElements, 100);
  setTimeout(hideCrazyGamesElements, 500);

  // Populate the CrazyGames account buttons once the nav/top-bar have rendered
  // (onUserMe also refreshes them after auth and on mid-session sign-in).
  setTimeout(() => void updateCrazyGamesNavButton(), 500);
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootstrap);
} else {
  bootstrap();
}

async function getTurnstileToken(): Promise<{
  token: string;
  createdAt: number;
}> {
  // Wait for Turnstile script to load (handles slow connections)
  let attempts = 0;
  while (typeof window.turnstile === "undefined" && attempts < 100) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    attempts++;
  }

  if (typeof window.turnstile === "undefined") {
    throw new Error("Failed to load Turnstile script");
  }

  const widgetId = window.turnstile.render("#turnstile-container", {
    sitekey: ClientEnv.turnstileSiteKey(),
    size: "normal",
    appearance: "interaction-only",
    theme: "light",
  });

  return new Promise((resolve, reject) => {
    window.turnstile.execute(widgetId, {
      callback: (token: string) => {
        window.turnstile.remove(widgetId);
        console.log(`Turnstile token received: ${token}`);
        resolve({ token, createdAt: Date.now() });
      },
      "error-callback": (errorCode: string) => {
        window.turnstile.remove(widgetId);
        console.error(`Turnstile error: ${errorCode}`);
        void showInGameAlert(
          translateText("error_modal.turnstile_error", { code: errorCode }),
        );
        reject(new Error(`Turnstile failed: ${errorCode}`));
      },
    });
  });
}
