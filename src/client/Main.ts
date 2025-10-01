import version from "../../resources/version.txt";
import { UserMeResponse } from "../core/ApiSchemas";
import { EventBus } from "../core/EventBus";
import { GameID, GameRecord, GameStartInfo, ID } from "../core/Schemas";
import { generateID } from "../core/Util";
import { ServerConfig } from "../core/configuration/Config";
import { getServerConfigFromClient } from "../core/configuration/ConfigLoader";
import { UserSettings } from "../core/game/UserSettings";
import { RankedMode, RankedRegion } from "../server/ranked/types";
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
import { HelpModal } from "./HelpModal";
import { HostLobbyModal as HostPrivateLobbyModal } from "./HostLobbyModal";
import { JoinPrivateLobbyModal } from "./JoinPrivateLobbyModal";
import "./LangSelector";
import { LangSelector } from "./LangSelector";
import { LanguageModal } from "./LanguageModal";
import { NewsModal } from "./NewsModal";
import "./PublicLobby";
import { PublicLobby } from "./PublicLobby";
import "./RankedMatchModal";
import type {
  RankedMatchAcceptDetail,
  RankedMatchDeclineDetail,
  RankedMatchModal,
} from "./RankedMatchModal";
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
  translateText,
} from "./Utils";
import "./components/NewsButton";
import { NewsButton } from "./components/NewsButton";
import "./components/baseComponents/Button";
import "./components/baseComponents/Modal";
import { discordLogin, getUserMe, isLoggedIn } from "./jwt";
import {
  acceptRankedMatch,
  declineRankedMatch,
  fetchRankedHistory,
  fetchRankedLeaderboard,
  getRankedTicket,
  joinRankedQueue,
  leaveRankedQueue,
  RankedLeaderboardEntry,
  RankedMatchHistoryEntry,
  RankedQueueTicket,
} from "./ranked/RankedQueueClient";
import { RankedWebSocket } from "./ranked/RankedWebSocket";
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

  private rankedQueueButton: HTMLButtonElement | null = null;
  private rankedQueueStatusEl: HTMLElement | null = null;
  private rankedStatsContainer: HTMLElement | null = null;
  private rankedLeaderboardList: HTMLUListElement | null = null;
  private rankedHistoryList: HTMLUListElement | null = null;
  private rankedMatchModal: RankedMatchModal | null = null;
  private rankedTicketPollHandle: number | null = null;
  private rankedStatsPollHandle: number | null = null;
  private rankedTicket: RankedQueueTicket | null = null;
  private rankedPlayerId: string | null = null;
  private rankedLaunchedGameId: string | null = null;
  private rankedBusy = false;
  private rankedModalOpen = false;
  private rankedWebSocket: RankedWebSocket | null = null;
  private readonly rankedTicketStorageKey = "ranked.queue.ticket";

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

    document.addEventListener("join-lobby", this.handleJoinLobby.bind(this));
    document.addEventListener("leave-lobby", this.handleLeaveLobby.bind(this));
    document.addEventListener("kick-player", this.handleKickPlayer.bind(this));

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

    const flagInputModal = document.querySelector(
      "flag-input-modal",
    ) as FlagInputModal;
    flagInputModal instanceof FlagInputModal;
    const flgInput = document.getElementById("flag-input_");
    if (flgInput === null) throw new Error("Missing flag-input_");
    flgInput.addEventListener("click", () => {
      flagInputModal.open();
    });

    this.patternsModal = document.querySelector(
      "territory-patterns-modal",
    ) as TerritoryPatternsModal;
    const patternButton = document.getElementById(
      "territory-patterns-input-preview-button",
    );
    this.patternsModal instanceof TerritoryPatternsModal;
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
    this.tokenLoginModal instanceof TokenLoginModal;

    this.setupRankedUI();

    const onUserMe = async (userMeResponse: UserMeResponse | false) => {
      document.dispatchEvent(
        new CustomEvent("userMeResponse", {
          detail: userMeResponse,
          bubbles: true,
          cancelable: true,
        }),
      );

      await this.syncRankedState(userMeResponse);

      const config = await getServerConfigFromClient();
      if (!hasAllowedFlare(userMeResponse, config)) {
        if (userMeResponse === false) {
          // Login is required
          document.body.innerHTML = `
            <div style="
              display: flex;
              justify-content: center;
              align-items: center;
              height: 100vh;
              margin: 0;
              font-family: sans-serif;
              background-size: cover;
              background-position: center;
            ">
              <div style="
                background-color: rgba(0, 0, 0, 0.7);
                color: white;
                padding: 2em;
                margin: 5em;
                border-radius: 12px;
                text-align: center;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
              ">
                <p style="margin-bottom: 1em;">${translateText("auth.login_required")}</p>
                <p style="margin-bottom: 1.5em;">${translateText("auth.redirecting")}</p>
                <div style="width: 100%; height: 8px; background-color: #444; border-radius: 4px; overflow: hidden;">
                  <div style="
                    height: 100%;
                    width: 0%;
                    background-color: #4caf50;
                    animation: fillBar 5s linear forwards;
                  "></div>
                </div>
              </div>
            </div>
            <div class="bg-image"></div>
            <style>
              @keyframes fillBar {
                from { width: 0%; }
                to { width: 100%; }
              }
            </style>
          `;
          setTimeout(discordLogin, 5000);
        } else {
          // Unauthorized
          document.body.innerHTML = `
            <div style="
              display: flex;
              justify-content: center;
              align-items: center;
              height: 100vh;
              margin: 0;
              font-family: sans-serif;
              background-size: cover;
              background-position: center;
            ">
              <div style="
                background-color: rgba(0, 0, 0, 0.7);
                color: white;
                padding: 2em;
                margin: 5em;
                border-radius: 12px;
                text-align: center;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
              ">
                <p style="margin-bottom: 1em;">${translateText("auth.not_authorized")}</p>
                <p>${translateText("auth.contact_admin")}</p>
              </div>
            </div>
            <div class="bg-image"></div>
          `;
        }
        return;
      } else if (userMeResponse === false) {
        // Not logged in
        this.patternsModal.onUserMe(null);
      } else {
        // Authorized
        console.log(
          `Your player ID is ${userMeResponse.player.publicId}\n` +
            "Sharing this ID will allow others to view your game history and stats.",
        );
        this.patternsModal.onUserMe(userMeResponse);
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
    settingsModal instanceof UserSettingModal;
    document
      .getElementById("settings-button")
      ?.addEventListener("click", () => {
        settingsModal.open();
      });

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

  private setupRankedUI(): void {
    this.rankedQueueButton = document.getElementById(
      "ranked-queue-button",
    ) as HTMLButtonElement | null;
    this.rankedQueueStatusEl = document.getElementById("ranked-queue-status");
    this.rankedStatsContainer = document.getElementById("ranked-stats");
    this.rankedLeaderboardList = document.getElementById(
      "ranked-leaderboard-list",
    ) as HTMLUListElement | null;
    this.rankedHistoryList = document.getElementById(
      "ranked-history-list",
    ) as HTMLUListElement | null;
    this.rankedMatchModal = document.querySelector(
      "ranked-match-modal",
    ) as RankedMatchModal | null;

    if (this.rankedQueueButton) {
      this.rankedQueueButton.addEventListener("click", () => {
        this.handleRankedQueueClick();
      });
    }

    if (this.rankedMatchModal) {
      this.rankedMatchModal.addEventListener("ranked-match-accept", (event) => {
        void this.handleRankedMatchAccept(
          event as CustomEvent<RankedMatchAcceptDetail>,
        );
      });
      this.rankedMatchModal.addEventListener(
        "ranked-match-decline",
        (event) => {
          void this.handleRankedMatchDecline(
            event as CustomEvent<RankedMatchDeclineDetail>,
          );
        },
      );
    }

    this.updateRankedUI(this.rankedTicket);
  }

  private async syncRankedState(userMeResponse: UserMeResponse | false) {
    if (!this.rankedQueueButton && !this.rankedStatsContainer) {
      return;
    }

    if (userMeResponse === false) {
      this.rankedPlayerId = null;
      this.stopRankedTicketPolling();
      this.stopRankedStatsPolling();
      this.closeRankedMatchModal();
      this.clearStoredRankedTicket();
      this.updateRankedUI(null);
      this.setRankedListMessage(
        this.rankedLeaderboardList,
        "Log in to see leaderboard updates.",
      );
      this.setRankedListMessage(
        this.rankedHistoryList,
        "Log in to see your recent ranked matches.",
      );
      return;
    }

    this.rankedPlayerId = getPersistentID();
    this.updateRankedUI(this.rankedTicket);
    await this.tryRestoreRankedTicket();
    await this.refreshRankedStats();
    // Start polling stats for live updates
    this.startRankedStatsPolling();
  }

  private updateRankedUI(ticket: RankedQueueTicket | null): void {
    const button = this.rankedQueueButton;
    const previousState = this.rankedTicket?.state ?? null;

    this.rankedTicket = ticket ?? null;

    if (!this.rankedPlayerId) {
      if (button) {
        button.disabled = false;
        button.textContent = "Log in to play ranked";
      }
      this.updateRankedStatus("Log in to access ranked matchmaking.");
      this.toggleRankedStats(false);
      this.closeRankedMatchModal();
      this.stopRankedTicketPolling();
      return;
    }

    this.toggleRankedStats(true);

    let label = "Join Ranked Queue";
    let message = "Not in ranked queue.";

    if (ticket) {
      switch (ticket.state) {
        case "queued":
          label = "Leave Ranked Queue";
          message = "Searching for a ranked match...";
          break;
        case "matched":
          label = "Leave Ranked Queue";
          message = "Ranked match found. Awaiting acceptance.";
          break;
        case "ready":
          label = "Match Ready";
          message = "Ranked match ready. Please check your game client.";
          break;
        case "completed":
          label = "Join Ranked Queue";
          message = "Ranked match completed.";
          break;
        case "cancelled":
          label = "Join Ranked Queue";
          message = "Ranked queue cancelled.";
          break;
        default:
          label = "Join Ranked Queue";
          message = "Ranked queue state unknown.";
          break;
      }

      if (
        ticket.match &&
        ticket.acceptToken &&
        ticket.match.state === "awaiting_accept"
      ) {
        // Always call showMatch - it handles both opening and updating
        this.rankedMatchModal?.showMatch({
          matchId: ticket.match.matchId,
          ticketId: ticket.ticketId,
          acceptToken: ticket.acceptToken,
          acceptDeadline: ticket.match.acceptDeadline ?? Date.now() + 30000,
          accepted: Boolean(ticket.acceptedAt),
          acceptedCount:
            ticket.match.acceptedCount ?? (ticket.acceptedAt ? 1 : 0),
          totalPlayers:
            ticket.match.totalPlayers ?? ticket.match.tickets?.length ?? 0,
        });
        this.rankedModalOpen = true;
      } else {
        this.closeRankedMatchModal();
      }

      if (ticket.match?.state === "ready") {
        if (this.attemptLaunchRankedGame(ticket)) {
          message = "Joining ranked match lobby...";
        }
      } else if (ticket.match?.state !== "awaiting_accept") {
        this.rankedLaunchedGameId = null;
      }

      if (
        ticket.state === "queued" ||
        ticket.state === "matched" ||
        ticket.state === "ready"
      ) {
        this.persistRankedTicket(ticket);
      } else {
        this.clearStoredRankedTicket();
        this.stopRankedTicketPolling();
      }
    } else {
      this.clearStoredRankedTicket();
      this.closeRankedMatchModal();
      this.stopRankedTicketPolling();
      this.rankedLaunchedGameId = null;
    }

    if (!ticket && this.rankedBusy) {
      message = "Processing ranked queue request...";
    }

    if (button) {
      const shouldDisable = this.rankedBusy || ticket?.state === "ready";
      button.disabled = shouldDisable;
      const labelText =
        this.rankedBusy && ticket?.state !== "ready" ? `${label}...` : label;
      button.textContent = labelText;
    }

    this.updateRankedStatus(message);

    if (
      ticket &&
      (ticket.state === "completed" || ticket.state === "cancelled") &&
      previousState !== ticket.state
    ) {
      void this.refreshRankedStats();
    }
  }

  private updateRankedStatus(message: string): void {
    if (this.rankedQueueStatusEl) {
      this.rankedQueueStatusEl.textContent = message;
    }
  }

  private toggleRankedStats(visible: boolean): void {
    if (!this.rankedStatsContainer) {
      return;
    }
    this.rankedStatsContainer.classList.toggle("hidden", !visible);
  }

  private setRankedListMessage(
    list: HTMLUListElement | null,
    message: string,
  ): void {
    if (!list) {
      return;
    }
    list.innerHTML = "";
    const item = document.createElement("li");
    item.className = "text-gray-600 dark:text-gray-400 text-center py-4";
    item.textContent = message;
    list.appendChild(item);
  }

  private startRankedTicketPolling(): void {
    if (this.rankedTicketPollHandle !== null) {
      return;
    }

    // Slow fallback polling (30s) for when WebSocket is disconnected
    this.rankedTicketPollHandle = window.setInterval(() => {
      void this.refreshRankedTicket({ silent: true });
    }, 30000);
  }

  private stopRankedTicketPolling(): void {
    if (this.rankedTicketPollHandle !== null) {
      window.clearInterval(this.rankedTicketPollHandle);
      this.rankedTicketPollHandle = null;
    }
  }

  private startRankedStatsPolling(): void {
    if (this.rankedStatsPollHandle !== null) {
      return;
    }
    // Refresh leaderboard and match history every 30 seconds
    this.rankedStatsPollHandle = window.setInterval(() => {
      void this.refreshRankedStats();
    }, 30000);
  }

  private stopRankedStatsPolling(): void {
    if (this.rankedStatsPollHandle !== null) {
      window.clearInterval(this.rankedStatsPollHandle);
      this.rankedStatsPollHandle = null;
    }
  }

  private handleRankedQueueClick(): void {
    if (this.rankedBusy) {
      return;
    }

    if (!this.rankedPlayerId) {
      this.updateRankedStatus("Log in to access ranked matchmaking.");
      discordLogin();
      return;
    }

    if (!this.rankedTicket) {
      void this.joinRankedQueue();
      return;
    }

    if (
      this.rankedTicket.state === "queued" ||
      this.rankedTicket.state === "matched"
    ) {
      void this.leaveRankedQueue();
      return;
    }

    if (this.rankedTicket.state === "ready") {
      this.updateRankedStatus("Ranked match is starting shortly.");
      return;
    }

    void this.joinRankedQueue();
  }

  private async joinRankedQueue(): Promise<void> {
    if (!this.rankedPlayerId) {
      return;
    }
    this.rankedBusy = true;
    this.updateRankedUI(this.rankedTicket);
    try {
      const username = this.usernameInput?.getCurrentUsername();
      const ticket = await joinRankedQueue(
        this.rankedPlayerId,
        RankedMode.Duel,
        RankedRegion.Global,
        undefined,
        username,
      );
      this.updateRankedUI(ticket);
      this.startRankedTicketPolling();
      this.connectRankedWebSocket(ticket.ticketId);
    } catch (error) {
      console.error("Failed to join ranked queue", error);
      this.updateRankedStatus("Failed to join ranked queue. Please try again.");
    } finally {
      this.rankedBusy = false;
      this.updateRankedUI(this.rankedTicket);
    }
  }

  private async leaveRankedQueue(): Promise<void> {
    if (!this.rankedPlayerId || !this.rankedTicket) {
      return;
    }
    this.rankedBusy = true;
    this.updateRankedUI(this.rankedTicket);
    try {
      await leaveRankedQueue(this.rankedPlayerId, this.rankedTicket.ticketId);
      this.updateRankedUI(null);
      this.stopRankedTicketPolling();
      this.disconnectRankedWebSocket();
      void this.refreshRankedStats();
    } catch (error) {
      console.error("Failed to leave ranked queue", error);
      this.updateRankedStatus(
        "Failed to leave ranked queue. Please try again.",
      );
    } finally {
      this.rankedBusy = false;
      this.updateRankedUI(this.rankedTicket);
    }
  }

  private async refreshRankedTicket(
    options: { ticketId?: string; silent?: boolean } = {},
  ): Promise<void> {
    if (!this.rankedPlayerId) {
      return;
    }
    const ticketId = options.ticketId ?? this.rankedTicket?.ticketId;
    if (!ticketId) {
      return;
    }

    try {
      const ticket = await getRankedTicket(this.rankedPlayerId, ticketId);
      this.updateRankedUI(ticket);
      this.startRankedTicketPolling();
    } catch (error) {
      const message = String(error);
      if (message.includes("404")) {
        this.updateRankedUI(null);
        this.clearStoredRankedTicket();
        this.stopRankedTicketPolling();
      } else {
        console.warn("Failed to refresh ranked ticket", error);
        if (!options.silent) {
          this.updateRankedStatus("Unable to refresh ranked queue status.");
        }
      }
    }
  }

  private persistRankedTicket(ticket: RankedQueueTicket): void {
    if (!this.rankedPlayerId) {
      return;
    }
    try {
      localStorage.setItem(
        this.rankedTicketStorageKey,
        JSON.stringify({
          playerId: this.rankedPlayerId,
          ticketId: ticket.ticketId,
        }),
      );
    } catch (error) {
      console.warn("Failed to persist ranked ticket", error);
    }
  }

  private clearStoredRankedTicket(): void {
    try {
      localStorage.removeItem(this.rankedTicketStorageKey);
    } catch (error) {
      console.warn("Failed to clear ranked ticket cache", error);
    }
  }

  private loadStoredRankedTicket(): {
    ticketId: string;
    playerId: string;
  } | null {
    try {
      const raw = localStorage.getItem(this.rankedTicketStorageKey);
      if (!raw) {
        return null;
      }
      const data = JSON.parse(raw) as {
        ticketId?: unknown;
        playerId?: unknown;
      };
      if (
        typeof data.ticketId === "string" &&
        typeof data.playerId === "string"
      ) {
        return { ticketId: data.ticketId, playerId: data.playerId };
      }
    } catch (error) {
      console.warn("Failed to load ranked ticket cache", error);
    }
    return null;
  }

  private async tryRestoreRankedTicket(): Promise<void> {
    if (!this.rankedPlayerId) {
      return;
    }
    const stored = this.loadStoredRankedTicket();
    if (!stored || stored.playerId !== this.rankedPlayerId) {
      this.clearStoredRankedTicket();
      this.updateRankedUI(this.rankedTicket);
      return;
    }
    await this.refreshRankedTicket({ ticketId: stored.ticketId, silent: true });
  }

  private renderRankedLeaderboard(entries: RankedLeaderboardEntry[]): void {
    if (!this.rankedLeaderboardList) {
      return;
    }
    this.rankedLeaderboardList.innerHTML = "";
    if (entries.length === 0) {
      this.setRankedListMessage(
        this.rankedLeaderboardList,
        "No ranked data yet.",
      );
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const entry of entries.slice(0, 10)) {
      const item = document.createElement("li");
      item.className =
        "flex items-center justify-between rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-100 dark:bg-slate-700/50 px-3 py-2 text-gray-900 dark:text-white";
      if (this.rankedPlayerId && entry.playerId === this.rankedPlayerId) {
        item.classList.add(
          "!border-emerald-500",
          "!bg-emerald-100",
          "dark:!bg-emerald-900/30",
          "font-semibold",
        );
      }
      const nameLabel = document.createElement("span");
      const displayName =
        entry.username ??
        (entry.playerId.length > 12
          ? `${entry.playerId.slice(0, 8)}...`
          : entry.playerId);
      nameLabel.textContent = `#${entry.rank} ${displayName}`;
      const rating = document.createElement("span");
      rating.className = "font-bold text-blue-600 dark:text-blue-400";
      rating.textContent = `${Math.round(entry.rating)}`;
      item.append(nameLabel, rating);
      fragment.appendChild(item);
    }

    this.rankedLeaderboardList.appendChild(fragment);
  }

  private renderRankedHistory(matches: RankedMatchHistoryEntry[]): void {
    if (!this.rankedHistoryList) {
      return;
    }
    this.rankedHistoryList.innerHTML = "";
    if (matches.length === 0) {
      this.setRankedListMessage(
        this.rankedHistoryList,
        "No ranked matches yet.",
      );
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const match of matches.slice(0, 10)) {
      const item = document.createElement("li");
      item.className =
        "rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-100 dark:bg-slate-700/50 px-3 py-2 text-sm text-gray-900 dark:text-white";
      const header = document.createElement("div");
      header.className = "flex items-center justify-between font-semibold";
      const outcome = document.createElement("span");
      const outcomeRaw = match.outcome ?? "pending";
      const outcomeLabel =
        outcomeRaw.charAt(0).toUpperCase() + outcomeRaw.slice(1);
      outcome.textContent = outcomeLabel;
      if (outcomeRaw === "win") {
        outcome.className = "text-emerald-600 dark:text-emerald-400";
      } else if (outcomeRaw === "loss") {
        outcome.className = "text-rose-600 dark:text-rose-400";
      } else {
        outcome.className = "text-slate-600 dark:text-slate-400";
      }
      const ratingDelta = document.createElement("span");
      if (typeof match.ratingDelta === "number") {
        const sign = match.ratingDelta > 0 ? "+" : "";
        ratingDelta.textContent = `${sign}${match.ratingDelta.toFixed(0)}`;
        ratingDelta.className =
          match.ratingDelta >= 0
            ? "text-emerald-600 dark:text-emerald-400"
            : "text-rose-600 dark:text-rose-400";
      } else {
        ratingDelta.textContent = "";
      }
      header.append(outcome, ratingDelta);

      const meta = document.createElement("div");
      meta.className = "mt-1 text-xs text-gray-600 dark:text-gray-400";
      const opponentId =
        match.opponentPlayerId && match.opponentPlayerId.length > 12
          ? `${match.opponentPlayerId.slice(0, 8)}...`
          : (match.opponentPlayerId ?? "Unknown opponent");
      const when = new Date(match.createdAt).toLocaleString();
      meta.textContent = `${opponentId} - ${when}`;

      // Add replay link
      const replayHint = document.createElement("div");
      replayHint.className =
        "mt-1 text-xs text-blue-600 dark:text-blue-400 font-medium";
      replayHint.textContent = "Click to watch replay →";

      item.append(header, meta, replayHint);

      // Make item clickable and add hover effect
      item.classList.add(
        "cursor-pointer",
        "hover:bg-slate-200",
        "dark:hover:bg-slate-600/50",
        "transition-colors",
      );
      if (match.gameId) {
        item.addEventListener("click", () => {
          const replayUrl = `${window.location.origin}/#join=${match.gameId}`;
          window.open(replayUrl, "_blank");
        });
      }

      fragment.appendChild(item);
    }

    this.rankedHistoryList.appendChild(fragment);
  }

  private async refreshRankedStats(): Promise<void> {
    if (!this.rankedPlayerId) {
      return;
    }
    try {
      const [leaderboard, history] = await Promise.all([
        fetchRankedLeaderboard(this.rankedPlayerId, { limit: 10 }),
        fetchRankedHistory(this.rankedPlayerId, { limit: 10 }),
      ]);
      this.renderRankedLeaderboard(leaderboard.entries);
      this.renderRankedHistory(history.matches);
    } catch (error) {
      console.error("Failed to load ranked stats", error);
      this.setRankedListMessage(
        this.rankedLeaderboardList,
        "Unable to load leaderboard right now.",
      );
      this.setRankedListMessage(
        this.rankedHistoryList,
        "Unable to load match history right now.",
      );
    }
  }

  private closeRankedMatchModal(): void {
    this.rankedMatchModal?.close();
    this.rankedModalOpen = false;
  }

  private attemptLaunchRankedGame(ticket: RankedQueueTicket): boolean {
    const match = ticket.match;
    if (!match || match.state !== "ready" || !match.gameId) {
      return false;
    }
    if (this.rankedLaunchedGameId === match.gameId) {
      return false;
    }

    // Stop public lobby polling to reduce API calls during game
    this.publicLobby?.stop();

    const event: JoinLobbyEvent = {
      gameID: match.gameId,
      clientID: generateID(),
    };
    document.dispatchEvent(
      new CustomEvent<JoinLobbyEvent>("join-lobby", {
        detail: event,
        bubbles: true,
        composed: true,
      }),
    );

    this.closeRankedMatchModal();
    this.rankedLaunchedGameId = match.gameId;
    return true;
  }

  private async handleRankedMatchAccept(
    event: CustomEvent<RankedMatchAcceptDetail>,
  ): Promise<void> {
    if (!this.rankedPlayerId) {
      return;
    }
    const { ticketId, matchId, acceptToken } = event.detail;
    this.rankedBusy = true;
    this.updateRankedUI(this.rankedTicket);
    try {
      const ticket = await acceptRankedMatch(
        this.rankedPlayerId,
        matchId,
        ticketId,
        acceptToken,
      );
      this.updateRankedUI(ticket);
      this.startRankedTicketPolling();

      // Poll more aggressively for a few seconds after accepting
      // to catch the "ready" state quickly
      const aggressivePollCount = 4; // Poll 4 times over 2 seconds
      for (let i = 0; i < aggressivePollCount; i++) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        await this.refreshRankedTicket({ silent: true });
        if (this.rankedTicket?.match?.state === "ready") {
          break;
        }
      }
    } catch (error) {
      console.error("Failed to accept ranked match", error);
      this.updateRankedStatus(
        "Failed to accept ranked match. Please try again.",
      );
      await this.refreshRankedTicket();
    } finally {
      this.rankedBusy = false;
      this.updateRankedUI(this.rankedTicket);
    }
  }

  private async handleRankedMatchDecline(
    event: CustomEvent<RankedMatchDeclineDetail>,
  ): Promise<void> {
    if (!this.rankedPlayerId) {
      return;
    }
    const { ticketId, matchId } = event.detail;
    this.rankedBusy = true;
    this.updateRankedUI(this.rankedTicket);

    // Close the modal immediately to provide feedback
    this.closeRankedMatchModal();

    try {
      const ticket = await declineRankedMatch(
        this.rankedPlayerId,
        matchId,
        ticketId,
      );
      // Update internal ticket but don't re-render UI to avoid re-opening modal
      this.rankedTicket = ticket;
      // Don't start polling after declining - player is out of queue with penalty
      this.stopRankedTicketPolling();
      this.disconnectRankedWebSocket();
      this.clearStoredRankedTicket();
      this.updateRankedStatus(
        "Match declined. You can rejoin the queue when ready.",
      );

      // Update button state without triggering modal
      if (this.rankedQueueButton) {
        this.rankedQueueButton.disabled = false;
        this.rankedQueueButton.textContent = "Join Ranked Queue";
      }
    } catch (error) {
      console.error("Failed to decline ranked match", error);
      // If decline fails (likely match already timed out), close modal and refresh state
      this.stopRankedTicketPolling();
      this.disconnectRankedWebSocket();
      this.clearStoredRankedTicket();
      await this.refreshRankedTicket({ silent: true });
      this.updateRankedStatus("Match was cancelled or timed out.");
    } finally {
      this.rankedBusy = false;
    }
  }

  // === RANKED WEBSOCKET METHODS ===

  private async connectRankedWebSocket(ticketId: string): Promise<void> {
    if (!this.rankedPlayerId) {
      return;
    }

    try {
      const config = await getServerConfigFromClient();
      const workerPath = config.workerPath("ranked-queue" as GameID);
      const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsHost = window.location.host;
      const serverUrl = `${wsProtocol}//${wsHost}/${workerPath}`;

      if (!this.rankedWebSocket) {
        this.rankedWebSocket = new RankedWebSocket(serverUrl);
        // Set up callback for WebSocket updates
        this.rankedWebSocket.onUpdate((ticket) => {
          this.updateRankedUI(ticket);
        });
      }

      this.rankedWebSocket.connect(this.rankedPlayerId, ticketId);
    } catch (error) {
      console.error("Failed to connect ranked WebSocket", error);
    }
  }

  private disconnectRankedWebSocket(): void {
    if (this.rankedWebSocket) {
      this.rankedWebSocket.disconnect();
      this.rankedWebSocket = null;
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
      this.eventBus,
      {
        gameID: lobby.gameID,
        serverConfig: config,
        pattern:
          this.userSettings.getSelectedPatternName(await fetchCosmetics()) ??
          undefined,
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
    this.publicLobby.leaveLobby();
  }

  private handleKickPlayer(event: CustomEvent) {
    const { target } = event.detail;

    // Forward to eventBus if available
    if (this.eventBus) {
      this.eventBus.emit(new SendKickPlayerIntentEvent(target));
    }
  }
}

// Initialize the client when the DOM is loaded
document.addEventListener("DOMContentLoaded", () => {
  new Client().initialize();
});

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

function hasAllowedFlare(
  userMeResponse: UserMeResponse | false,
  config: ServerConfig,
) {
  const allowed = config.allowedFlares();
  if (allowed === undefined) return true;
  if (userMeResponse === false) return false;
  const flares = userMeResponse.player.flares;
  if (flares === undefined) return false;
  return allowed.length === 0 || allowed.some((f) => flares.includes(f));
}
