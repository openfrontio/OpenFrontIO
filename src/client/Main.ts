import { ClientGameRunner, joinLobby } from "./ClientGameRunner";
import favicon from "../../resources/images/Favicon.svg";
import "./PublicLobby";
import "./UsernameInput";
import "./styles.css";
import { UsernameInput } from "./UsernameInput";
import { SinglePlayerModal } from "./SinglePlayerModal";
import { HostLobbyModal as HostPrivateLobbyModal } from "./HostLobbyModal";
import { JoinPrivateLobbyModal } from "./JoinPrivateLobbyModal";
import { GameStartingModal } from "./gameStartingModal";
import { generateID } from "../core/Util";
import { generateCryptoRandomUUID } from "./Utils";
import { consolex } from "../core/Consolex";
import "./FlagInput";
import { FlagInput } from "./FlagInput";
import page from "page";
import { PublicLobby } from "./PublicLobby";
import { UserSettings } from "../core/game/UserSettings";
import "./DarkModeButton";
import { DarkModeButton } from "./DarkModeButton";
import "./GoogleAdElement";
import { HelpModal } from "./HelpModal";
import { GameType } from "../core/game/Game";
import { getServerConfigFromClient } from "../core/configuration/Config";
import GoogleAdElement from "./GoogleAdElement";

class Client {
  private gameStop: () => void;

  private usernameInput: UsernameInput | null = null;
  private flagInput: FlagInput | null = null;
  private darkModeButton: DarkModeButton | null = null;

  private joinModal: JoinPrivateLobbyModal;
  private publicLobby: PublicLobby;
  private googleAds: NodeListOf<GoogleAdElement>;
  private userSettings: UserSettings = new UserSettings();

  constructor() {}

  initialize(): void {
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

    window.addEventListener("beforeunload", (event) => {
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
  }

  private async handleJoinLobby(event: CustomEvent) {
    const lobby = event.detail.lobby;
    consolex.log(`joining lobby ${lobby.id}`);
    if (this.gameStop != null) {
      consolex.log("joining lobby, stopping existing game");
      this.gameStop();
    }
    const config = await getServerConfigFromClient();
    const gameType = event.detail.gameType;
    this.gameStop = joinLobby(
      {
        serverConfig: config,
        gameType: gameType,
        flag: (): string =>
          this.flagInput.getCurrentFlag() == "xx"
            ? ""
            : this.flagInput.getCurrentFlag(),
        playerName: (): string => this.usernameInput.getCurrentUsername(),
        gameID: lobby.gameID,
        persistentID: getPersistentIDFromCookie(),
        playerID: generateID(),
        clientID: generateID(),
        map: event.detail.map,
        difficulty: event.detail.difficulty,
        infiniteGold: event.detail.infiniteGold,
        infiniteTroops: event.detail.infiniteTroops,
        instantBuild: event.detail.instantBuild,
        bots: event.detail.bots,
        disableNPCs: event.detail.disableNPCs,
      },
      () => {
        this.joinModal.close();
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

        if (gameType != GameType.Singleplayer) {
          window.history.pushState({}, "", `/join/${lobby.gameID}`);
          sessionStorage.setItem("inLobby", "true");
        }
      },
    );
  }

  private async handleLeaveLobby(event: CustomEvent) {
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
