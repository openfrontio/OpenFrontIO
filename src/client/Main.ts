import page from "page";
import favicon from "../../resources/images/Favicon.svg";
import { consolex } from "../core/Consolex";
import { GameRecord, GameStartInfo } from "../core/Schemas";
import { getServerConfigFromClient } from "../core/configuration/ConfigLoader";
import { GameType } from "../core/game/Game";
import { UserSettings } from "../core/game/UserSettings";
import { joinLobby } from "./ClientGameRunner";
import "./DarkModeButton";
import { DarkModeButton } from "./DarkModeButton";
import "./FlagInput";
import { FlagInput } from "./FlagInput";
import { GameStartingModal } from "./GameStartingModal";
import "./GoogleAdElement";
import GoogleAdElement from "./GoogleAdElement";
import { HelpModal } from "./HelpModal";
import { HostLobbyModal as HostPrivateLobbyModal } from "./HostLobbyModal";
import { JoinPrivateLobbyModal } from "./JoinPrivateLobbyModal";
import "./LangSelector";
import "./PublicLobby";
import { PublicLobby } from "./PublicLobby";
import { SinglePlayerModal } from "./SinglePlayerModal";
import { UserSettingModal } from "./UserSettingModal";
import "./UsernameInput";
import { UsernameInput } from "./UsernameInput";
import { generateCryptoRandomUUID } from "./Utils";
import "./components/NewsButton";
import { NewsButton } from "./components/NewsButton";
import "./components/baseComponents/Button";
import { OButton } from "./components/baseComponents/Button";
import "./components/baseComponents/Modal";
import { discordLogin, getUserMe, isLoggedIn, logOut } from "./jwt";
import "./styles.css";

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
  private googleAds: NodeListOf<GoogleAdElement>;
  private userSettings: UserSettings = new UserSettings();

  constructor() {}

  initialize(): void {
    const newsModal = document.querySelector("news-modal");
    if (!newsModal) {
      consolex.warn("News modal element not found");
    } else {
      consolex.log("News modal element found");
    }

    const newsButton = document.querySelector("news-button");
    if (!newsButton) {
      consolex.warn("News button element not found");
    } else {
      consolex.log("News button element found");
    }

    // Comment out to show news button.
    if (newsButton instanceof NewsButton) {
      newsButton.hidden = true;
    }

    const langSelector = document.querySelector("lang-selector");
    const languageModal = document.querySelector("language-modal");
    if (!langSelector) {
      consolex.warn("Lang selector element not found");
    }
    if (!languageModal) {
      consolex.warn("Language modal element not found");
    }

    const _flagInput = document.querySelector("flag-input");
    if (_flagInput instanceof FlagInput) {
      this.flagInput = _flagInput;
    } else {
      consolex.warn("Flag input element not found");
    }

    const _darkModeButton = document.querySelector("dark-mode-button");
    if (_darkModeButton instanceof DarkModeButton) {
      this.darkModeButton = _darkModeButton;
    } else {
      consolex.warn("Dark mode button element not found");
    }

    const _usernameInput = document.querySelector("username-input");
    if (_usernameInput instanceof UsernameInput) {
      this.usernameInput = _usernameInput;
    } else {
      consolex.warn("Username input element not found");
    }

    const _publicLobby = document.querySelector("public-lobby");
    if (_publicLobby instanceof PublicLobby) {
      this.publicLobby = _publicLobby;
    }

    this.googleAds = document.querySelectorAll(
      "google-ad",
    ) as NodeListOf<GoogleAdElement>;

    window.addEventListener("beforeunload", () => {
      consolex.log("Browser is closing");
      if (this.gameStop !== null) {
        this.gameStop();
      }
    });

    setFavicon();
    document.addEventListener("join-lobby", this.handleJoinLobby.bind(this));
    document.addEventListener("leave-lobby", this.handleLeaveLobby.bind(this));

    const spModal = document.querySelector("single-player-modal");

    if (!(spModal instanceof SinglePlayerModal)) {
      throw new Error("Missing single-player-modal");
    }

    const singlePlayer = document.getElementById("single-player");
    if (singlePlayer === null) {
      throw new Error("Missing single-player");
    }

    singlePlayer.addEventListener("click", () => {
      if (this.usernameInput?.isValid()) {
        spModal.open();
      }
    });

    // const ctModal = document.querySelector("chat-modal") as ChatModal;
    // ctModal instanceof ChatModal;
    // document.getElementById("chat-button").addEventListener("click", () => {
    //   ctModal.open();
    // });

    const helpModal = document.querySelector("help-modal");
    if (!(helpModal instanceof HelpModal)) {
      throw new Error("Missing help-modal");
    }

    const helpButton = document.getElementById("help-button");
    if (helpButton === null) {
      throw new Error("Missing help-button");
    }

    helpButton.addEventListener("click", () => {
      helpModal.open();
    });

    const loginDiscordButton = document.getElementById("login-discord");
    const logoutDiscordButton = document.getElementById("logout-discord");

    if (
      loginDiscordButton instanceof OButton &&
      logoutDiscordButton instanceof OButton
    ) {
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
          loginDiscordButton.addEventListener("click", discordLogin);
          logoutDiscordButton.hidden = true;
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
          // TODO: Update the page for logged in user
          loginDiscordButton.translationKey = "main.logged_in";
          const { user, player } = userMeResponse;
        });
      }
    }

    const settingsModal = document.querySelector("user-setting");
    if (settingsModal instanceof UserSettingModal) {
      document
        .getElementById("settings-button")
        ?.addEventListener("click", () => {
          settingsModal.open();
        });
    }

    const hostModal = document.querySelector("host-lobby-modal");
    if (hostModal instanceof HostPrivateLobbyModal) {
      const hostLobbyButton = document.getElementById("host-lobby-button");
      if (hostLobbyButton === null)
        throw new Error("Missing host-lobby-button");

      hostLobbyButton.addEventListener("click", () => {
        if (this.usernameInput?.isValid()) {
          hostModal.open();
          this.publicLobby.leaveLobby();
        }
      });
    }

    const _joinModal = document.querySelector("join-private-lobby-modal");
    if (_joinModal instanceof JoinPrivateLobbyModal) {
      this.joinModal = _joinModal;

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
    }

    if (this.userSettings.darkMode()) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }

    page("/join/:lobbyId", (ctx) => {
      if (ctx.init && sessionStorage.getItem("inLobby")) {
        // On page reload, go back home
        page.redirect("/");
        return;
      }
      const lobbyId = ctx.params.lobbyId;

      if (lobbyId?.endsWith("#")) {
        // When the cookies button is pressed, '#' is added to the url
        // causing the page to attempt to rejoin the lobby during game play.
        console.error("Invalid lobby ID provided");
        return;
      }

      this.joinModal.open(lobbyId);

      consolex.log(`joining lobby ${lobbyId}`);
    });

    page();
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

  private async handleJoinLobby(event: CustomEvent) {
    const lobby = event.detail as JoinLobbyEvent;
    consolex.log(`joining lobby ${lobby.gameID}`);
    if (this.gameStop !== null) {
      consolex.log("joining lobby, stopping existing game");
      this.gameStop();
    }
    const config = await getServerConfigFromClient();

    this.gameStop = joinLobby(
      {
        gameID: lobby.gameID,
        serverConfig: config,
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
      () => {
        console.log("Closing modals");
        document.getElementById("settings-button")?.classList.add("hidden");
        [
          "single-player-modal",
          "host-lobby-modal",
          "join-private-lobby-modal",
          "game-starting-modal",
          "top-bar",
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
          if (ad instanceof HTMLElement) {
            ad.style.display = "none";
          }
        });

        // show when the game loads
        const startingModal = document.querySelector("game-starting-modal");
        if (startingModal instanceof GameStartingModal) {
          startingModal.show();
        }
      },
      () => {
        this.joinModal.close();
        this.publicLobby.stop();
        document.querySelectorAll(".ad").forEach((ad) => {
          if (ad instanceof HTMLElement) {
            ad.style.display = "none";
          }
        });

        if (event.detail.gameConfig?.gameType !== GameType.Singleplayer) {
          window.history.pushState({}, "", `/join/${lobby.gameID}`);
          sessionStorage.setItem("inLobby", "true");
        }
      },
    );
  }

  private async handleLeaveLobby(/* event: CustomEvent */) {
    if (this.gameStop === null) {
      return;
    }
    consolex.log("leaving lobby, cancelling game");
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
