import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { ClientEnv } from "src/client/ClientEnv";
import { UserMeResponse } from "../core/ApiSchemas";
import { getUserMe, hasLinkedAccount } from "./Api";
import { getPlayToken } from "./Auth";
import { BaseModal } from "./components/BaseModal";
import "./components/Difficulties";
import { modalHeader } from "./components/ui/ModalHeader";
import { crazyGamesSDK } from "./CrazyGamesSDK";
import { JoinLobbyEvent } from "./Main";
import { translateText } from "./Utils";

@customElement("matchmaking-modal")
export class MatchmakingModal extends BaseModal {
  private gameCheckInterval: ReturnType<typeof setInterval> | null = null;
  private connectTimeout: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private intentionalClose = false;
  // Which queue to join; set by Main from the open-matchmaking event
  // before the modal opens.
  public mode: "1v1" | "2v2" = "1v1";
  @state() private connected = false;
  @state() private socket: WebSocket | null = null;
  @state() private gameID: string | null = null;
  private elo: number | string = "...";

  constructor() {
    super();
    this.id = "page-matchmaking";
  }

  createRenderRoot() {
    return this;
  }

  protected renderHeaderSlot() {
    return modalHeader({
      title: translateText(
        this.mode === "2v2"
          ? "matchmaking_modal.title_2v2"
          : "matchmaking_modal.title",
      ),
      onBack: () => this.close(),
      ariaLabel: translateText("common.back"),
    });
  }

  protected renderBody() {
    const eloDisplay = html`
      <p class="text-center mt-2 mb-4 text-white/60">
        ${translateText("matchmaking_modal.elo", { elo: this.elo })}
      </p>
    `;
    return html`
      <div class="flex flex-col items-center justify-center gap-6 p-6">
        ${eloDisplay} ${this.renderInner()}
      </div>
    `;
  }

  private renderInner() {
    if (!this.connected) {
      return this.renderLoadingSpinner(
        translateText("matchmaking_modal.connecting"),
        "blue",
      );
    }
    if (this.gameID === null) {
      return this.renderLoadingSpinner(
        translateText("matchmaking_modal.searching"),
        "green",
      );
    } else {
      return this.renderLoadingSpinner(
        translateText("matchmaking_modal.waiting_for_game"),
        "yellow",
      );
    }
  }

  private async connect() {
    // A pending join timer from a previous socket must not fire on this one.
    if (this.connectTimeout) {
      clearTimeout(this.connectTimeout);
      this.connectTimeout = null;
    }
    // mode is omitted for 1v1 so an API without mode support keeps working.
    const modeParam = this.mode === "2v2" ? "&mode=2v2" : "";
    this.socket = new WebSocket(
      `${ClientEnv.jwtIssuer()}/matchmaking/join?instance_id=${encodeURIComponent(ClientEnv.instanceId())}${modeParam}`,
    );
    this.socket.onopen = async () => {
      console.log("Connected to matchmaking server");
      this.connectTimeout = setTimeout(async () => {
        if (this.socket?.readyState !== WebSocket.OPEN) {
          console.warn("[Matchmaking] socket not ready");
          return;
        }
        // Set a delay so the user can see the "connecting" message,
        // otherwise the "searching" message will be shown immediately.
        // Also wait so people who back out immediately aren't added
        // to the matchmaking queue.
        this.socket.send(
          JSON.stringify({
            type: "join",
            jwt: await getPlayToken(),
          }),
        );
        this.connected = true;
        this.requestUpdate();
      }, 2000);
    };
    this.socket.onmessage = (event) => {
      console.log(event.data);
      const data = JSON.parse(event.data);
      if (data.type === "match-assignment") {
        this.intentionalClose = true;
        this.socket?.close();
        console.log(`matchmaking: got game ID: ${data.gameId}`);
        this.gameID = data.gameId;
        this.gameCheckInterval = setInterval(() => this.checkGame(), 1000);
      }
    };
    this.socket.onerror = (event: Event) => {
      console.error("WebSocket error occurred:", event);
    };
    this.socket.onclose = (event: CloseEvent) => {
      console.log(
        `Matchmaking server closed connection: code=${event.code} reason=${event.reason}`,
      );
      if (this.intentionalClose || this.gameID !== null) {
        return;
      }
      if (event.code === 1000) {
        // A newer connection for this account (e.g. a second tab) took the
        // queue slot; this socket was replaced. Do not retry.
        window.dispatchEvent(
          new CustomEvent("show-message", {
            detail: {
              message: translateText("matchmaking_modal.replaced"),
              color: "red",
              duration: 5000,
            },
          }),
        );
        this.close();
        return;
      }
      // 1008: the jwt was rejected — getPlayToken() refreshes expired tokens,
      // so rejoining sends a fresh one. Anything else is a server
      // restart/deploy; the queue is in-memory only, so rejoin. Back off in
      // case the failure repeats.
      this.connected = false;
      const delay = Math.min(1000 * 2 ** this.reconnectAttempts++, 15000);
      this.reconnectTimeout = setTimeout(() => this.connect(), delay);
    };
  }

  protected async onOpen(): Promise<void> {
    const userMe = await getUserMe();
    // Early return if modal was closed during async operation
    if (!this.isModalOpen) {
      return;
    }

    // CrazyGames players authenticate through the SDK rather than a linked
    // Discord/Google/email account, so a signed-in CrazyGames user counts as
    // logged in for ranked.
    const crazyGamesSignedIn =
      crazyGamesSDK.isOnCrazyGames() &&
      (await crazyGamesSDK.getUserProfile()) !== null;
    if (!this.isModalOpen) {
      return;
    }

    if (
      userMe === false ||
      (!hasLinkedAccount(userMe) && !crazyGamesSignedIn)
    ) {
      window.dispatchEvent(
        new CustomEvent("show-message", {
          detail: {
            message: translateText("matchmaking_button.must_login"),
            color: "red",
            duration: 3000,
          },
        }),
      );
      this.close();
      window.showPage?.("page-account");
      return;
    }

    const row =
      this.mode === "2v2"
        ? userMe.player.leaderboard?.twoVtwo
        : userMe.player.leaderboard?.oneVone;
    this.elo = row?.elo ?? translateText("matchmaking_modal.no_elo");

    this.connected = false;
    this.gameID = null;
    this.intentionalClose = false;
    this.reconnectAttempts = 0;
    this.connect();
  }

  protected onClose(): void {
    this.connected = false;
    this.intentionalClose = true;
    this.socket?.close();
    if (this.connectTimeout) {
      clearTimeout(this.connectTimeout);
      this.connectTimeout = null;
    }
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    if (this.gameCheckInterval) {
      clearInterval(this.gameCheckInterval);
      this.gameCheckInterval = null;
    }
  }

  private async checkGame() {
    if (this.gameID === null) {
      return;
    }
    const url = `/${ClientEnv.workerPath(this.gameID)}/api/game/${this.gameID}/exists`;

    const response = await fetch(url, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });

    const gameInfo = await response.json();

    if (response.status !== 200) {
      console.error(`Error checking game ${this.gameID}: ${response.status}`);
      return;
    }

    if (!gameInfo.exists) {
      console.info(`Game ${this.gameID} does not exist or hasn't started yet`);
      return;
    }

    if (this.gameCheckInterval) {
      clearInterval(this.gameCheckInterval);
      this.gameCheckInterval = null;
    }

    this.dispatchEvent(
      new CustomEvent("join-lobby", {
        detail: {
          gameID: this.gameID,
          source: "matchmaking",
        } as JoinLobbyEvent,
        bubbles: true,
        composed: true,
      }),
    );
  }
}

@customElement("matchmaking-button")
export class MatchmakingButton extends LitElement {
  @state() private isLoggedIn = false;

  constructor() {
    super();
  }

  async connectedCallback() {
    super.connectedCallback();
    // Listen for user authentication changes
    document.addEventListener("userMeResponse", (event: Event) => {
      const customEvent = event as CustomEvent;
      if (customEvent.detail) {
        const userMeResponse = customEvent.detail as UserMeResponse | false;
        this.isLoggedIn = hasLinkedAccount(userMeResponse);
      }
    });
  }

  createRenderRoot() {
    return this;
  }

  render() {
    return this.isLoggedIn
      ? html`
          <button
            @click="${this.handleLoggedInClick}"
            class="no-crazygames w-full h-20 bg-purple-600 hover:bg-purple-500 text-white font-black uppercase tracking-widest rounded-xl transition-all duration-200 flex flex-col items-center justify-center group overflow-hidden relative"
            title="${translateText("matchmaking_modal.title")}"
          >
            <span class="relative z-10 text-2xl">
              ${translateText("matchmaking_button.play_ranked")}
            </span>
            <span
              class="relative z-10 text-xs font-medium text-purple-100 opacity-90 group-hover:opacity-100 transition-opacity"
            >
              ${translateText("matchmaking_button.description")}
            </span>
          </button>
        `
      : html`
          <button
            @click="${this.handleLoggedOutClick}"
            class="no-crazygames w-full h-20 bg-purple-600 hover:bg-purple-500 text-white font-black uppercase tracking-widest rounded-xl transition-all duration-200 flex flex-col items-center justify-center overflow-hidden relative cursor-pointer"
          >
            <span class="relative z-10 text-2xl">
              ${translateText("matchmaking_button.login_required")}
            </span>
          </button>
        `;
  }

  private handleLoggedInClick() {
    document.dispatchEvent(new CustomEvent("open-matchmaking"));
  }

  private handleLoggedOutClick() {
    window.showPage?.("page-account");
  }
}
