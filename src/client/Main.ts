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
  PublicGameInfo,
} from "../core/Schemas";
import { GameEnv } from "../core/configuration/Config";
import { GameType } from "../core/game/Game";
import { UserSettings } from "../core/game/UserSettings";
import "./AccountModal";
import { adGatekeeper } from "./AdGatekeeper";
import { loadAdmiral, onAdmiralMeasured } from "./Admiral";
import { getUserMe, invalidateUserMe } from "./Api";
import { reauthAfterCrazyGamesChange, userAuth } from "./Auth";
import "./ClanModal";
import { joinLobby, type JoinLobbyResult } from "./ClientGameRunner";
import { getPlayerCosmeticsRefs } from "./Cosmetics";
import "./CosmeticsInput";
import "./CosmeticsModal";
import { CosmeticsModal } from "./CosmeticsModal";
import { updateCrazyGamesNavButton } from "./CrazyGamesAccountButton";
import { crazyGamesSDK } from "./CrazyGamesSDK";
import { isDesktopShell } from "./DesktopShell";
import "./FeaturedStream";
import "./FlagInput";
import { FlagInput } from "./FlagInput";
import "./FlagInputModal";
import { FlagInputModal } from "./FlagInputModal";
import "./GameModeSelector";
import { GameModeSelector } from "./GameModeSelector";
import { GameStartingModal } from "./GameStartingModal";
import "./GameStatsModal";
import "./GoogleAdElement";
import { HelpModal } from "./HelpModal";
import "./HomepagePromos";
import { HostLobbyModal as HostPrivateLobbyModal } from "./HostLobbyModal";
import { showInGameConfirm } from "./InGameModal";
import { JoinLobbyModal } from "./JoinLobbyModal";
import "./LangSelector";
import { LangSelector } from "./LangSelector";
import { initLayout } from "./Layout";
import "./LeaderboardModal";
import "./Matchmaking";
import { MatchmakingModal } from "./Matchmaking";
import { modalRouter } from "./ModalRouter";
import { initNavigation } from "./Navigation";
import "./NewsModal";
import "./PlayerProfileModal";
import { RewardsModal } from "./RewardsModal";
import "./SinglePlayerModal";
import "./SteamLinkSignpost";
import { StoreModal } from "./Store";
import { TokenLoginModal } from "./TokenLoginModal";
import {
  SendKickPlayerIntentEvent,
  SendToggleGameStartTimer,
  SendUpdateGameConfigIntentEvent,
} from "./Transport";
import { UserSettingModal } from "./UserSettingModal";
import "./UsernameInput";
import { genAnonUsername, UsernameInput } from "./UsernameInput";
import {
  getDiscordAvatarUrl,
  incrementGamesPlayed,
  isInIframe,
  translateText,
} from "./Utils";
import "./components/BannedModal";
import "./components/MarketingConsentToast";
import { installSafariPinchZoomBlocker } from "./utilities/DisableSafariPinchZoom";

import "./components/DesktopNavBar";
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

function updateAccountNavButton(userMeResponse: UserMeResponse | false) {
  const button = document.getElementById("nav-account-button");
  if (!button) return;

  const avatarEl = document.getElementById("nav-account-avatar") as
    | (HTMLImageElement & { _navToken?: symbol })
    | null;
  const personIconEl = document.getElementById(
    "nav-account-person-icon",
  ) as SVGElement | null;
  const emailBadgeEl = document.getElementById(
    "nav-account-email-badge",
  ) as HTMLElement | null;
  const signInTextEl = document.getElementById(
    "nav-account-signin-text",
  ) as HTMLSpanElement | null;

  // Auth state is resolved, so the button no longer shows the loading spinner.
  document
    .getElementById("nav-account-loading-spinner")
    ?.classList.add("hidden");

  // Unique token for this update call
  const navToken = Symbol();
  if (avatarEl) avatarEl._navToken = navToken;

  const showAvatar = (src: string, alt?: string) => {
    if (avatarEl) {
      avatarEl.alt = alt ?? translateText("main.discord_avatar_alt");
      // If the avatar fails to load (bad URL / CDN issue / offline), fall back
      // to the default sign-in UI instead of leaving a broken image.
      avatarEl.onerror = () => {
        if (avatarEl._navToken !== navToken) return;
        avatarEl.onerror = null;
        avatarEl.src = "https://cdn.discordapp.com/embed/avatars/0.png";
      };
      avatarEl.onload = () => {
        // Only handle if this is the latest update
        if (avatarEl._navToken !== navToken) return;
        // Clear error handler after a successful load.
        avatarEl.onerror = null;
      };
      avatarEl.src = src;
      avatarEl.classList.remove("hidden");
    }
    personIconEl?.classList.add("hidden");
    emailBadgeEl?.classList.add("hidden");
    signInTextEl?.classList.add("hidden");
    button?.classList.remove("border", "border-white/20");
  };

  const showSignIn = () => {
    avatarEl?.classList.add("hidden");
    personIconEl?.classList.remove("hidden");
    emailBadgeEl?.classList.add("hidden");
    signInTextEl?.classList.remove("hidden");
    // Restore border when showing signin state
    button?.classList.add("border", "border-white/20");
  };

  const showEmailLoggedIn = () => {
    avatarEl?.classList.add("hidden");
    personIconEl?.classList.remove("hidden");
    emailBadgeEl?.classList.remove("hidden");
    signInTextEl?.classList.add("hidden");
    button?.classList.add("border", "border-white/20");
  };

  const discord =
    userMeResponse !== false ? userMeResponse.user.discord : undefined;
  if (discord && avatarEl) {
    const avatarAlt = translateText("main.user_avatar_alt", {
      username: discord.username,
    });
    const url = getDiscordAvatarUrl(discord);
    if (url) {
      showAvatar(url, avatarAlt);
      return;
    }
  }

  const email =
    userMeResponse !== false ? userMeResponse.user.email : undefined;
  if (email) {
    showEmailLoggedIn();
    return;
  }

  // Google logins have no avatar; show the same person/email badge as magic-link.
  const google =
    userMeResponse !== false ? userMeResponse.user.google : undefined;
  if (google) {
    showEmailLoggedIn();
    return;
  }

  showSignIn();
}

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
    userMeResponse: CustomEvent<UserMeResponse | false>;
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
}

class Client {
  private lobbyHandle: JoinLobbyResult | null = null;
  private eventBus: EventBus = new EventBus();

  private currentUrl: string | null = null;

  private usernameInput: UsernameInput | null = null;
  private flagInput: FlagInput | null = null;

  private hostModal: HostPrivateLobbyModal;
  private joinModal: JoinLobbyModal;
  private gameModeSelector: GameModeSelector;
  private userSettings: UserSettings = new UserSettings();
  private storeModal: StoreModal;
  private tokenLoginModal: TokenLoginModal;
  private matchmakingModal: MatchmakingModal;
  private rewardsModal: RewardsModal;
  private mostRecentJoinEvent: number;

  private turnstileTokenPromise: Promise<{
    token: string;
    createdAt: number;
  }> | null = null;

  async initialize(): Promise<void> {
    crazyGamesSDK.maybeInit();

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
    modalRouter.register("troubleshooting", {
      tag: "troubleshooting-modal",
      pageId: "page-troubleshooting",
    });
    modalRouter.register("cosmetics", { tag: "cosmetics-modal" });
    modalRouter.register("flag-input", { tag: "flag-input-modal" });

    // Prefetch turnstile token so it is available when the user joins a lobby.
    // Desktop (Steam) has no Turnstile script and is server-side exempt, so
    // skip it — otherwise getTurnstileToken() throws "Failed to load Turnstile
    // script" after its load wait.
    this.turnstileTokenPromise =
      ClientEnv.instanceId() === "desktop" ? null : getTurnstileToken();

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

    this.flagInput = document.querySelector("flag-input") as FlagInput;
    if (!this.flagInput) {
      console.warn("Flag input element not found");
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
        this.lobbyHandle.stop(true);
        await crazyGamesSDK.gameplayStop();
      }
    });

    document.addEventListener("join-lobby", this.handleJoinLobby.bind(this));
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

    const flagInputModal = document.querySelector(
      "flag-input-modal",
    ) as FlagInputModal;
    if (!flagInputModal || !(flagInputModal instanceof FlagInputModal)) {
      console.warn("Flag input modal element not found");
    }

    // Attach listener to any flag-input component (desktop or potentially others)
    document.querySelectorAll("flag-input").forEach((flagInput) => {
      flagInput.addEventListener("flag-input-click", () => {
        if (flagInputModal && flagInputModal instanceof FlagInputModal) {
          flagInputModal.open();
        }
      });
    });

    this.storeModal = document.getElementById("page-item-store") as StoreModal;
    if (!this.storeModal || !(this.storeModal instanceof StoreModal)) {
      console.warn("Store modal element not found");
    }

    const cosmeticsModal = document.getElementById(
      "cosmetics-modal",
    ) as CosmeticsModal;
    if (!cosmeticsModal || !(cosmeticsModal instanceof CosmeticsModal)) {
      console.warn("Cosmetics modal element not found");
    }

    // Attach listener to any cosmetics-input component
    document.querySelectorAll("cosmetics-input").forEach((cosmeticsInput) => {
      cosmeticsInput.addEventListener("cosmetics-input-click", () => {
        cosmeticsModal.open();
      });
    });

    if (isInIframe()) {
      const mobileCosmetics = document.getElementById("cosmetics-input-mobile");
      if (mobileCosmetics) mobileCosmetics.style.display = "none";
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

        // Popups below only on a clean homepage load, never over a deep link
        // (join URL, #modal=..., #purchase-completed, ...).
        const cleanHomepage =
          window.location.pathname === "/" && window.location.hash === "";

        // The server renamed this subscriber to TEMPORARY#### because their
        // bare name was exclusively taken while they were unentitled; the
        // rename is free (cooldown cleared). Prompt for a real name; takes
        // priority over the rewards popup — the account modal shows the
        // rewards panel anyway.
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
            window.location.hash = "modal=account";
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

    if ((await userAuth()) === false) {
      // Not logged in
      onUserMe(false);
    } else {
      // JWT appears to be valid
      // TODO: Add caching
      getUserMe().then(onUserMe);
    }

    // Re-run auth when the player signs into CrazyGames mid-session. Logout
    // reloads the page, so only login needs handling here.
    crazyGamesSDK.addAuthListener(() => {
      invalidateUserMe();
      reauthAfterCrazyGamesChange().then((result) =>
        result === false ? onUserMe(false) : getUserMe().then(onUserMe),
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
      alert(message);
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
        alertAndStrip("purchase failed");
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
        alert(translateText("store.subscription_purchase_success"));
        strip();
        invalidateUserMe();
        window.location.reload();
        return;
      }

      const cosmeticName = params.get("cosmetic");
      if (!cosmeticName) {
        alert("Something went wrong. Please contact support.");
        console.error("purchase-completed but no pattern name");
        return;
      }

      const setCosmetic = () => {
        if (cosmeticName.startsWith("pattern:")) {
          this.userSettings.setSelectedPatternName(cosmeticName);
        } else if (cosmeticName.startsWith("flag:")) {
          this.userSettings.setFlag(cosmeticName);
        }
      };
      const token = params.get("login-token");

      if (token) {
        strip();
        window.addEventListener("beforeunload", () => {
          // The page reloads after token login, so we need to save the pattern name
          // in case it is unset during reload.
          setCosmetic();
        });
        this.tokenLoginModal.openWithToken(token);
      } else {
        alertAndStrip(`purchase succeeded: ${cosmeticName}`);
        setCosmetic();
        this.storeModal.refresh();
      }
      return;
    }

    if (decodedHash.startsWith("#token-login")) {
      const token = params.get("token-login");

      if (!token) {
        alertAndStrip(
          `login failed! Please try again later or contact support.`,
        );
        return;
      }

      strip();
      this.tokenLoginModal.openWithToken(token);
      return;
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
      window.showPage?.("page-join-lobby");
      this.joinModal.open({ lobbyId });
      console.log(`joining lobby ${lobbyId}`);
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

  private async handleJoinLobby(event: CustomEvent<JoinLobbyEvent>) {
    const lobby = event.detail;
    this.mostRecentJoinEvent = event.timeStamp;
    if (this.usernameInput && !this.usernameInput.canPlay()) {
      return;
    }

    console.log(`joining lobby ${lobby.gameID}`);
    if (this.lobbyHandle !== null) {
      console.log("joining lobby, stopping existing game");
      this.lobbyHandle.stop(true);
      document.body.classList.remove("in-game");
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
    const newLobbyHandle = joinLobby(this.eventBus, {
      gameID: lobby.gameID,
      cosmetics: await getPlayerCosmeticsRefs(),
      turnstileToken: await this.getTurnstileToken(lobby),
      playerName: this.usernameInput?.getUsername() ?? genAnonUsername(),
      playerClanTag: this.usernameInput?.getClanTag() ?? null,
      clanTagCheck: this.usernameInput?.getClanCheck(),
      playerRole,
      gameStartInfo: lobby.gameStartInfo ?? lobby.gameRecord?.info,
      gameRecord: lobby.gameRecord,
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
        "cosmetics-modal",
        "store-modal",
        "language-modal",
        "news-modal",
        "flag-input-modal",
        "account-button",
        "leaderboard-button",
        "token-login",
        "matchmaking-modal",
        "clan-modal",
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
      document.querySelectorAll(".ad").forEach((ad) => {
        (ad as HTMLElement).style.display = "none";
      });

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

      document.querySelectorAll(".ad").forEach((ad) => {
        (ad as HTMLElement).style.display = "none";
      });

      if (window.PageOS?.session?.newPageView) {
        window.PageOS.session.newPageView();
      }
      crazyGamesSDK.loadingStop();
      crazyGamesSDK.gameplayStart();
      document.body.classList.add("in-game");

      // Ensure there's a homepage entry in history before adding the lobby entry
      if (window.location.hash === "" || window.location.hash === "#") {
        history.replaceState(null, "", window.location.origin + "#refresh");
      }
      const lobbyIdHidden = !this.userSettings.lobbyIdVisibility();
      history.pushState(
        null,
        "",
        lobbyIdHidden
          ? "/streamer-mode"
          : `/${ClientEnv.workerPath(lobby.gameID)}/game/${lobby.gameID}?live`,
      );

      // Store current URL for popstate confirmation
      this.currentUrl = window.location.href;
    });
  }

  private updateJoinUrlForShare(lobbyId: string) {
    const lobbyIdHidden = !this.userSettings.lobbyIdVisibility();
    const targetUrl = lobbyIdHidden
      ? "/streamer-mode"
      : `/${ClientEnv.workerPath(lobbyId)}/game/${lobbyId}`;
    const currentUrl = window.location.pathname;

    if (currentUrl !== targetUrl) {
      history.replaceState(null, "", targetUrl);
    }
  }

  private async handleLeaveLobby(event?: CustomEvent) {
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

    document.body.classList.remove("in-game");

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
      lobby.gameStartInfo?.config.gameType === GameType.Singleplayer
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
        alert(`Turnstile error: ${errorCode}. Please refresh and try again.`);
        reject(new Error(`Turnstile failed: ${errorCode}`));
      },
    });
  });
}
