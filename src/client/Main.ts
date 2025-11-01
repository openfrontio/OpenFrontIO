import version from "../../resources/version.txt";
import { UserMeResponse } from "../core/ApiSchemas";
import { EventBus } from "../core/EventBus";
import { GameRecord, GameStartInfo, ID } from "../core/Schemas";
import { getServerConfigFromClient } from "../core/configuration/ConfigLoader";
import { UserSettings } from "../core/game/UserSettings";
import "./AccountModal";
import { joinLobby } from "./ClientGameRunner";
import { fetchCosmetics } from "./Cosmetics";
import "./DarkModeButton";
import { DarkModeButton } from "./DarkModeButton";
import "./FlagInput";
import { FlagInput } from "./FlagInput";
import { FlagInputModal } from "./FlagInputModal";
import { GameStartingModal } from "./GameStartingModal";
import "./GoogleAdElement";
import { GutterAds } from "./GutterAds";
import { HelpModal } from "./HelpModal";
import { HostLobbyModal as HostPrivateLobbyModal } from "./HostLobbyModal";
import { JoinPrivateLobbyModal } from "./JoinPrivateLobbyModal";
import "./LangSelector";
import { LangSelector } from "./LangSelector";
import { LanguageModal } from "./LanguageModal";
import "./Matchmaking";
import { MatchmakingModal } from "./Matchmaking";
import { NewsModal } from "./NewsModal";
import "./PublicLobby";
import { PublicLobby } from "./PublicLobby";
import { SinglePlayerModal } from "./SinglePlayerModal";
import { TerritoryPatternsModal } from "./TerritoryPatternsModal";
import { TokenLoginModal } from "./TokenLoginModal";
import { SendKickPlayerIntentEvent } from "./Transport";
import { UserSettingModal } from "./UserSettingModal";
import "./UsernameInput";
import { UsernameInput } from "./UsernameInput";
import {
  generateCryptoRandomUUID,
  incrementGamesPlayed,
  isInIframe,
} from "./Utils";
import "./components/NewsButton";
import { NewsButton } from "./components/NewsButton";
import "./components/baseComponents/Button";
import "./components/baseComponents/Modal";
import { getUserMe, isLoggedIn } from "./jwt";
import "./styles.css";

declare global {
  interface Window {
    enableAds: boolean;
    PageOS: {
      session: {
        newPageView: () => void;
      };
    };
    fusetag: {
      registerZone: (id: string) => void;
      destroyZone: (id: string) => void;
      pageInit: (options?: any) => void;
      que: Array<() => void>;
      destroySticky: () => void;
    };
    ramp: {
      que: Array<() => void>;
      passiveMode: boolean;
      spaAddAds: (ads: Array<{ type: string; selectorId: string }>) => void;
      destroyUnits: (adType: string) => void;
      settings?: {
        slots?: any;
      };
      spaNewPage: (url: string) => void;
    };
  }

  // Extend the global interfaces to include your custom events
  interface DocumentEventMap {
    "join-lobby": CustomEvent<JoinLobbyEvent>;
    "kick-player": CustomEvent;
  }
}

export interface JoinLobbyEvent {
  clientID: string;
  // Multiplayer games only have gameID, gameConfig is not known until game starts.
  gameID: string;
  // GameConfig only exists when playing a singleplayer game.
  gameStartInfo?: GameStartInfo;
  // GameRecord exists when replaying an archived game.
  gameRecord?: GameRecord;
}

class Client {
  private gameStop: (() => void) | null = null;
  private eventBus: EventBus = new EventBus();

  private usernameInput: UsernameInput | null = null;
  private flagInput: FlagInput | null = null;
  private darkModeButton: DarkModeButton | null = null;

  private joinModal: JoinPrivateLobbyModal;
  private publicLobby: PublicLobby;
  private userSettings: UserSettings = new UserSettings();
  private patternsModal: TerritoryPatternsModal;
  private tokenLoginModal: TokenLoginModal;
  private matchmakingModal: MatchmakingModal;

  private gutterAds: GutterAds;

  // Night Mode properties
  private nightModeEnabled: boolean = false;
  private nightModeOverlay: HTMLDivElement | null = null;
  private nightModeCursor: HTMLDivElement | null = null;

  constructor() {}

  initialize(): void {
    const gameVersion = document.getElementById(
      "game-version",
    ) as HTMLDivElement;
    if (!gameVersion) {
      console.warn("Game version element not found");
    }
    gameVersion.innerText = version;

    const newsModal = document.querySelector("news-modal") as NewsModal;
    if (!newsModal || !(newsModal instanceof NewsModal)) {
      console.warn("News modal element not found");
    }
    const newsButton = document.querySelector("news-button") as NewsButton;
    if (!newsButton) {
      console.warn("News button element not found");
    } else {
      console.log("News button element found");
    }

    // Comment out to show news button.
    // newsButton.hidden = true;

    const langSelector = document.querySelector(
      "lang-selector",
    ) as LangSelector;
    const languageModal = document.querySelector(
      "language-modal",
    ) as LanguageModal;
    if (!langSelector) {
      console.warn("Lang selector element not found");
    }
    if (!languageModal) {
      console.warn("Language modal element not found");
    }

    this.flagInput = document.querySelector("flag-input") as FlagInput;
    if (!this.flagInput) {
      console.warn("Flag input element not found");
    }

    this.darkModeButton = document.querySelector(
      "dark-mode-button",
    ) as DarkModeButton;
    if (!this.darkModeButton) {
      console.warn("Dark mode button element not found");
    }

    this.usernameInput = document.querySelector(
      "username-input",
    ) as UsernameInput;
    if (!this.usernameInput) {
      console.warn("Username input element not found");
    }

    this.publicLobby = document.querySelector("public-lobby") as PublicLobby;

    window.addEventListener("beforeunload", () => {
      console.log("Browser is closing");
      if (this.gameStop !== null) {
        this.gameStop();
      }
    });

    const gutterAds = document.querySelector("gutter-ads");
    if (!(gutterAds instanceof GutterAds))
      throw new Error("Missing gutter-ads");
    this.gutterAds = gutterAds;

    document.addEventListener("join-lobby", this.handleJoinLobby.bind(this));
    document.addEventListener("leave-lobby", this.handleLeaveLobby.bind(this));
    document.addEventListener("kick-player", this.handleKickPlayer.bind(this));

    const spModal = document.querySelector(
      "single-player-modal",
    ) as SinglePlayerModal;
    if (!spModal || !(spModal instanceof SinglePlayerModal)) {
      console.warn("Singleplayer modal element not found");
    }

    const singlePlayer = document.getElementById("single-player");
    if (singlePlayer === null) throw new Error("Missing single-player");
    singlePlayer.addEventListener("click", () => {
      if (this.usernameInput?.isValid()) {
        spModal.open();
      }
    });

    const hlpModal = document.querySelector("help-modal") as HelpModal;
    if (!hlpModal || !(hlpModal instanceof HelpModal)) {
      console.warn("Help modal element not found");
    }
    const helpButton = document.getElementById("help-button");
    if (helpButton === null) throw new Error("Missing help-button");
    helpButton.addEventListener("click", () => {
      hlpModal.open();
    });

    const flagInputModal = document.querySelector(
      "flag-input-modal",
    ) as FlagInputModal;
    if (!flagInputModal || !(flagInputModal instanceof FlagInputModal)) {
      console.warn("Flag input modal element not found");
    }

    const flgInput = document.getElementById("flag-input_");
    if (flgInput === null) throw new Error("Missing flag-input_");
    flgInput.addEventListener("click", () => {
      flagInputModal.open();
    });

    this.patternsModal = document.querySelector(
      "territory-patterns-modal",
    ) as TerritoryPatternsModal;
    if (
      !this.patternsModal ||
      !(this.patternsModal instanceof TerritoryPatternsModal)
    ) {
      console.warn("Territory patterns modal element not found");
    }
    const patternButton = document.getElementById(
      "territory-patterns-input-preview-button",
    );
    if (isInIframe() && patternButton) {
      patternButton.style.display = "none";
    }

    if (
      !this.patternsModal ||
      !(this.patternsModal instanceof TerritoryPatternsModal)
    ) {
      console.warn("Territory patterns modal element not found");
    }
    if (patternButton === null)
      throw new Error("territory-patterns-input-preview-button");
    this.patternsModal.previewButton = patternButton;
    this.patternsModal.refresh();
    patternButton.addEventListener("click", () => {
      this.patternsModal.open();
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

    const onUserMe = async (userMeResponse: UserMeResponse | false) => {
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
      }
    };

    if (isLoggedIn() === false) {
      // Not logged in
      onUserMe(false);
    } else {
      // JWT appears to be valid
      // TODO: Add caching
      getUserMe().then(onUserMe);
    }

    const settingsModal = document.querySelector(
      "user-setting",
    ) as UserSettingModal;
    if (!settingsModal || !(settingsModal instanceof UserSettingModal)) {
      console.warn("User settings modal element not found");
    }
    document
      .getElementById("settings-button")
      ?.addEventListener("click", () => {
        settingsModal.open();
      });

    const hostModal = document.querySelector(
      "host-lobby-modal",
    ) as HostPrivateLobbyModal;
    if (!hostModal || !(hostModal instanceof HostPrivateLobbyModal)) {
      console.warn("Host private lobby modal element not found");
    }
    const hostLobbyButton = document.getElementById("host-lobby-button");
    if (hostLobbyButton === null) throw new Error("Missing host-lobby-button");
    hostLobbyButton.addEventListener("click", () => {
      if (this.usernameInput?.isValid()) {
        hostModal.open();
        this.publicLobby.leaveLobby();
      }
    });

    this.joinModal = document.querySelector(
      "join-private-lobby-modal",
    ) as JoinPrivateLobbyModal;
    if (!this.joinModal || !(this.joinModal instanceof JoinPrivateLobbyModal)) {
      console.warn("Join private lobby modal element not found");
    }
    const joinPrivateLobbyButton = document.getElementById(
      "join-private-lobby-button",
    );
    if (joinPrivateLobbyButton === null)
      throw new Error("Missing join-private-lobby-button");
    joinPrivateLobbyButton.addEventListener("click", () => {
      if (this.usernameInput?.isValid()) {
        this.joinModal.open();
      }
    });

    if (this.userSettings.darkMode()) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }

    // Initialize Night Mode
    this.initializeNightMode();

    // Attempt to join lobby
    this.handleHash();

    const onHashUpdate = () => {
      // Reset the UI to its initial state
      this.joinModal.close();
      if (this.gameStop !== null) {
        this.handleLeaveLobby();
      }

      // Attempt to join lobby
      this.handleHash();
    };

    // Handle browser navigation & manual hash edits
    window.addEventListener("popstate", onHashUpdate);
    window.addEventListener("hashchange", onHashUpdate);

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

    this.initializeFuseTag();
  }

  // Night Mode Implementation
  private initializeNightMode(): void {
    // Inject Night Mode styles
    const styleId = "night-mode-styles";
    if (!document.getElementById(styleId)) {
      const style = document.createElement("style");
      style.id = styleId;
      style.textContent = `
        #night-mode-overlay {
          position: fixed;
          top: 0;
          left: 0;
          width: 100vw;
          height: 100vh;
          pointer-events: none;
          z-index: 9999;
          background: radial-gradient(
            circle at var(--mouse-x, 50%) var(--mouse-y, 50%),
            transparent 0%,
            transparent 80px,
            rgba(0, 0, 0, 0.92) 150px
          );
          display: none;
        }

        body.night-mode-active #night-mode-overlay {
          display: block;
        }

        body.night-mode-active {
          cursor: none;
        }

        #night-mode-cursor {
          position: fixed;
          width: 8px;
          height: 8px;
          background: rgba(255, 255, 255, 0.6);
          border: 2px solid white;
          border-radius: 50%;
          pointer-events: none;
          z-index: 10000;
          transform: translate(-50%, -50%);
          box-shadow: 0 0 10px rgba(255, 255, 255, 0.5);
          display: none;
        }

        body.night-mode-active #night-mode-cursor {
          display: block;
        }

        .night-mode-toggle-btn {
          background: rgba(0, 0, 0, 0.2);
          border: 2px solid rgba(255, 255, 255, 0.3);
          border-radius: 8px;
          padding: 8px 12px;
          cursor: pointer;
          font-size: 20px;
          transition: all 0.3s;
          margin-left: 10px;
        }

        .night-mode-toggle-btn:hover {
          background: rgba(0, 0, 0, 0.4);
          transform: scale(1.1);
        }

        .night-mode-toggle-btn.active {
          background: rgba(255, 215, 0, 0.3);
          border-color: gold;
        }
      `;
      document.head.appendChild(style);
    }

    // Create Night Mode toggle button
    const nightModeButton = document.createElement("button");
    nightModeButton.className = "night-mode-toggle-btn";
    nightModeButton.innerHTML = "🌙";
    nightModeButton.title = "Toggle Night Mode / Flashlight Mode";
    nightModeButton.addEventListener("click", () => this.toggleNightMode());

    // Add button next to settings button or dark mode button
    const settingsButton = document.getElementById("settings-button");
    if (settingsButton && settingsButton.parentElement) {
      settingsButton.parentElement.insertBefore(
        nightModeButton,
        settingsButton.nextSibling
      );
    }

    // Create overlay
    this.nightModeOverlay = document.createElement("div");
    this.nightModeOverlay.id = "night-mode-overlay";
    document.body.appendChild(this.nightModeOverlay);

    // Create custom cursor
    this.nightModeCursor = document.createElement("div");
    this.nightModeCursor.id = "night-mode-cursor";
    document.body.appendChild(this.nightModeCursor);

    // Add mouse tracking
    document.addEventListener("mousemove", this.handleNightModeMouseMove.bind(this));

    // Load saved preference
    const saved = localStorage.getItem("nightMode");
    if (saved === "true") {
      this.enableNightMode();
      nightModeButton.classList.add("active");
      nightModeButton.innerHTML = "☀️";
    }
  }

  private toggleNightMode(): void {
    if (this.nightModeEnabled) {
      this.disableNightMode();
    } else {
      this.enableNightMode();
    }

    // Update button
    const button = document.querySelector(".night-mode-toggle-btn");
    if (button) {
      if (this.nightModeEnabled) {
        button.classList.add("active");
        button.innerHTML = "☀️";
      } else {
        button.classList.remove("active");
        button.innerHTML = "🌙";
      }
    }
  }

  private enableNightMode(): void {
    this.nightModeEnabled = true;
    document.body.classList.add("night-mode-active");
    localStorage.setItem("nightMode", "true");
    console.log("Night Mode enabled");
  }

  private disableNightMode(): void {
    this.nightModeEnabled = false;
    document.body.classList.remove("night-mode-active");
    localStorage.setItem("nightMode", "false");
    console.log("Night Mode disabled");
  }

  private handleNightModeMouseMove(e: MouseEvent): void {
    if (!this.nightModeEnabled) return;

    if (this.nightModeOverlay) {
      const x = (e.clientX / window.innerWidth) * 100;
      const y = (e.clientY / window.innerHeight) * 100;
      this.nightModeOverlay.style.setProperty("--mouse-x", `${x}%`);
      this.nightModeOverlay.style.setProperty("--mouse-y", `${y}%`);
    }

    if (this.nightModeCursor) {
      this.nightModeCursor.style.left = `${e.clientX}px`;
      this.nightModeCursor.style.top = `${e.clientY}px`;
    }
  }

  private handleHash() {
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

      const patternName = params.get("pattern");
      if (!patternName) {
        alert("Something went wrong. Please contact support.");
        console.error("purchase-completed but no pattern name");
        return;
      }

      this.userSettings.setSelectedPatternName(patternName);
      const token = params.get("login-token");

      if (token) {
        strip();
        window.addEventListener("beforeunload", () => {
          // The page reloads after token login, so we need to save the pattern name
          // in case it is unset during reload.
          this.userSettings.setSelectedPatternName(patternName);
        });
        this.tokenLoginModal.open(token);
      } else {
        alertAndStrip(`purchase succeeded: ${patternName}`);
        this.patternsModal.refresh();
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
      this.tokenLoginModal.open(token);
      return;
    }

    if (decodedHash.startsWith("#join=")) {
      const lobbyId = decodedHash.substring(6); // Remove "#join="
      if (lobbyId && ID.safeParse(lobbyId).success) {
        this.joinModal.open(lobbyId);
        console.log(`joining lobby ${lobbyId}`);
      }
    }
    if (decodedHash.startsWith("#affiliate=")) {
      const affiliateCode = decodedHash.replace("#affiliate=", "");
      strip();
      if (affiliateCode) {
        this.patternsModal.open(affiliateCode);
      }
    }
    if (decodedHash.startsWith("#refresh")) {
      window.location.href = "/";
    }
  }

  private async handleJoinLobby(event: CustomEvent<JoinLobbyEvent>) {
    const lobby = event.detail;
    console.log(`joining lobby ${lobby.gameID}`);
    if (this.gameStop !== null) {
      console.log("joining lobby, stopping existing game");
      this.gameStop();
    }
    const config = await getServerConfigFromClient();

    const pattern = this.userSettings.getSelectedPatternName(
      await fetchCosmetics(),
    );

    this.gameStop = joinLobby(
      this.eventBus,
      {
        gameID: lobby.gameID,
        serverConfig: config,
        cosmetics: {
          color: this.userSettings.getSelectedColor() ?? undefined,
          patternName: pattern?.name ?? undefined,
          patternColorPaletteName: pattern?.colorPalette?.name ?? undefined,
          flag:
            this.flagInput === null || this.flagInput.getCurrentFlag() === "xx"
              ? ""
              : this.flagInput.getCurrentFlag(),
        },
        playerName: this.usernameInput?.getCurrentUsername() ?? "",
        token: getPlayToken(),
        clientID: lobby.clientID,
        gameStartInfo: lobby.gameStartInfo ?? lobby.gameRecord?.info,
        gameRecord: lobby.gameRecord,
      },
      () => {
        console.log("Closing modals");
        document.getElementById("settings-button")?.classList.add("hidden");
        document
          .getElementById("username-validation-error")
          ?.classList.add("hidden");
        [
          "single-player-modal",
          "host-lobby-modal",
          "join-private-lobby-modal",
          "game-starting-modal",
          "game-top-bar",
          "help-modal",
          "user-setting",
          "territory-patterns-modal",
          "language-modal",
          "news-modal",
          "flag-input-modal",
          "account-button",
          "token-login",
          "matchmaking-modal",
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
        this.publicLobby.stop();
        document.querySelectorAll(".ad").forEach((ad) => {
          (ad as HTMLElement).style.display = "none";
        });

        // show when the game loads
        const startingModal = document.querySelector(
          "game-starting-modal",
        ) as GameStartingModal;
        if (startingModal && startingModal instanceof GameStartingModal) {
          startingModal.show();
        }
        this.gutterAds.hide();
      },
      () => {
        this.joinModal.close();
        this.publicLobby.stop();
        incrementGamesPlayed();

        document.querySelectorAll(".ad").forEach((ad) => {
          (ad as HTMLElement).style.display = "none";
        });

        // Ensure there's a homepage entry in history before adding the lobby entry
        if (window.location.hash === "" || window.location.hash === "#") {
          history.pushState(null, "", window.location.origin + "#refresh");
        }
        history.pushState(null, "", `#join=${lobby.gameID}`);
      },
    );
  }

  private async handleLeaveLobby(/* event: CustomEvent */) {
    if (this.gameStop === null) {
      return;
    }
    console.log("leaving lobby, cancelling game");
    this.gameStop();
    this.gameStop = null;
    this.gutterAds.hide();
    this.publicLobby.leaveLobby();
  }

  private handleKickPlayer(event: CustomEvent) {
    const { target } = event.detail;

    // Forward to eventBus if available
    if (this.eventBus) {
      this.eventBus.emit(new SendKickPlayerIntentEvent(target));
    }
  }

  private initializeFuseTag() {
    const tryInitFuseTag = (): boolean => {
      if (window.fusetag && typeof window.fusetag.pageInit === "function") {
        console.log("initializing fuse tag");
        window.fusetag.que.push(() => {
          window.fusetag.pageInit({
            blockingFuseIds: ["lhs_sticky_vrec", "rhs_sticky_vrec"],
          });
        });
        return true;
      } else {
        return false;
      }
    };

    const interval = setInterval(() => {
      if (tryInitFuseTag()) {
        clearInterval(interval);
      }
    }, 100);
  }
}

// Initialize the client when the DOM is loaded
document.addEventListener("DOMContentLoaded", () => {
  new Client().initialize();
});

// WARNING: DO NOT EXPOSE THIS ID
export function getPlayToken(): string {
  const result = isLoggedIn();
  if (result !== false) return result.token;
  return getPersistentIDFromCookie();
}

// WARNING: DO NOT EXPOSE THIS ID
export function getPersistentID(): string {
  const result = isLoggedIn();
  if (result !== false) return result.claims.sub;
  return getPersistentIDFromCookie();
}

// WARNING: DO NOT EXPOSE THIS ID
function getPersistentIDFromCookie(): string {
  const COOKIE_NAME = "player_persistent_id";

  // Try to get existing cookie
  const cookies = document.cookie.split(";");
  for (const cookie of cookies) {
    const [cookieName, cookieValue] = cookie.split("=").map((c) => c.trim());
    if (cookieName === COOKIE_NAME) {
      return cookieValue;
    }
  }

  // If no cookie exists, create new ID and set cookie
  const newID = generateCryptoRandomUUID();
  document.cookie = [
    `${COOKIE_NAME}=${newID}`,
    `max-age=${5 * 365 * 24 * 60 * 60}`, // 5 years
    "path=/",
    "SameSite=Strict",
    "Secure",
  ].join(";");

  return newID;
}
