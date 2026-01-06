import { html, LitElement } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import { getServerConfigFromClient } from "../core/configuration/ConfigLoader";
import { generateID } from "../core/Util";
import { getPlayToken } from "./Auth";
import "./components/Difficulties";
import "./components/PatternButton";
import { JoinLobbyEvent } from "./Main";
import { translateText } from "./Utils";

@customElement("matchmaking-modal")
export class MatchmakingModal extends LitElement {
  private gameCheckInterval: ReturnType<typeof setInterval> | null = null;
  private connected = false;
  @state() private socket: WebSocket | null = null;

  @state() private gameID: string | null = null;
  @query("o-modal") private modalEl!: HTMLElement & {
    open: () => void;
    close: () => void;
  };

  constructor() {
    super();
  }

  createRenderRoot() {
    return this;
  }

  render() {
    return html`
      <o-modal
        id="matchmaking-modal"
        title="${translateText("matchmaking_modal.title")}"
      >
        ${this.renderInner()}
      </o-modal>
    `;
  }

  private renderInner() {
    if (!this.connected) {
      return html`${translateText("matchmaking_modal.connecting")}`;
    }
    if (this.gameID === null) {
      return html`${translateText("matchmaking_modal.searching")}`;
    } else {
      return html`${translateText("matchmaking_modal.waiting_for_game")}`;
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
    this.socket.onclose = (event) => {
      console.log("Matchmaking server closed connection");
    };
  }

  public close() {
    this.connected = false;
    this.socket?.close();
    this.modalEl?.close();
    if (this.gameCheckInterval) {
      clearInterval(this.gameCheckInterval);
      this.gameCheckInterval = null;
    }
  }

  public async open() {
    this.modalEl?.open();
    this.requestUpdate();
    this.connect();
    this.gameCheckInterval = setInterval(() => this.checkGame(), 3000);
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
  @query("matchmaking-modal") private matchmakingModal: MatchmakingModal;
  @state() private matchmakingEnabled = false;

  constructor() {
    super();
  }

  async connectedCallback() {
    super.connectedCallback();
    const config = await getServerConfigFromClient();
    this.matchmakingEnabled = config.enableMatchmaking();
  }

  createRenderRoot() {
    return this;
  }

  render() {
    if (!this.matchmakingEnabled) {
      return html``;
    }

    return html`
      <div class="z-9999">
        <button
          @click="${this.open}"
          class="w-full h-20 bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white font-black uppercase tracking-widest rounded-xl shadow-lg hover:shadow-2xl transition-all duration-200 flex flex-col items-center justify-center border border-white/10 group overflow-hidden relative"
          title="${translateText("matchmaking_modal.title")}"
        >
          <div
            class="absolute inset-0 bg-[url('/images/noise.png')] opacity-10 mix-blend-overlay"
          ></div>
          <span class="relative z-10 text-2xl drop-shadow-md">Play Ranked</span>
          <span
            class="relative z-10 text-xs font-medium text-blue-100 opacity-80 group-hover:opacity-100 transition-opacity"
            >Skill Based Matchmaking</span
          >
        </button>
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
