import page from "page";
import favicon from "../../resources/images/Favicon.svg";
import { consolex } from "../core/Consolex";
import { GameRecord, GameStartInfo } from "../core/Schemas";
import { getServerConfigFromClient } from "../core/configuration/ConfigLoader";
import { GameType } from "../core/game/Game";
import { UserSettings } from "../core/game/UserSettings";
import { UserMeResponse, UserMeResponseSchema } from "./ApiSchemas";
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
import { LangSelector } from "./LangSelector";
import { LanguageModal } from "./LanguageModal";
import "./PublicLobby";
import { PublicLobby } from "./PublicLobby";
import "./RandomNameButton";
import { RandomNameButton } from "./RandomNameButton";
import { SinglePlayerModal } from "./SinglePlayerModal";
import { UserSettingModal } from "./UserSettingModal";
import "./UsernameInput";
import { UsernameInput } from "./UsernameInput";
import { generateCryptoRandomUUID } from "./Utils";
import "./components/baseComponents/Button";
import "./components/baseComponents/Modal";
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
  private gameStop: () => void;

  private usernameInput: UsernameInput | null = null;
  private flagInput: FlagInput | null = null;
  private darkModeButton: DarkModeButton | null = null;
  private randomNameButton: RandomNameButton | null = null;

  private joinModal: JoinPrivateLobbyModal;
  private publicLobby: PublicLobby;
  private googleAds: NodeListOf<GoogleAdElement>;
  private userSettings: UserSettings = new UserSettings();

  constructor() {}

  initialize(): void {
    const { hash } = window.location;
    if (hash.startsWith("#")) {
      const params = new URLSearchParams(hash.slice(1));
      const token = params.get("token");
      if (token) {
        localStorage.setItem("token", token);
      }
      // Clean the URL
      history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search,
      );
    }

    const langSelector = document.querySelector(
      "lang-selector",
    ) as LangSelector;
    const LanguageModal = document.querySelector(
      "lang-selector",
    ) as LanguageModal;
    if (!langSelector) {
      consolex.warn("Lang selector element not found");
    }
    if (!LanguageModal) {
      consolex.warn("Language modal element not found");
    }

    this.flagInput = document.querySelector("flag-input") as FlagInput;
    if (!this.flagInput) {
      consolex.warn("Flag input element not found");
    }

    this.darkModeButton = document.querySelector(
      "dark-mode-button",
    ) as DarkModeButton;
    if (!this.darkModeButton) {
      consolex.warn("Dark mode button element not found");
    }

    this.randomNameButton = document.querySelector(
      "random-name-button",
    ) as RandomNameButton;
    if (!this.randomNameButton) {
      consolex.warn("Random name button element not found");
    }

    const loginDiscordButton = document.getElementById("login-discord");
    isLoggedIn().then((loggedIn) => {
      if (loggedIn !== false) {
        console.log("Logged in", JSON.stringify(loggedIn, null, 2));
        const { user } = loggedIn;
        const { id, avatar, username, global_name, discriminator } = user;
        const avatarUrl = avatar
          ? `https://cdn.discordapp.com/avatars/${id}/${avatar}.${avatar.startsWith("a_") ? "gif" : "png"}`
          : `https://cdn.discordapp.com/embed/avatars/${Number(discriminator) % 5}.png`;
        // TODO: Update the page for logged in user
      } else {
        localStorage.removeItem("token");
        loginDiscordButton.addEventListener("click", discordLogin);
      }
    });

    this.usernameInput = document.querySelector(
      "username-input",
    ) as UsernameInput;
    if (!this.usernameInput) {
      consolex.warn("Username input element not found");
    }

    this.publicLobby = document.querySelector("public-lobby") as PublicLobby;
    this.googleAds = document.querySelectorAll(
      "google-ad",
    ) as NodeListOf<GoogleAdElement>;

    window.addEventListener("beforeunload", () => {
      consolex.log("Browser is closing");
      if (this.gameStop != null) {
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
    document.getElementById("single-player").addEventListener("click", () => {
      if (this.usernameInput.isValid()) {
        spModal.open();
      }
    });

    const hlpModal = document.querySelector("help-modal") as HelpModal;
    hlpModal instanceof HelpModal;
    document.getElementById("help-button").addEventListener("click", () => {
      hlpModal.open();
    });

    const settingsModal = document.querySelector(
      "user-setting",
    ) as UserSettingModal;
    settingsModal instanceof UserSettingModal;
    document.getElementById("settings-button").addEventListener("click", () => {
      settingsModal.open();
    });

    const hostModal = document.querySelector(
      "host-lobby-modal",
    ) as HostPrivateLobbyModal;
    hostModal instanceof HostPrivateLobbyModal;
    document
      .getElementById("host-lobby-button")
      .addEventListener("click", () => {
        if (this.usernameInput.isValid()) {
          hostModal.open();
          this.publicLobby.leaveLobby();
        }
      });

    this.joinModal = document.querySelector(
      "join-private-lobby-modal",
    ) as JoinPrivateLobbyModal;
    this.joinModal instanceof JoinPrivateLobbyModal;
    document
      .getElementById("join-private-lobby-button")
      .addEventListener("click", () => {
        if (this.usernameInput.isValid()) {
          this.joinModal.open();
        }
      });

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
    if (this.gameStop != null) {
      consolex.log("joining lobby, stopping existing game");
      this.gameStop();
    }
    const config = await getServerConfigFromClient();

    this.gameStop = joinLobby(
      {
        gameID: lobby.gameID,
        serverConfig: config,
        flag:
          this.flagInput.getCurrentFlag() == "xx"
            ? ""
            : this.flagInput.getCurrentFlag(),
        playerName: this.usernameInput.getCurrentUsername(),
        persistentID: getPersistentIDFromCookie(),
        clientID: lobby.clientID,
        gameStartInfo: lobby.gameStartInfo ?? lobby.gameRecord?.gameStartInfo,
        gameRecord: lobby.gameRecord,
      },
      () => {
        console.log("Closing modals");
        document.getElementById("settings-button").classList.add("hidden");
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
        document.querySelectorAll(".ad").forEach((ad) => {
          (ad as HTMLElement).style.display = "none";
        });

        if (event.detail.gameConfig?.gameType != GameType.Singleplayer) {
          window.history.pushState({}, "", `/join/${lobby.gameID}`);
          sessionStorage.setItem("inLobby", "true");
        }
      },
    );
  }

  private async handleLeaveLobby(/* event: CustomEvent */) {
    if (this.gameStop == null) {
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

async function isLoggedIn(): Promise<UserMeResponse | false> {
  try {
    const token = localStorage.getItem("token");
    if (!token) return false;
    const response = await fetch(getApiBase() + "/users/@me", {
      headers: {
        authorization: `Bearer ${token}`,
      },
    });
    if (response.status !== 200) return false;
    const body = await response.json();
    const result = UserMeResponseSchema.safeParse(body);
    if (!result.success) {
      console.error(
        "Invalid response",
        JSON.stringify(body),
        JSON.stringify(result.error),
      );
      return false;
    }
    return result.data;
  } catch (e) {
    return false;
  }
}

function setFavicon(): void {
  const link = document.createElement("link");
  link.type = "image/x-icon";
  link.rel = "shortcut icon";
  link.href = favicon;
  document.head.appendChild(link);
}

// WARNING: DO NOT EXPOSE THIS ID
export function getPersistentIDFromCookie(): string {
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

function getApiBase() {
  const { hostname } = new URL(window.location.href);
  const domainname = hostname.split(".").slice(-2).join(".");
  return domainname === "localhost"
    ? "http://localhost:8787"
    : `https://api.${domainname}`;
}

function discordLogin() {
  window.location.href = `${getApiBase()}/login/discord?redirect_uri=${window.location.href}`;
}
