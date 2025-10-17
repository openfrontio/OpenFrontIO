import { html, LitElement } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import { getServerConfigFromClient } from "../core/configuration/ConfigLoader";
import { generateID } from "../core/Util";
import "./components/Difficulties";
import "./components/PatternButton";
import { getPlayToken, JoinLobbyEvent } from "./Main";
import { translateText } from "./Utils";

@customElement("matchmaking-modal")
export class MatchmakingModal extends LitElement {
  private gameCheckInterval: NodeJS.Timeout | null = null;

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
        title="${translateText("matchmaking_modal.title") || "Matchmaking"}"
      >
        ${this.renderInner()}
      </o-modal>
    `;
  }

  private renderInner() {
    if (this.gameID === null) {
      return html`${translateText("matchmaking_modal.searching")}`;
    } else {
      return html`${translateText("matchmaking_modal.connecting")}`;
    }
  }

  private async connect() {
    const config = await getServerConfigFromClient();

    const url = `${config.jwtIssuer() + "/matchmaking/join"}`;

    const socket = new WebSocket(url, [`token.${getPlayToken()}`]);
    socket.onopen = () => {
      console.log("Connected to matchmaking server");
    };
    socket.onmessage = (event) => {
      console.log(event.data);
      const data = JSON.parse(event.data);
      if (data.type === "match-assignment") {
        socket.close();
        console.log(`got game ID: ${data.gameId}`);
        this.gameID = data.gameId;
      }
    };
    socket.onerror = (event: ErrorEvent) => {
      console.error("WebSocket error occurred:");
      console.error("Error event:", event);
      console.error("Event type:", event.type);
      console.error("Event target:", event.target);
    };
    socket.onclose = (event) => {
      console.log("Matchmaking server closed connection");
    };
  }

  public close() {
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
      <div class="z-[9999]">
        <button
          @click="${this.open}"
          class="w-full h-16 bg-blue-600 hover:bg-blue-700 text-white rounded-full shadow-2xl hover:shadow-3xl transition-all duration-200 flex items-center justify-center text-xl focus:outline-none focus:ring-4 focus:ring-blue-500 focus:ring-offset-4"
          title="Test"
        >
          Matchmaking
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
