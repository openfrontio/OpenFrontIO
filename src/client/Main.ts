import favicon from "../../resources/images/Favicon.svg";
import version from "../../resources/version.txt";
import { EventBus } from "../core/EventBus";
import { GameRecord, GameStartInfo, ID } from "../core/Schemas";
import LocalStorage from "../core/Storage";
import { getServerConfigFromClient } from "../core/configuration/ConfigLoader";
import { GameType } from "../core/game/Game";
import { UserSettings } from "../core/game/UserSettings";
import BrowserStorage from "./BrowserStorage";
import { joinLobby } from "./ClientGameRunner";
import "./DarkModeButton";
import { DarkModeButton } from "./DarkModeButton";
import "./FlagInput";
import { FlagInput } from "./FlagInput";
import { GameStartingModal } from "./GameStartingModal";
import "./GoogleAdElement";
import { HelpModal } from "./HelpModal";
import { HostLobbyModal as HostPrivateLobbyModal } from "./HostLobbyModal";
import { JoinPrivateLobbyModal } from "./JoinPrivateLobbyModal";
import "./LangSelector";
import { LangSelector } from "./LangSelector";
import { LanguageModal } from "./LanguageModal";
import { NewsModal } from "./NewsModal";
import "./PublicLobby";
import { PublicLobby } from "./PublicLobby";
import { SinglePlayerModal } from "./SinglePlayerModal";
import { TerritoryPatternsModal } from "./TerritoryPatternsModal";
import { UserSettingModal } from "./UserSettingModal";
import "./UsernameInput";
import { UsernameInput } from "./UsernameInput";
import { generateCryptoRandomUUID, incrementGamesPlayed } from "./Utils";
import "./components/NewsButton";
import { NewsButton } from "./components/NewsButton";
import "./components/baseComponents/Button";
import { OButton } from "./components/baseComponents/Button";
import "./components/baseComponents/Modal";
import { registerDarkModeHandler } from "./handlers/DarkModeHandler";
import { discordLogin, getUserMe, isLoggedIn, logOut } from "./jwt";
import "./styles.css";

declare global {
  interface Window {
    PageOS: {
      session: {
        newPageView: () => void;
      };
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

  private usernameInput: UsernameInput | null = null;
  private flagInput: FlagInput | null = null;
  private darkModeButton: DarkModeButton | null = null;

  private joinModal: JoinPrivateLobbyModal;
  private publicLobby: PublicLobby;
  private eventBus: EventBus = new EventBus();
  private storage: LocalStorage = new BrowserStorage();
  private userSettings: UserSettings = new UserSettings(
    this.eventBus,
    this.storage,
  );

  constructor() {}

  initialize(): void {
    //handlers
    registerDarkModeHandler(this.eventBus);

    const gameVersion = document.getElementById(
      "game-version",
    ) as HTMLDivElement;
    if (!gameVersion) {
      console.warn("Game version element not found");
    }
    gameVersion.innerText = version;

    const newsModal = document.querySelector("news-modal") as NewsModal;
    if (!newsModal) {
      console.warn("News modal element not found");
    }
    newsModal instanceof NewsModal;
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
    } else {
      this.darkModeButton.userSettings = this.userSettings;
    }

    const loginDiscordButton = document.getElementById(
      "login-discord",
    ) as OButton;
    const logoutDiscordButton = document.getElementById(
      "logout-discord",
    ) as OButton;

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

    setFavicon();
    document.addEventListener("join-lobby", this.handleJoinLobby.bind(this));
    document.addEventListener("leave-lobby", this.handleLeaveLobby.bind(this));

    const spModal = document.querySelector(
      "single-player-modal",
    ) as SinglePlayerModal;
    spModal instanceof SinglePlayerModal;
    const singlePlayer = document.getElementById("single-player");
    if (singlePlayer === null) throw new Error("Missing single-player");
    singlePlayer.addEventListener("click", () => {
      if (this.usernameInput?.isValid()) {
        spModal.open();
      }
    });

    if (spModal) {
      spModal.userSettings = this.userSettings;
    }

    // const ctModal = document.querySelector("chat-modal") as ChatModal;
    // ctModal instanceof ChatModal;
    // document.getElementById("chat-button").addEventListener("click", () => {
    //   ctModal.open();
    // });

    const hlpModal = document.querySelector("help-modal") as HelpModal;
    hlpModal instanceof HelpModal;
    const helpButton = document.getElementById("help-button");
    if (helpButton === null) throw new Error("Missing help-button");
    helpButton.addEventListener("click", () => {
      hlpModal.open();
    });

    const territoryModal = document.querySelector(
      "territory-patterns-modal",
    ) as TerritoryPatternsModal;
    const tpButton = document.getElementById(
      "territory-patterns-input-preview-button",
    );
    territoryModal instanceof TerritoryPatternsModal;
    territoryModal.userSettings = this.userSettings;

    if (tpButton === null)
      throw new Error("territory-patterns-input-preview-button");
    territoryModal.previewButton = tpButton;
    territoryModal.updatePreview();
    territoryModal.resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.target.classList.contains("preview-container")) {
          territoryModal.buttonWidth = entry.contentRect.width;
        }
      }
    });
    tpButton.addEventListener("click", () => {
      territoryModal.open();
    });

    if (isLoggedIn() === false) {
      // Not logged in
      loginDiscordButton.disable = false;
      loginDiscordButton.translationKey = "main.login_discord";
      loginDiscordButton.addEventListener("click", discordLogin);
      logoutDiscordButton.hidden = true;
    } else {
      // JWT appears to be valid
      loginDiscordButton.disable = true;
      loginDiscordButton.translationKey = "main.checking_login";
      logoutDiscordButton.hidden = false;
      logoutDiscordButton.addEventListener("click", () => {
        // Log out
        logOut();
        loginDiscordButton.disable = false;
        loginDiscordButton.translationKey = "main.login_discord";
        loginDiscordButton.hidden = false;
        loginDiscordButton.addEventListener("click", discordLogin);
        logoutDiscordButton.hidden = true;
        territoryModal.onLogout();
      });
      // Look up the discord user object.
      // TODO: Add caching
      getUserMe().then((userMeResponse) => {
        if (userMeResponse === false) {
          // Not logged in
          loginDiscordButton.disable = false;
          loginDiscordButton.translationKey = "main.login_discord";
          loginDiscordButton.addEventListener("click", discordLogin);
          logoutDiscordButton.hidden = true;
          return;
        }
        console.log(
          `Your player ID is ${userMeResponse.player.publicId}\n` +
            "Sharing this ID will allow others to view your game history and stats.",
        );
        loginDiscordButton.translationKey = "main.logged_in";
        loginDiscordButton.hidden = true;
        territoryModal.onUserMe(userMeResponse);
      });
    }

    const settingsModal = document.querySelector(
      "user-setting",
    ) as UserSettingModal;
    settingsModal instanceof UserSettingModal;
    document
      .getElementById("settings-button")
      ?.addEventListener("click", () => {
        settingsModal.open();
      });
    if (settingsModal) {
      settingsModal.userSettings = this.userSettings;
    }

    const hostModal = document.querySelector(
      "host-lobby-modal",
    ) as HostPrivateLobbyModal;
    hostModal instanceof HostPrivateLobbyModal;
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
    this.joinModal instanceof JoinPrivateLobbyModal;
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

    function updateSliderProgress(slider) {
      const percent =
        ((slider.value - slider.min) / (slider.max - slider.min)) * 100;
      slider.style.setProperty("--progress", `${percent}%`);
    }

    document
      .querySelectorAll("#bots-count, #private-lobby-bots-count")
      .forEach((slider) => {
        updateSliderProgress(slider);
        slider.addEventListener("input", () => updateSliderProgress(slider));
      });
  }

  private handleHash() {
    const { hash } = window.location;
    if (hash.startsWith("#")) {
      const params = new URLSearchParams(hash.slice(1));
      const lobbyId = params.get("join");
      if (lobbyId && ID.safeParse(lobbyId).success) {
        this.joinModal.open(lobbyId);
        console.log(`joining lobby ${lobbyId}`);
      }
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

    this.gameStop = joinLobby(
      {
        gameID: lobby.gameID,
        serverConfig: config,
        pattern: this.userSettings.getSelectedPattern(),
        flag:
          this.flagInput === null || this.flagInput.getCurrentFlag() === "xx"
            ? ""
            : this.flagInput.getCurrentFlag(),
        playerName: this.usernameInput?.getCurrentUsername() ?? "",
        token: getPlayToken(),
        clientID: lobby.clientID,
        gameStartInfo: lobby.gameStartInfo ?? lobby.gameRecord?.info,
        gameRecord: lobby.gameRecord,
      },
      this.eventBus,
      this.userSettings,
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
        ].forEach((tag) => {
          const modal = document.querySelector(tag) as HTMLElement & {
            close?: () => void;
            isModalOpen?: boolean;
          };
          if (modal?.close) {
            modal.close();
          } else if ("isModalOpen" in modal) {
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
        startingModal instanceof GameStartingModal;
        startingModal.show();
      },
      () => {
        this.joinModal.close();
        this.publicLobby.stop();
        incrementGamesPlayed();

        try {
          window.PageOS.session.newPageView();
        } catch (e) {
          console.error("Error calling newPageView", e);
        }

        document.querySelectorAll(".ad").forEach((ad) => {
          (ad as HTMLElement).style.display = "none";
        });

        if (lobby.gameStartInfo?.config.gameType !== GameType.Singleplayer) {
          history.pushState(null, "", `#join=${lobby.gameID}`);
        }
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
    this.publicLobby.leaveLobby();
  }
}

// Initialize the client when the DOM is loaded
document.addEventListener("DOMContentLoaded", () => {
  new Client().initialize();
});

function setFavicon(): void {
  const link = document.createElement("link");
  link.type = "image/x-icon";
  link.rel = "shortcut icon";
  link.href = favicon;
  document.head.appendChild(link);
}

// WARNING: DO NOT EXPOSE THIS ID
function getPlayToken(): string {
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
