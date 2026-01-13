import { html, LitElement } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import { UserMeResponse } from "../core/ApiSchemas";
import { getServerConfigFromClient } from "../core/configuration/ConfigLoader";
import { generateID } from "../core/Util";
import { getUserMe } from "./Api";
import { getPlayToken } from "./Auth";
import { BaseModal } from "./components/BaseModal";
import "./components/Difficulties";
import "./components/PatternButton";
import { modalHeader } from "./components/ui/ModalHeader";
import { JoinLobbyEvent } from "./Main";
import { translateText } from "./Utils";

@customElement("matchmaking-modal")
export class MatchmakingModal extends BaseModal {
  private gameCheckInterval: ReturnType<typeof setInterval> | null = null;
  @state() private connected = false;
  @state() private socket: WebSocket | null = null;
  @state() private gameID: string | null = null;
  private elo = "unknown";

  constructor() {
    super();
    this.id = "page-matchmaking";
    document.addEventListener("userMeResponse", (event: Event) => {
      const customEvent = event as CustomEvent;
      if (customEvent.detail) {
        const userMeResponse = customEvent.detail as UserMeResponse;
        this.elo =
          userMeResponse.player?.leaderboard?.oneVone?.elo?.toString() ??
          "unknown";
        this.requestUpdate();
      }
    });
  }

  createRenderRoot() {
    return this;
  }

  render() {
    const eloDisplay = html`
      <p class="text-center mt-2 mb-4 text-white/60">
        ${translateText("matchmaking_modal.elo", { elo: this.elo })}
      </p>
    `;

    const content = html`
      <div
        class="h-full flex flex-col ${this.inline
          ? "bg-black/60 backdrop-blur-md rounded-2xl border border-white/10"
          : ""}"
      >
        ${modalHeader({
          title: translateText("matchmaking_modal.title"),
          onBack: this.close,
          ariaLabel: translateText("common.back"),
        })}
        <div class="flex-1 flex flex-col items-center justify-center gap-6 p-6">
          ${eloDisplay} ${this.renderInner()}
        </div>
      </div>
    `;

    if (this.inline) {
      return content;
    }

    return html`
      <o-modal
        id="matchmaking-modal"
        title="${translateText("matchmaking_modal.title")}"
        hideCloseButton
        hideHeader
      >
        ${content}
      </o-modal>
    `;
  }

  private renderInner() {
    if (!this.connected) {
      return html`
        <div class="flex flex-col items-center gap-4">
          <div
            class="w-12 h-12 border-4 border-blue-500/30 border-t-blue-500 rounded-full animate-spin"
          ></div>
          <p class="text-center text-white/80">
            ${translateText("matchmaking_modal.connecting")}
          </p>
        </div>
      `;
    }
    if (this.gameID === null) {
      return html`
        <div class="flex flex-col items-center gap-4">
          <div
            class="w-12 h-12 border-4 border-green-500/30 border-t-green-500 rounded-full animate-spin"
          ></div>
          <p class="text-center text-white/80">
            ${translateText("matchmaking_modal.searching")}
          </p>
        </div>
      `;
    } else {
      return html`
        <div class="flex flex-col items-center gap-4">
          <div
            class="w-12 h-12 border-4 border-yellow-500/30 border-t-yellow-500 rounded-full animate-spin"
          ></div>
          <p class="text-center text-white/80">
            ${translateText("matchmaking_modal.waiting_for_game")}
          </p>
        </div>
      `;
    }
  }

  private async connect() {
    const config = await getServerConfigFromClient();

    this.socket = new WebSocket(`${config.jwtIssuer()}/matchmaking/join`);
    this.socket.onopen = async () => {
      console.log("Connected to matchmaking server");
      setTimeout(() => {
        // Set a delay so the user can see the "connecting" message,
        // otherwise the "searching" message will be shown immediately.
        this.connected = true;
        this.requestUpdate();
      }, 1000);
      this.socket?.send(
        JSON.stringify({
          type: "join",
          jwt: await getPlayToken(),
        }),
      );
    };
    this.socket.onmessage = (event) => {
      console.log(event.data);
      const data = JSON.parse(event.data);
      if (data.type === "match-assignment") {
        this.socket?.close();
        console.log(`matchmaking: got game ID: ${data.gameId}`);
        this.gameID = data.gameId;
      }
    };
    this.socket.onerror = (event: ErrorEvent) => {
      console.error("WebSocket error occurred:", event);
    };
    this.socket.onclose = () => {
      console.log("Matchmaking server closed connection");
    };
  }

  protected async onOpen(): Promise<void> {
    const userMe = await getUserMe();

    // Early return if modal was closed during async operation
    if (!this.isModalOpen) {
      return;
    }

    const isLoggedIn =
      userMe &&
      userMe.user &&
      (userMe.user.discord !== undefined || userMe.user.email !== undefined);
    if (!isLoggedIn) {
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
      return;
    }
    this.connected = false;
    this.gameID = null;
    this.connect();
    this.gameCheckInterval = setInterval(() => this.checkGame(), 3000);
  }

  protected onClose(): void {
    this.connected = false;
    this.socket?.close();
    if (this.gameCheckInterval) {
      clearInterval(this.gameCheckInterval);
      this.gameCheckInterval = null;
    }
  }

  private async checkGame() {
    if (this.gameID === null) {
      return;
    }
    const config = await getServerConfigFromClient();
    const url = `/${config.workerPath(this.gameID)}/api/game/${this.gameID}/exists`;

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
          clientID: generateID(),
        } as JoinLobbyEvent,
        bubbles: true,
        composed: true,
      }),
    );
  }
}

@customElement("matchmaking-button")
export class MatchmakingButton extends LitElement {
  @query("matchmaking-modal") private matchmakingModal?: MatchmakingModal;

  constructor() {
    super();
  }

  async connectedCallback() {
    super.connectedCallback();
  }

  createRenderRoot() {
    return this;
  }

  render() {
    return html`
      <div class="z-9999">
        <o-button
          @click="${this.open}"
          translationKey="matchmaking_modal.title"
          block
          secondary
        ></o-button>
      </div>
      <matchmaking-modal></matchmaking-modal>
    `;
  }

  private open() {
    this.matchmakingModal?.open();
  }

  public close() {
    this.matchmakingModal?.close();
    this.requestUpdate();
  }
}
