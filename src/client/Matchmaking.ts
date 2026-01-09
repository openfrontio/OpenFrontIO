import { html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { getServerConfigFromClient } from "../core/configuration/ConfigLoader";
import { generateID } from "../core/Util";
import { getUserMe } from "./Api";
import { getPlayToken } from "./Auth";
import { BaseModal } from "./components/BaseModal";
import "./components/Difficulties";
import "./components/PatternButton";
import { JoinLobbyEvent } from "./Main";
import { translateText } from "./Utils";

@customElement("matchmaking-modal")
export class MatchmakingModal extends BaseModal {
  private gameCheckInterval: ReturnType<typeof setInterval> | null = null;
  @state() private connected = false;
  @state() private socket: WebSocket | null = null;
  @state() private gameID: string | null = null;

  constructor() {
    super();
    this.id = "page-matchmaking";
  }

  render() {
    const content = html`
      <div
        class="h-full flex flex-col ${this.inline
          ? "bg-black/40 backdrop-blur-md rounded-2xl border border-white/10"
          : ""}"
      >
        <div
          class="flex items-center mb-4 pb-2 border-b border-white/10 gap-2 shrink-0 p-6"
        >
          <div class="flex items-center gap-4 flex-1">
            <button
              @click=${this.close}
              class="group flex items-center justify-center w-10 h-10 rounded-full bg-white/5 hover:bg-white/10 transition-all border border-white/10"
              aria-label="${translateText("common.back")}"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="w-5 h-5 text-gray-400 group-hover:text-white transition-colors"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M10 19l-7-7m0 0l7-7m-7 7h18"
                />
              </svg>
            </button>
            <span
              class="text-white text-xl sm:text-2xl md:text-3xl font-bold uppercase tracking-widest break-words hyphens-auto"
            >
              ${translateText("matchmaking_modal.title")}
            </span>
          </div>
        </div>
        <div class="flex-1 flex flex-col items-center justify-center gap-6 p-6">
          ${this.renderInner()}
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
          type: "auth",
          playToken: await getPlayToken(),
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
